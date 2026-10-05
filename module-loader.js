import { parse, isSym } from './lisp.js';

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
 * Imports share the application environment. Drawing functions build commands;
 * only nested pixels bodies are handed to the GPU compiler.
 */
export function resolveModules(sources, roots) {
  const files = Object.fromEntries(
    Object.entries(sources)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, text]) => [key, text]),
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
  roots.forEach((root) => visit(root));
  return modules;
}
