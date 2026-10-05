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
    beginScope: () => currentDraw()?.scope(),
    endScope: () => currentDraw()?.restore(),
    primitives: {
      'start-scene': startScene,
      'pointer-x': () => pointer().x,
      'pointer-y': () => pointer().y,
      'pointer-down?': () => pointer().down,
      'pointer-pressed?': () => pointer().pressed,
      'screen-width': () => size()[0],
      'screen-height': () => size()[1],
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
    runtime.global['active-scene'] = () => runtime.state['active-scene'] ?? '';
    runtime.drawFrame = (width = 320, height = 240) => {
      frameDraw = new DrawList(width, height);
      try {
        if (typeof runtime.global.draw === 'function') runtime.call('draw');
        return frameDraw;
      } finally {
        frameDraw = null;
      }
    };
    runtime.collectSound = () => {
      patch = [];
      if (typeof runtime.global.sound === 'function') runtime.call('sound');
      return patch;
    };
    return runtime;
  };
  services.create = (state) => services.attach(createRuntime(state, services));
  return services;
}
