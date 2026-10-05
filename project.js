import { game as exampleUpdate, audio as exampleSound, presets } from './examples.js';
import { parse, isSym } from './lisp.js';
import { editorSourceMigrations } from './editor-sources.js';
import { normalizeSource } from './source-text.js';

// Only these entry points are protected and loaded by the host. Legacy short
// buffer keys still map to filenames, but they carry no loading privileges.
export const entryPaths = { main: 'main.lisp', editor: 'editor.lisp' };
const bufferPaths = {
  ...entryPaths,
  game: 'game.lisp',
  scene: 'scene.lisp',
  audio: 'audio.lisp',
  ui: 'ui.lisp',
};
export const sourcePath = (key) => bufferPaths[key] ?? key;
export const sourceKey = (path) =>
  Object.keys(bufferPaths).find((key) => bufferPaths[key] === path) ?? path;

/** Normalize a project-local path; imports never fetch network resources. */
export function resolvePath(path, importer = '') {
  if (typeof path !== 'string' || !path || /[\\:\u0000-\u001f]/.test(path))
    throw new Error('Invalid project path');
  const parts = path.startsWith('/') ? [] : importer.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Path escapes the project');
      parts.pop();
    } else {
      if (['__proto__', 'constructor', 'prototype'].includes(part))
        throw new Error('Invalid project path');
      parts.push(part);
    }
  }
  if (!parts.length) throw new Error('Expected a filename');
  return parts.join('/');
}

/** Dependency-first evaluation, once per file. A cycle is always an error.
 * Imports share the CPU environment. Only defpixel is handed to the GPU compiler;
 * ordinary forms beside it remain ordinary CPU Lisp.
 */
export function resolveModules(sources, roots) {
  const files = Object.fromEntries(
    Object.entries(sources)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, text]) => [sourcePath(key), text]),
  );
  const visited = new Set(),
    active = [],
    modules = [];
  function visit(path) {
    path = resolvePath(path);
    if (active.includes(path)) throw new Error(`Import cycle: ${[...active, path].join(' → ')}`);
    if (visited.has(path)) return;
    if (typeof files[path] !== 'string')
      throw new Error(`Missing import ${path}${active.length ? ` from ${active.at(-1)}` : ''}`);
    active.push(path);
    let forms;
    try {
      forms = parse(files[path]);
    } catch (error) {
      throw new Error(`${path}: ${error.message}`);
    }
    const body = [];
    for (const form of forms) {
      if (Array.isArray(form) && isSym(form[0], 'import')) {
        if (form.length !== 2 || form[1]?.type !== 'string')
          throw new Error(`${path}: use (import "./file.lisp")`);
        visit(resolvePath(form[1].value, path));
      } else body.push(form);
    }
    active.pop();
    visited.add(path);
    modules.push({ path, forms: body });
  }
  roots.forEach((root) => visit(sourcePath(root)));
  return modules;
}

export const cpuForms = (forms) =>
  forms.filter((form) => !(Array.isArray(form) && isSym(form[0], 'defpixel')));
export function pixelHook(modules, name = null) {
  const hooks = modules.flatMap((module) =>
    module.forms.filter(
      (form) =>
        Array.isArray(form) && isSym(form[0], 'defpixel') && (!name || isSym(form[1], name)),
    ),
  );
  if (hooks.length !== 1)
    throw new Error(
      name
        ? `Expected exactly one (defpixel ${name} [p time] ...) in the application or scene and its imports`
        : 'Expected exactly one defpixel hook in this scene and its imports',
    );
  return hooks;
}

/** Replace a named pixel definition without reprinting surrounding CPU code.
 * Track reader delimiters, strings and comments so parentheses in comments or
 * shader strings cannot truncate the form. Presets keep imports and annotations.
 */
export function replacePixelHook(source, name, replacement) {
  let start = -1,
    depth = 0,
    string = false,
    comment = false;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (comment) {
      if (character === '\n') comment = false;
      continue;
    }
    if (string) {
      if (character === '\\') i++;
      else if (character === '"') string = false;
      continue;
    }
    if (character === ';') {
      comment = true;
      continue;
    }
    if (character === '"') {
      string = true;
      continue;
    }
    if (character === '(' || character === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (character === ')' || character === ']') {
      depth--;
      if (depth === 0 && start >= 0) {
        const form = parse(source.slice(start, i + 1))[0];
        if (Array.isArray(form) && isSym(form[0], 'defpixel') && isSym(form[1], name))
          return source.slice(0, start) + replacement + source.slice(i + 1);
      }
    }
  }
  throw new Error(`Missing defpixel ${name}`);
}

