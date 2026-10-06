import { pixelBlock } from './pixel-block.js';
import { DrawList } from './drawing.js';
import { createRuntime } from './lisp.js';
import { validateVoice } from './audio.js';

/** Browser/engine capabilities, independent of the editor and file conventions. */
export function engineServices({
  key = () => false,
  startScene = () => {},
  playSound = () => {},
  pointer = () => ({ x: 0, y: 0, down: false, pressed: false }),
  size = () => [320, 240],
  resource = () => '',
  draw = () => null,
} = {}) {
  let patch = [],
    frameDraw;
  const currentDraw = () => frameDraw ?? draw();
  const services = {
    budget: 100000,
    key,
    voice: (...args) => {
      if (patch.length >= 16) throw new Error('Maximum 16 voices');
      patch.push(validateVoice(...args));
    },
    playSound,
    pixels: (args, env, evaluate) => {
      const list = currentDraw();
      if (!list) throw new Error('pixels requires a draw hook');
      list.pixels(pixelBlock(args, env, evaluate));
    },
    beginScope: () => currentDraw()?.scope(),
    endScope: () => currentDraw()?.restore(),
    primitives: {
      'start-scene': startScene,
      'pointer-x': () => pointer().x,
      'pointer-y': () => pointer().y,
      'pointer-down?': () => pointer().down,
      'pointer-pressed?': () => pointer().pressed,
      'canvas-width': () => frameDraw?.width ?? size()[0],
      'canvas-height': () => frameDraw?.height ?? size()[1],
      'screen-width': () => frameDraw?.width ?? size()[0],
      'screen-height': () => frameDraw?.height ?? size()[1],
      'resource-url': resource,
      ...Object.fromEntries(
        [
          'background',
          'fill',
          'rect',
          'circle',
          'line',
          'text',
          'clip',
          'translate',
          'scale',
          'opacity',
          'blend',
        ].map((name) => [
          name,
          (...args) => {
            const list = currentDraw();
            if (!list) throw new Error(`${name} requires a draw hook`);
            return list.primitives()[name](...args);
          },
        ]),
      ),
    },
  };
  services.attach = (runtime) => {
    runtime.global['active-scene'] ??= () => runtime.state['active-scene'] ?? '';
    runtime.drawFrame = (width = size()[0], height = size()[1], name = null, args = []) => {
      name ??= 'render';
      const previous = frameDraw;
      frameDraw = new DrawList(width, height);
      try {
        if (typeof runtime.global[name] === 'function') runtime.call(name, ...args);
        return frameDraw;
      } finally {
        frameDraw = previous;
      }
    };
    runtime.collectSound = (name = 'sound', ...args) =>
      services.collectSound(runtime, name, args, name !== 'sound');
    return runtime;
  };
  services.collectSound = (runtime, name, args = [], requireHook = false) => {
    patch = [];
    if (requireHook && runtime.global[name]?.hook?.kind !== 'sound')
      throw new Error(`Missing sound hook ${name}`);
    if (typeof runtime.global[name] === 'function') runtime.call(name, ...args);
    return patch;
  };
  services.create = (state) => services.attach(createRuntime(state, services));
  return services;
}
