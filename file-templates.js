/** Editor conveniences; the runtime still loads explicitly named modules. */
export function newFilePath(path, type = 'script') {
  if (typeof path !== 'string') throw new Error('Enter a file name');
  if (!path.trim()) return '';
  if (type === 'none') return path.trim();
  const suffix = {
    script: '.lisp',
    scene: '.scene.lisp',
    generator: '.generator.lisp',
    command: '.command.lisp',
  }[type];
  if (!suffix) throw new Error('Unknown file type');
  return path.trim().replace(/(?:\.(?:scene|generator|command))?\.lisp$/, '') + suffix;
}
export function newFileCode(type = 'script', output = 'image') {
  if (type === 'none') return '';
  if (type === 'script') return '; Ordinary Lisp module. Import it where needed.\n';
  if (type === 'command')
    return '; Runs in the editor. get/set! access editor state.\n; Use game-get/game-set! to access the active game or scene.\n';
  if (type === 'scene')
    return `(init! :radius 32 ["Radius" 1 120 1])
(defpixel render [p time]
  (background "#101613")
  (fill "#bbd6a6")
  (circle [160 120] (param :radius)))
`;
  if (type === 'generator' && output === 'image')
    return `(generator :image "New image")
(init! :radius 32 ["Radius" 1 120 1])
(defpixel image [p time]
  (background "#101613")
  (fill "#bbd6a6")
  (circle [160 120] (param :radius)))
`;
  if (type === 'generator' && output === 'audio')
    return `(generator :audio "New sound")
(init! :pitch 440 ["Pitch" 40 2000 1])
(init! :duration 0.3 ["Seconds" 0.05 2 0.01])
(init! :gain 0.35 ["Gain" 0 1 0.01])
(defn generate-sound []
  (voice :sine (get :pitch) (get :pitch) (get :duration) (get :gain)))
`;
  if (type === 'generator' && output === 'text')
    return `(generator :text "New text" "generated.txt")
(init! :text-message "Hello world" ["Message"])
(defn generate-text [] (str (get :text-message) "\\n"))
`;
  throw new Error('Unknown file type or generator output');
}
