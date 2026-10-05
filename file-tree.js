import { policy } from './editor-policy.js';
/** Rows: [path, kind, bufferKey, basename, depth, expanded, assetKind]. Folders sort before
 * leaves at each level; hidden descendants consume no rows or scroll space.
 */
const defaultCache = new Map(),
  caches = new WeakMap();
export function projectTree(files, value, folders = [], editor) {
  let cache = editor ? caches.get(editor) : defaultCache;
  if (!cache) {
    cache = new Map();
    caches.set(editor, cache);
  }
  const signature = JSON.stringify([files, value, folders]);
  if (cache.has(signature)) return cache.get(signature);
  const expanded = new Set(Array.isArray(value) ? value : []),
    root = { folders: new Map(), files: [] };
  for (const [path, kind, key, mime] of files) {
    const parts = path.split('/');
    let directory = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index],
        folderPath = parts.slice(0, index + 1).join('/');
      if (!directory.folders.has(name))
        directory.folders.set(name, { path: folderPath, folders: new Map(), files: [] });
      directory = directory.folders.get(name);
    }
    directory.files.push([path, kind, key, parts.at(-1), assetKind(path, kind, mime, editor)]);
  }
  for (const path of folders) {
    let directory = root;
    const parts = path.split('/');
    parts.forEach((name, index) => {
      const folderPath = parts.slice(0, index + 1).join('/');
      if (!directory.folders.has(name))
        directory.folders.set(name, { path: folderPath, folders: new Map(), files: [] });
      directory = directory.folders.get(name);
    });
  }
  const rows = [];
  function visit(directory, depth) {
    for (const [name, folder] of [...directory.folders].sort(([a], [b]) => a.localeCompare(b))) {
      const open = expanded.has(folder.path);
      rows.push([folder.path, 'folder', folder.path, name, depth, open, 'folder']);
      if (open) visit(folder, depth + 1);
    }
    for (const file of directory.files.sort((a, b) => a[3].localeCompare(b[3])))
      rows.push([...file.slice(0, 4), depth, false, file[4]]);
  }
  visit(root, 0);
  if (cache.size >= 8) cache.delete(cache.keys().next().value);
  cache.set(signature, rows);
  return rows;
}

export const assetKind = (path, kind, mime = '', editor) =>
  policy('editor-asset-kind', [path, kind, mime], editor);
export const isCommandFile = (path, kind = 'lisp', editor) =>
  policy('editor-command-file?', [path, kind], editor);
export const toggleFolder = (value, path, editor) =>
  policy('editor-toggle-folder', [Array.isArray(value) ? value : [], path], editor);
