import { createRuntime, parse } from './lisp.js';
export const policyPaths = ['editor/policy/files.lisp', 'editor/policy/inspector.lisp'];
export const templatePaths = [
  'script',
  'scene',
  'command',
  'image-generator',
  'audio-generator',
  'text-generator',
].map((name) => `editor/templates/${name}.lisp`);
const templates = new Map(),
  loaded = new Map();
const runtime = createRuntime(
  {},
  { budget: 100000, primitives: { 'project-text': (path) => templates.get(path) } },
);
for (const path of [...policyPaths, ...templatePaths]) {
  const url = new URL(path, import.meta.url);
  const source =
    typeof document === 'undefined'
      ? await (await import('node:fs/promises')).readFile(url, 'utf8')
      : await (await fetch(url, { cache: 'no-store' })).text();
  loaded.set(path, source);
  if (templatePaths.includes(path)) templates.set(path, source);
  else runtime.load(parse(source), path);
}
/** Pure policy fallback for Node tools; live editors use their editable Lisp definitions. */
export function policy(name, args, editor) {
  return editor?.global[name] ? editor.invoke(name, ...args) : runtime.call(name, ...args);
}

export const policySource = (path) => loaded.get(path);
