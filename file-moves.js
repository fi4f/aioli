import { resolvePath } from './module-loader.js';
import { sourceKey, sourcePath } from './project.js';
const relative = (from, to) => {
  const base = from.split('/').slice(0, -1),
    target = to.split('/');
  while (base.length && target.length && base[0] === target[0]) {
    base.shift();
    target.shift();
  }
  const path = [...base.map(() => '..'), ...target].join('/');
  return path.startsWith('..') ? path : './' + path;
};
export function planFileMove(sources, resources, oldPath, newPath) {
  oldPath = resolvePath(oldPath);
  newPath = resolvePath(newPath);
  if (['main.lisp', 'game.lisp'].includes(oldPath))
    throw new Error('Keep the application entry filenames');
  if (newPath.startsWith('__')) throw new Error('Names beginning with __ are reserved');
  const oldKey = sourceKey(oldPath),
    newKey = sourceKey(newPath);
  if (!(oldKey in sources) && !(oldPath in resources)) throw new Error('Missing file');
  if (oldPath !== newPath && (newKey in sources || newPath in resources))
    throw new Error('Destination already exists');
  if (oldKey in sources && !newPath.endsWith('.lisp') && !newPath.endsWith('.scene'))
    throw new Error('Source files must end in .lisp');
  const nextSources = { ...sources },
    nextResources = { ...resources };
  if (oldKey in sources) {
    nextSources[newKey] = nextSources[oldKey];
    if (oldKey !== newKey) delete nextSources[oldKey];
  } else {
    nextResources[newPath] = nextResources[oldPath];
    if (oldPath !== newPath) delete nextResources[oldPath];
  }
  for (const [key, text] of Object.entries(nextSources)) {
    if (key.startsWith('__')) continue;
    const current = sourcePath(key),
      previous = current === newPath ? oldPath : current;
    nextSources[key] = text.replace(/;[^\n]*|"(?:\\.|[^"\\])*"/g, (token, offset) => {
      if (token.startsWith(';')) return token;
      let value;
      try {
        value = JSON.parse(token);
      } catch {
        return token;
      }
      if (/\(\s*import\s*$/.test(text.slice(0, offset).replace(/;[^\n]*/g, ''))) {
        let target;
        try {
          target = resolvePath(value, previous);
        } catch {
          return token;
        }
        if (target === oldPath) target = newPath;
        return JSON.stringify(value.startsWith('/') ? '/' + target : relative(current, target));
      }
      return value === oldPath
        ? JSON.stringify(newPath)
        : value === '/' + oldPath
          ? JSON.stringify('/' + newPath)
          : token;
    });
  }
  return { sources: nextSources, resources: nextResources, oldKey, newKey, oldPath, newPath };
}