export function projectSnapshot(sources, state, resources = {}, recovery = false) {
  return {
    version: 5,
    files: Object.fromEntries(
      Object.entries(sources)
        .filter(([key]) => !key.startsWith('__'))
        .map(([key, text]) => [sourcePath(key), normalizeSource(text)]),
    ),
    resources,
    state,
    recovery,
  };
}

/** Validate data before it reaches the live project or any browser binding. */
export function readProject(project, defaults) {
  if (
    !project ||
    ![1, 2, 3, 4, 5].includes(project.version) ||
    !project.state ||
    typeof project.state !== 'object' ||
    Array.isArray(project.state)
  )
    throw new Error('Not an aioli project');
  const files = project.version >= 3 ? project.files : project.sources;
  if (!files || typeof files !== 'object' || Object.keys(files).length > 256)
    throw new Error('Invalid project files');
  const sources = Object.create(null);
  for (const [name, text] of Object.entries(files)) {
    const path = resolvePath(project.version >= 3 ? name : sourcePath(name));
    if (
      path.startsWith('__') ||
      (!path.endsWith('.lisp') && !path.endsWith('.scene')) ||
      typeof text !== 'string' ||
      text.length > 100000
    )
      throw new Error(`Invalid source ${name}`);
    const key = sourceKey(path);
    if (key in sources) throw new Error(`Duplicate file ${path}`);
    sources[key] = normalizeSource(text);
  }
  if (project.version === 1) {
    sources.editor = defaults.editor;
    sources.ui = defaults.ui ?? '(import "/ui/components.lisp")';
  }
  // v1-v3 implicitly loaded scene/audio/UI. Turn that behavior into explicit
  // imports, retaining the old files as editable, deletable ordinary modules.
  if (project.version < 4 && typeof sources.game === 'string') {
    const imports = [];
    for (const key of ['audio', 'scene']) {
      if (typeof sources[key] === 'string') imports.push(`(import "./${sourcePath(key)}")`);
    }
    if (typeof sources.scene === 'string') {
      sources.scene = sources.scene.replace(/(\(defpixel\s+)[^\s()[\]]+/, '$1render');
      if (/\(defn\s+scene-update\s/.test(sources.scene)) {
        sources.game = sources.game.replace(/\(defn\s+update\s/, '(defn legacy-update ');
        sources.game += '\n(defn update [dt] (legacy-update dt) (scene-update dt))\n';
      }
    }
    sources.game = imports.join('\n') + '\n' + sources.game;
  }
  if (project.version < 5 && typeof sources.game === 'string' && !('main' in sources)) {
    sources.main = sources.game;
    delete sources.game;
    // References and workspace selections follow the renamed entry point.
    for (const key of Object.keys(sources))
      sources[key] = sources[key].replace(
        /(\(import\s+")([^"\n]*?)game\.lisp("\))/g,
        '$1$2main.lisp$3',
      );
    project = { ...project, state: { ...project.state } };
    if (project.state['selected-file'] === 'game.lisp')
      project.state['selected-file'] = 'main.lisp';
    if (project.state.tab === 'game') project.state.tab = 'main';
    if (typeof project.state['open-tabs'] === 'string')
      project.state['open-tabs'] = project.state['open-tabs'].replaceAll('"game"', '"main"');
  }
  // Upgrade recognizable, unchanged bundled examples too. Custom scene/audio
  // modules are never deleted merely because they use an old filename.
  if (project.version < 5 && typeof sources.main === 'string') {
    const oldMain = sources.main.replace(/^\(import "\.\/(audio|scene)\.lisp"\)\s*/gm, '').trim();
    const stockScene = Object.entries(presets).find(
      ([, text]) =>
        sources.scene?.trim() === text.replace(/\(defpixel\s+\S+/, '(defpixel render').trim(),
    );
    const otherReferences = Object.entries(sources).some(
      ([key, text]) =>
        !['main', 'scene', 'audio'].includes(key) &&
        /\(import\s+"[^"\n]*(scene|audio)\.lisp"/.test(text),
    );
    if (
      oldMain === exampleUpdate.trim() &&
      sources.audio?.trim() === exampleSound.trim() &&
      stockScene &&
      !otherReferences
    ) {
      const path = `scenes/${stockScene[0]}.scene.lisp`;
      sources[path] = exampleUpdate + '\n\n' + exampleSound + '\n\n' + sources.scene;
      sources.main = `; Application entry point.\n(start-scene "${path}")`;
      delete sources.scene;
      delete sources.audio;
      project = { ...project, state: { ...project.state, 'active-scene': path } };
      if (['scene', 'audio'].includes(project.state.tab)) project.state.tab = path;
      if (typeof project.state['open-tabs'] === 'string')
        project.state['open-tabs'] = project.state['open-tabs']
          .replaceAll('"scene"', JSON.stringify(path))
          .replaceAll('"audio"', JSON.stringify(path));
    } else if (
      typeof defaults['scenes/garden.scene.lisp'] === 'string' &&
      sources.main.trim() === normalizeSource(defaults['scenes/garden.scene.lisp']).trim()
    ) {
      sources['scenes/garden.scene.lisp'] = sources.main;
      sources.main = defaults.main;
      project = {
        ...project,
        state: { ...project.state, 'active-scene': 'scenes/garden.scene.lisp' },
      };
    }
  }
  for (const key of Object.keys(entryPaths))
    if (typeof sources[key] !== 'string') throw new Error(`Missing ${sourcePath(key)}`);
  // Stock editor upgrades receive new widgets; human-authored editors are kept.
  let editorHash = 0;
  for (const character of sources.editor.replaceAll('\r\n', '\n'))
    editorHash = (Math.imul(editorHash, 31) + character.charCodeAt(0)) | 0;
  // A v2 editor may already have been saved inside a v3 project. Recognize the
  // unmodified stock source by content, rather than gating on project version.
  if ([1398298294, 2134464155, 1024998020, -1720971964, -191853367].includes(editorHash))
    sources.editor = defaults.editor;
  // The stock widget library can be upgraded independently of a custom shell.
  let uiHash = 0;
  for (const character of (sources.ui ?? '').replaceAll('\r\n', '\n'))
    uiHash = (Math.imul(uiHash, 31) + character.charCodeAt(0)) | 0;
  if (
    [1938375303, -1490889629, 982880566, -1492819819].includes(uiHash) ||
    (typeof sources.ui === 'string' &&
      typeof defaults.ui === 'string' &&
      sources.ui.trim() === defaults.ui.split('; Shared window shell')[0].trim())
  )
    sources.ui = defaults.ui ?? '(import "/ui/components.lisp")';
  if (project.version < 4 && typeof sources.ui === 'string')
    sources.editor = '(import "./ui.lisp")\n' + sources.editor;
  sources.editor = sources.editor.replace('(text [24 18] "pixel lisp")', '(text [24 18] "aioli")');
  for (const [key, value] of Object.entries(defaults))
    if (project.version < 5 && key.includes('/') && !key.startsWith('scenes/') && !(key in sources))
      sources[key] = normalizeSource(value);
  // Saved projects carry their own components. Upgrade only exact known stock
  // content, so new interactions appear without overwriting human customizations.
  for (const [path, hashes] of Object.entries(editorSourceMigrations)) {
    if (!(path in sources) || !(path in defaults)) continue;
    let hash = 0;
    for (const character of normalizeSource(sources[path]))
      hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
    if (hashes.includes(hash)) sources[path] = normalizeSource(defaults[path]);
  }
  // Retire only the unchanged stock facade. Human UI code stays a normal file.
  const stockUI =
    typeof defaults['ui/components.lisp'] === 'string'
      ? normalizeSource(defaults['ui/components.lisp']).replaceAll('"./', '"./ui/')
      : undefined;
  if (
    project.version < 5 &&
    typeof sources.ui === 'string' &&
    (sources.ui.trim() === stockUI?.trim() ||
      sources.ui.trim() === '(import "/ui/components.lisp")')
  ) {
    delete sources.ui;
    for (const key of Object.keys(sources))
      sources[key] = sources[key].replace(/(["/])ui\.lisp"/g, '$1ui/components.lisp"');
  }
  if (Object.keys(project.state).length > 256) throw new Error('Too many state fields');
  for (const [key, value] of Object.entries(project.state)) {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      !['number', 'string', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      throw new Error('Invalid state');
  }
  const resources = project.resources ?? {};
  if (
    typeof resources !== 'object' ||
    Array.isArray(resources) ||
    Object.keys(resources).length > 256
  )
    throw new Error('Invalid resources');
  for (const [path, resource] of Object.entries(resources)) {
    if (
      resolvePath(path) !== path ||
      path in files ||
      typeof resource?.data !== 'string' ||
      !/^data:[\w/+.-]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(resource.data) ||
      resource.data.length > 8000000
    )
      throw new Error(`Invalid resource ${path}`);
  }
  if (project.recovery !== undefined && typeof project.recovery !== 'boolean')
    throw new Error('Invalid recovery flag');
  for (const key of Object.keys(sources)) sources[key] = normalizeSource(sources[key]);
  return { sources, state: project.state, resources, recovery: project.recovery ?? false };
}
