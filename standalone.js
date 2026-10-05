import { AudioOutput } from './audio-output.js';
import { canvasSize } from './canvas-size.js';
import {
  launchApplication,
  stageApplication,
  updateApplication,
  drawApplication,
} from './application.js';
import { engineServices } from './engine-services.js';
import { resolvePath } from './module-loader.js';
import { stageScene } from './scenes.js';
import { GPUHost } from './gpu.js';
import { DrawList } from './drawing.js';
import { synthesize } from './audio.js';
import { fitSurface } from './surface-layout.js';

/** The standalone browser host; no editor modules or capabilities are loaded. */
export async function startApplication(project, canvas) {
  const gpu = await GPUHost.create(canvas, (error) => {
    throw new Error(error);
  });
  const keys = new Set(),
    audio = new AudioOutput();
  const pointer = { x: 0, y: 0, down: false, pressed: false };
  const logicalSize = canvasSize(project.settings);
  const surface = () => fitSurface(canvas.clientWidth, canvas.clientHeight, ...logicalSize);
  function movePointer(event) {
    const { origin, scale } = surface();
    const bounds = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - bounds.left - origin[0]) / scale;
    pointer.y = (event.clientY - bounds.top - origin[1]) / scale;
  }
  canvas.addEventListener('pointermove', (event) => {
    movePointer(event);
  });
  canvas.addEventListener('pointerdown', (event) => {
    movePointer(event);
    pointer.down = true;
    pointer.pressed = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', () => {
    pointer.down = false;
  });
  canvas.addEventListener('pointercancel', () => {
    pointer.down = false;
  });
  let runtime,
    scene,
    draw,
    elapsed = 0,
    transitioning = false;
  window.addEventListener('keydown', (event) => {
    keys.add(event.key);
    if (event.key === ' ') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key));
  window.addEventListener('blur', () => {
    keys.clear();
    pointer.down = false;
    pointer.pressed = false;
  });
  const makeRuntime = (state) => {
    let instance;
    const services = engineServices({
      pointer: () => pointer,
      key: (key) => keys.has(key),
      size: () => logicalSize,
      draw: () => draw,
      resource: (path) => project.resources?.[resolvePath(path)]?.data ?? '',
      startScene: (path = '') => {
        if (instance === runtime || instance === scene?.runtime) {
          transition(path).catch(showError);
        } else if (instance) instance.initialScene = path;
      },
      playSound: async (name = 'sound', ...args) => {
        const owner =
          name !== 'sound' && instance.global[name]?.hook?.kind === 'sound'
            ? instance
            : (scene?.runtime ?? runtime);
        const pcm = synthesize(owner.collectSound(name, ...args));
        await audio.play(pcm);
      },
    });
    instance = services.create(state);
    return instance;
  };
  async function transition(path, initial = false) {
    path = path ? resolvePath(path) : '';
    if (transitioning) throw new Error('A scene transition is already pending');
    transitioning = true;
    try {
      const baseline = { ...runtime.state };
      const target = initial ? runtime.state : { ...baseline };
      const staged = stageApplication({
        files: project.files,
        state: target,
        makeRuntime,
        lifecycle: '',
        explicitScene: path,
        previous: initial ? null : { runtime, scene, files: project.files },
        activating: initial,
        root: initial ? runtime : null,
      });
      const root = staged.runtime,
        next = staged.scene;
      const stagedDraw = drawApplication(staged, logicalSize);
      await gpu.preparePixels(stagedDraw);
      for (const [key, value] of Object.entries(runtime.state))
        if (value !== baseline[key] && target[key] === baseline[key]) target[key] = value;
      runtime = root;
      scene = next;
      elapsed = 0;
      document.getElementById('error').textContent = '';
    } finally {
      transitioning = false;
    }
  }
  function showError(error) {
    document.getElementById('error').textContent = error.message;
  }
  runtime = launchApplication({ files: project.files, state: {}, makeRuntime });
  await transition(runtime.initialScene ?? '', true);
  let last = performance.now();
  function frame(now) {
    try {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      updateApplication({ runtime, scene }, dt);
      const { origin, size } = surface();
      draw = new DrawList(canvas.clientWidth, canvas.clientHeight);
      draw.surface(origin, size);
      draw.composite(drawApplication({ runtime, scene }, logicalSize), origin, size);
      gpu.draw(draw, elapsed);
      draw = null;
      pointer.pressed = false;
      requestAnimationFrame(frame);
    } catch (error) {
      showError(error);
    }
  }
  window.aioliApplication = {
    get surface() {
      return surface();
    },
    get runtime() {
      return runtime;
    },
    get scene() {
      return scene;
    },
  };
  requestAnimationFrame(frame);
}
