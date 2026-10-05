/** main.lisp is the application entry; other roles use filename suffixes. */
export function sourceRole(path) {
  if (typeof path !== 'string') return 'module';
  if (path === 'main.lisp') return 'app';
  return (
    /\.(command|generator|scene)\.lisp$/.exec(path)?.[1] ??
    (path.endsWith('.scene') ? 'scene' : 'module')
  );
}

export const roleSuffixes = {
  app: 'main.lisp',
  command: '.command.lisp',
  generator: '.generator.lisp',
  scene: '.scene.lisp',
};
