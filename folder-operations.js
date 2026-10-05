import { resolvePath } from './module-loader.js';
import { sourcePath } from './project-paths.js';
import { planFileMove } from './file-moves.js';
export const insideFolder = (path, folder) => path === folder || path.startsWith(folder + '/');
export function savedFolders(value = []) {
  return Array.isArray(value)
    ? [...new Set(value.filter((path) => typeof path === 'string' && resolvePath(path) === path))]
    : [];
}
export function filePaths(sources, resources) {
  return [
    ...Object.keys(sources)
      .filter((key) => !key.startsWith('__'))
      .map(sourcePath),
    ...Object.keys(resources),
  ];
}
export function folderPaths(sources, resources, folders = []) {
  const result = new Set(folders);
  for (const path of [...filePaths(sources, resources), ...folders.map((path) => path + '/_')]) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) result.add(parts.slice(0, i).join('/'));
  }
  return result;
}
export function validateFolderPath(sources, resources, folders, path) {
  path = resolvePath(path);
  if (path.startsWith('__')) throw new Error('Names beginning with __ are reserved');
  const files = filePaths(sources, resources);
  if (files.some((file) => insideFolder(path, file)))
    throw new Error('A file already uses that path');
  if (folderPaths(sources, resources, folders).has(path)) throw new Error('Folder already exists');
  if (folders.length >= 256) throw new Error('Maximum 256 explicit folders');
  return path;
}
export function planFolderMove(sources, resources, folders, oldPath, newPath) {
  oldPath = resolvePath(oldPath);
  newPath = resolvePath(newPath);
  if (!folderPaths(sources, resources, folders).has(oldPath)) throw new Error('Missing folder');
  if (insideFolder(newPath, oldPath)) throw new Error('Cannot move a folder inside itself');
  validateFolderPath(sources, resources, folders, newPath);
  const remap = (path) =>
    insideFolder(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
  const moves = filePaths(sources, resources).filter((path) => insideFolder(path, oldPath));
  let nextSources = { ...sources },
    nextResources = { ...resources };
  for (const path of moves) {
    const plan = planFileMove(nextSources, nextResources, path, remap(path));
    nextSources = plan.sources;
    nextResources = plan.resources;
  }
  // Also update literal folder prefixes used to construct asset paths.
  for (const [key, text] of Object.entries(nextSources)) {
    if (key.startsWith('__')) continue;
    nextSources[key] = text.replace(/;[^\n]*|"(?:\\.|[^"\\])*"/g, (token) => {
      if (token.startsWith(';')) return token;
      const value = JSON.parse(token);
      const absolute = value.startsWith('/');
      const path = absolute ? value.slice(1) : value;
      return insideFolder(path, oldPath)
        ? JSON.stringify((absolute ? '/' : '') + remap(path))
        : token;
    });
  }
  const persisted = new Set(folders.map(remap));
  for (const [path, keepLeaf] of [
    [oldPath, false],
    [newPath, true],
  ]) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length - (keepLeaf ? 0 : 1); i++)
      persisted.add(parts.slice(0, i).join('/'));
  }
  if (persisted.size > 256) throw new Error('Maximum 256 explicit folders');
  return {
    sources: nextSources,
    resources: nextResources,
    folders: [...persisted],
    moves: moves.map((path) => [path, remap(path)]),
    remap,
  };
}
