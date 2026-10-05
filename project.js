import { parse, isSym } from './lisp.js';

// The short keys keep existing editor tabs and v1/v2 projects compatible. All
// external paths and v3 saves use actual filenames rather than these aliases.
export const entryPaths = {
  scene: 'scene.lisp',
  game: 'game.lisp',
  audio: 'audio.lisp',
  ui: 'ui.lisp',
  editor: 'editor.lisp',
};
export const sourcePath = (key) => entryPaths[key] ?? key;
export const sourceKey = (path) =>
  Object.keys(entryPaths).find((key) => entryPaths[key] === path) ?? path;

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
export function pixelHook(modules) {
  const hooks = modules.flatMap((module) =>
    module.forms.filter((form) => Array.isArray(form) && isSym(form[0], 'defpixel')),
  );
  if (hooks.length !== 1)
    throw new Error('Expected exactly one defpixel hook in this scene and its imports');
  return hooks;
}

export function projectSnapshot(sources, state, resources = {}, recovery = false) {
  return {
    version: 3,
    files: Object.fromEntries(
      Object.entries(sources)
        .filter(([key]) => !key.startsWith('__'))
        .map(([key, text]) => [sourcePath(key), text]),
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
    ![1, 2, 3].includes(project.version) ||
    !project.state ||
    typeof project.state !== 'object' ||
    Array.isArray(project.state)
  )
    throw new Error('Not an aioli project');
  const files = project.version === 3 ? project.files : project.sources;
  if (!files || typeof files !== 'object' || Object.keys(files).length > 256)
    throw new Error('Invalid project files');
  const sources = Object.create(null);
  for (const [name, text] of Object.entries(files)) {
    const path = resolvePath(project.version === 3 ? name : sourcePath(name));
    if (
      path.startsWith('__') ||
      !path.endsWith('.lisp') ||
      typeof text !== 'string' ||
      text.length > 100000
    )
      throw new Error(`Invalid source ${name}`);
    const key = sourceKey(path);
    if (key in sources) throw new Error(`Duplicate file ${path}`);
    sources[key] = text;
  }
  if (project.version === 1) {
    sources.editor = defaults.editor;
    sources.ui = defaults.ui;
  }
  for (const key of Object.keys(entryPaths))
    if (typeof sources[key] !== 'string') throw new Error(`Missing ${sourcePath(key)}`);
  // Stock editor upgrades receive new widgets; human-authored editors are kept.
  let editorHash = 0;
  for (const character of sources.editor.replaceAll('\r\n', '\n'))
    editorHash = (Math.imul(editorHash, 31) + character.charCodeAt(0)) | 0;
  // A v2 editor may already have been saved inside a v3 project. Recognize the
  // unmodified stock source by content, rather than gating on project version.
  if ([2134464155, 1024998020, -1720971964, -191853367].includes(editorHash))
    sources.editor = defaults.editor;
  // The stock widget library can be upgraded independently of a custom shell.
  let uiHash = 0;
  for (const character of sources.ui.replaceAll('\r\n', '\n'))
    uiHash = (Math.imul(uiHash, 31) + character.charCodeAt(0)) | 0;
  if (
    [-1490889629, 982880566, -1492819819].includes(uiHash) ||
    sources.ui.trim() === defaults.ui.split('; Shared window shell')[0].trim()
  )
    sources.ui = defaults.ui;
  sources.editor = sources.editor.replace('(text [24 18] "pixel lisp")', '(text [24 18] "aioli")');
  for (const [key, value] of Object.entries(defaults))
    if (key.includes('/') && !(key in sources)) sources[key] = value;
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
  return { sources, state: project.state, resources, recovery: project.recovery ?? false };
}
