const entries = { main: 'main.lisp', game: 'game.lisp' };
export const sourcePath = (key) => entries[key] ?? key;
export const sourceKey = (path) => ({ 'main.lisp': 'main', 'game.lisp': 'game' })[path] ?? path;
