import { policy } from './editor-policy.js';
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
export function validateFolderPath(sources, resources, folders, path, editor) {
  path = resolvePath(path);
  return policy(
    'editor-folder-validate',
    [filePaths(sources, resources), [...folderPaths(sources, resources, folders)], folders, path],
    editor,
  );
}
export function planFolderMove(sources, resources, folders, oldPath, newPath, editor) {
  oldPath = resolvePath(oldPath);
  newPath = resolvePath(newPath);
  const plan = policy(
    'editor-folder-move-plan',
    [
      filePaths(sources, resources),
      [...folderPaths(sources, resources, folders)],
      folders,
      oldPath,
      newPath,
    ],
    editor,
  );
  const remap = (path) =>
    insideFolder(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
  const moves = plan.moves.map(([path]) => path);
  let nextSources = { ...sources },
    nextResources = { ...resources };
  for (const path of moves) {
    const plan = planFileMove(nextSources, nextResources, path, remap(path), editor);
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
  return {
    sources: nextSources,
    resources: nextResources,
    folders: plan.folders,
    moves: moves.map((path) => [path, remap(path)]),
    remap,
  };
}
