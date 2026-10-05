import { resolvePath, resolveModules as loadModules } from './module-loader.js';
import { game as exampleUpdate, audio as exampleSound, presets } from './examples.js';
import { parse, isSym } from './lisp.js';
import { editorSourceMigrations } from './editor-sources.js';
import { normalizeSource } from './source-text.js';
import { sourceRole, roleSuffixes } from './source-roles.js';

// Only these entry points are protected and loaded by the host. Legacy short
// buffer keys still map to filenames, but they carry no loading privileges.
export const entryPaths = { main: 'main.lisp', game: 'game.lisp' };
const bufferPaths = {
  ...entryPaths,
  editor: 'editor.lisp',
  scene: 'scene.lisp',
  audio: 'audio.lisp',
  ui: 'ui.lisp',
};
export const sourcePath = (key) => bufferPaths[key] ?? key;
export const sourceKey = (path) =>
  ({ 'main.app.lisp': 'main', 'editor.editor.lisp': 'editor' })[path] ??
  Object.keys(bufferPaths).find((key) => bufferPaths[key] === path) ??
  path;

export function rolePath(sources, role, required = false) {
  const paths = Object.keys(sources)
    .filter((key) => !key.startsWith('__'))
    .map(sourcePath)
    .filter((path) => sourceRole(path) === role);
  if (paths.length > 1)
    throw new Error(`Expected one ${roleSuffixes[role]} file; found ${paths.join(', ')}`);
  if (!paths.length && required) throw new Error(`Missing ${roleSuffixes[role]} entry file`);
  return paths[0] ?? '';
}

/** Upgrade legacy roles once; helpers outside commands/ remain ordinary modules. */
export function migrateSourceRoles(sources, state, legacyRoles = true) {
  const renamed = new Map([
    ['main.app.lisp', entryPaths.main],
    ['editor.editor.lisp', 'editor.lisp'],
  ]);
  if (legacyRoles)
    for (const [oldPath, newPath] of [
      ['editor.lisp', 'editor.lisp'],
      ['generators/image.lisp', 'generators/image.generator.lisp'],
      ['generators/audio.lisp', 'generators/audio.generator.lisp'],
    ])
      renamed.set(oldPath, newPath);
  if (legacyRoles)
    for (const key of Object.keys(sources)) {
      const path = sourcePath(key);
      if (path.startsWith('commands/') && path.endsWith('.lisp') && sourceRole(path) === 'module')
        renamed.set(path, path.slice(0, -5) + '.command.lisp');
    }
  for (const [oldPath, newPath] of renamed) {
    const oldKey = sourceKey(oldPath),
      newKey = sourceKey(newPath);
    if (oldKey === newKey || !(oldKey in sources)) continue;
    if (newKey in sources) throw new Error(`Role migration conflicts with ${newPath}`);
    sources[newKey] = sources[oldKey];
    delete sources[oldKey];
  }
  for (const key of Object.keys(sources)) {
    const path = sourcePath(key);
    sources[key] = sources[key]
      .replace(/\(import\s+"([^"\n]+)"\)/g, (form, reference) => {
        const oldPath = resolvePath(reference, path);
        if (!renamed.has(oldPath)) return form;
        return `(import "/${renamed.get(oldPath)}")`;
      })
      .replace(/"([^"\n]+)"/g, (literal, value) =>
        renamed.has(value) ? JSON.stringify(renamed.get(value)) : literal,
      );
  }
  const migratedState = { ...state };
  if (legacyRoles && ['image', 'audio'].includes(migratedState.window)) {
    migratedState['active-generator'] = `generators/${migratedState.window}.generator.lisp`;
    migratedState.window = 'generator';
  }
  for (const [key, value] of Object.entries(migratedState)) {
    if (typeof value !== 'string') continue;
    if (renamed.has(value)) migratedState[key] = renamed.get(value);
    else if (key === 'open-tabs') {
      try {
        const tabs = JSON.parse(value);
        if (Array.isArray(tabs))
          migratedState[key] = JSON.stringify(
            tabs.map((tab) => (renamed.has(tab) ? sourceKey(renamed.get(tab)) : tab)),
          );
      } catch {
        /* Malformed workspace tabs are handled by the tab model. */
      }
    }
  }
  return { state: migratedState };
}

export { resolvePath, cpuForms } from './module-loader.js';
export function resolveModules(sources, roots) {
  const files = Object.fromEntries(
    Object.entries(sources).map(([key, text]) => [sourcePath(key), text]),
  );
  return loadModules(
    files,
    roots.map((root) => sourcePath(sourceKey(root))),
  );
}

