import { sourceRole } from './source-roles.js';

/** Project directories are derived from filenames, never separate resources.
 * This module supplies tree data only; Lisp owns indentation, disclosure marks,
 * selection and painting. Expansion fits in one persisted shared-state string.
 */
export function expandedFolders(value) {
  try {
    const paths = JSON.parse(value ?? '[]');
    return new Set(Array.isArray(paths) ? paths.filter((path) => typeof path === 'string') : []);
  } catch {
    return new Set();
  }
}

export function toggleFolder(value, path) {
  const expanded = expandedFolders(value);
  if (expanded.has(path)) expanded.delete(path);
  else expanded.add(path);
  return JSON.stringify([...expanded].sort());
}
/** MIME is authoritative for imported data; filenames identify source files and
 * older assets that were saved without MIME metadata. Icons are painted in Lisp.
 */
export function assetKind(path, kind, mime = '') {
  mime = typeof mime === 'string' ? mime : '';
  if (kind === 'lisp' && path === 'main.lisp') return 'editor-entry';
  if (kind === 'lisp' && path === 'game.lisp') return 'main-entry';
  if (kind === 'lisp' && /\.scene(?:\.lisp)?$/.test(path)) return 'scene';
  if (kind === 'lisp')
    return { command: 'command', generator: 'generator' }[sourceRole(path)] ?? 'code';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (/\.(lisp|json|js|ts|wgsl|txt|md)$/i.test(path)) return 'code';
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|avif)$/i.test(path)) return 'image';
  if (/\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(path)) return 'audio';
  return 'asset';
}

/** Rows: [path, kind, bufferKey, basename, depth, expanded, assetKind]. Folders sort before
 * leaves at each level; hidden descendants consume no rows or scroll space.
 */
export function projectTree(files, value) {
  const expanded = expandedFolders(value),
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
    directory.files.push([path, kind, key, parts.at(-1), assetKind(path, kind, mime)]);
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
  return rows;
}

/** Commands are explicit source roles, independent of folder placement. */
export function isCommandFile(path, kind = 'lisp') {
  return kind === 'lisp' && typeof path === 'string' && sourceRole(path) === 'command';
}