export { pixelHook } from './render-hooks.js';

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

export function projectSnapshot(
  sources,
  state,
  resources = {},
  recovery = false,
  applicationState = {},
) {
  return {
    version: 12,
    files: Object.fromEntries(
      Object.entries(sources)
        .filter(([key]) => !key.startsWith('__'))
        .map(([key, text]) => [sourcePath(key), normalizeSource(text)]),
    ),
    resources,
    state: Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('__scene-'))),
    applicationState,
    recovery,
  };
}

/** Validate data before it reaches the live project or any browser binding. */
export function readProject(project, defaults, defaultResources = {}) {
  if (
    !project ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(project.version) ||
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
    sources.editor = defaults.editor ?? '(import "/editor/workspace.lisp")';
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
      sources.main = '(start-scene "scenes/garden.scene.lisp")';
      project = {
        ...project,
        state: { ...project.state, 'active-scene': 'scenes/garden.scene.lisp' },
      };
    }
  }
  rolePath(sources, 'app', true);
  const editorKey = project.version < 8 ? 'editor' : 'main';
  if (typeof sources[editorKey] !== 'string') throw new Error('Missing editor application entry');
  // Stock editor upgrades receive new widgets; human-authored editors are kept.
  let editorHash = 0;
  for (const character of sources[editorKey].replaceAll('\r\n', '\n'))
    editorHash = (Math.imul(editorHash, 31) + character.charCodeAt(0)) | 0;
  // A v2 editor may already have been saved inside a v3 project. Recognize the
  // unmodified stock source by content, rather than gating on project version.
  if ([1398298294, 2134464155, 1024998020, -1720971964, -191853367].includes(editorHash))
    sources[editorKey] =
      project.version < 8
        ? (defaults.editor ?? '(import "/editor/workspace.lisp")')
        : defaults.main;
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
    sources[editorKey] = '(import "./ui.lisp")\n' + sources[editorKey];
  sources[editorKey] = sources[editorKey].replace(
    '(text [24 18] "pixel lisp")',
    '(text [24 18] "aioli")',
  );
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
  {
    const migrated = migrateSourceRoles(sources, project.state, project.version < 6);
    project = { ...project, state: migrated.state };
  }
  if (project.version < 7) {
    if (typeof sources.game === 'string') throw new Error('Migration conflicts with game.lisp');
    sources.game = sources.main;
    for (const key of Object.keys(sources))
      if (key !== 'main')
        sources[key] = sources[key].replace(
          /(\(import\s+")([^"\n]*?)main\.lisp("\))/g,
          '$1$2game.lisp$3',
        );
    sources.game = sources.game.replace(
      /(\(import\s+")([^"\n]*?)main\.lisp("\))/g,
      '$1$2game.lisp$3',
    );
    sources.main = '(import "./editor.lisp")\n(defn draw [] (editor))';
    project = { ...project, state: { ...project.state } };
    for (const key of ['selected-file', 'tab']) {
      if (project.state[key] === 'main.lisp') project.state[key] = 'game.lisp';
      if (project.state[key] === 'main') project.state[key] = 'game';
    }
    if (typeof project.state['open-tabs'] === 'string')
      project.state['open-tabs'] = project.state['open-tabs'].replaceAll('"main"', '"game"');
  }
  if (project.version < 8 && typeof sources.editor === 'string') {
    // Inline the old entry, preserving custom code and the existing draw hook.
    const oldEditor = sources.editor;
    if (/\(import\s+"\.?\/?editor\.lisp"\)/.test(sources.main))
      sources.main = sources.main.replace(/\(import\s+"\.?\/?editor\.lisp"\)/g, () => oldEditor);
    else sources.main += '\n' + oldEditor;
    delete sources.editor;
    project = { ...project, state: { ...project.state } };
    for (const key of ['selected-file', 'tab'])
      if (['editor', 'editor.lisp', 'editor.editor.lisp'].includes(project.state[key]))
        project.state[key] = key === 'tab' ? 'main' : 'main.lisp';
    if (typeof project.state['open-tabs'] === 'string')
      project.state['open-tabs'] = project.state['open-tabs'].replaceAll('"editor"', '"main"');
  }
  {
    const moves = new Map();
    const plain = (text) =>
      normalizeSource(text)
        .replace(/(\(init!\s+:[^\s]+\s+(?:"[^"\n]*"|true|false|-?[\d.]+))\s+\[[^\n]+\]\)/g, '$1)')
        .trim();
    for (const name of ['garden', 'bloom']) {
      const newPath = `examples/${name}.scene.lisp`;
      for (const oldPath of [`scenes/${name}.scene.lisp`, `${name}.scene.lisp`]) {
        if (
          typeof sources[oldPath] === 'string' &&
          typeof defaults[newPath] === 'string' &&
          plain(sources[oldPath]) === plain(defaults[newPath]) &&
          (!(newPath in sources) || plain(sources[newPath]) === plain(sources[oldPath]))
        ) {
          sources[newPath] = sources[oldPath];
          delete sources[oldPath];
          moves.set(oldPath, newPath);
        }
      }
    }
    if (moves.size) {
      if (!('examples/plasma.scene.lisp' in sources) && defaults['examples/plasma.scene.lisp'])
        sources['examples/plasma.scene.lisp'] = defaults['examples/plasma.scene.lisp'];
      for (const key of Object.keys(sources))
        for (const [oldPath, newPath] of moves)
          sources[key] = sources[key]
            .replaceAll(JSON.stringify(oldPath), JSON.stringify(newPath))
            .replaceAll(JSON.stringify('./' + oldPath), JSON.stringify('./' + newPath));
      const remap = (record) =>
        Object.fromEntries(
          Object.entries(record ?? {}).map(([key, value]) => {
            if (typeof value === 'string')
              for (const [oldPath, newPath] of moves)
                value =
                  value === oldPath
                    ? newPath
                    : value.replaceAll(JSON.stringify(oldPath), JSON.stringify(newPath));
            return [key, value];
          }),
        );
      project = {
        ...project,
        state: remap(project.state),
        ...(project.applicationState ? { applicationState: remap(project.applicationState) } : {}),
      };
    }
  }
  const editorFields = new Set([
    'open-tabs',
    'tab-last',
    'tab-width',
    'tab-offset',
    'file-offset',
    'editor-file-paths',
    'active-generator',
    'audio-generator-path',
    'image-generator-path',
  ]);
  for (const [path, text] of Object.entries(sources))
    if (
      path === 'main' ||
      path === 'editor/state.lisp' ||
      path.startsWith('ui/') ||
      path.includes('.generator.lisp')
    )
      for (const match of text.matchAll(/\((?:init!|set!)\s+:([^\s()[\]]+)/g))
        editorFields.add(match[1]);
  // Old saves shared their state. Never hand editor workspace/theme state to a game.
  const applicationState =
    project.applicationState ??
    (project.version < 7
      ? Object.fromEntries(Object.entries(project.state).filter(([key]) => !editorFields.has(key)))
      : {});
  if (
    !applicationState ||
    typeof applicationState !== 'object' ||
    Array.isArray(applicationState) ||
    Object.keys(applicationState).length > 256
  )
    throw new Error('Invalid application state');
  for (const [key, value] of Object.entries(applicationState))
    if (
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      !['number', 'string', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      throw new Error('Invalid application state');
  if (Object.keys(project.state).length > 256) throw new Error('Too many state fields');
  for (const [key, value] of Object.entries(project.state)) {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      !['number', 'string', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      throw new Error('Invalid state');
  }
  let resources = project.resources ?? {};
  if (
    typeof resources !== 'object' ||
    Array.isArray(resources) ||
    Object.keys(resources).length > 256
  )
    throw new Error('Invalid resources');
  // Import initial resources once for older projects, preserving replacements.
  // Newer saves own their resource store, including intentionally deleted assets.
  if (project.version < 10) {
    resources = { ...resources };
    for (const [path, resource] of Object.entries(defaultResources))
      if (!(path in resources) && Object.keys(resources).length < 256) resources[path] = resource;
  }
  if (project.version < 11) {
    resources = { ...resources };
    for (const [path, resource] of Object.entries(defaultResources))
      if (resource.source && resources[path] && !resources[path].source)
        resources[path] = { ...resource };
  }
  // Add newly supplied artwork once without replacing an existing image icon.
  const imageIcon = 'assets/editor-icons/image.png';
  if (
    project.version < 12 &&
    defaultResources[imageIcon] &&
    !(imageIcon in resources) &&
    Object.keys(resources).length < 256
  )
    resources = { ...resources, [imageIcon]: { ...defaultResources[imageIcon] } };
  for (const [path, resource] of Object.entries(resources)) {
    if (
      (resource?.source !== undefined &&
        (typeof resource.source !== 'string' ||
          resolvePath(resource.source) !== resource.source)) ||
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
  return {
    sources,
    state: project.state,
    applicationState,
    resources,
    recovery: project.recovery ?? false,
  };
}
