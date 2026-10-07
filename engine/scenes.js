import { dict } from './data.js';
// Fixed-step simulation; rendering follows the browser's animation frames.
export class ScenePlayer {
  constructor({ updateHz = 60, maxUpdatesPerFrame = 8, onError = console.error,
    requestFrame = callback => globalThis.requestAnimationFrame(callback),
    cancelFrame = id => globalThis.cancelAnimationFrame(id),
    render,
    dimensions = () => ({ w: 0, h: 0 }),
  } = {}) {
    if (typeof updateHz !== 'number' || !Number.isFinite(updateHz) || updateHz <= 0) {
      throw new TypeError('updateHz must be a positive finite number');
    }
    if (!Number.isSafeInteger(maxUpdatesPerFrame) || maxUpdatesPerFrame < 1) {
      throw new TypeError('maxUpdatesPerFrame must be a positive integer');
    }
    this.dt = 1 / updateHz;
    this.maxUpdatesPerFrame = maxUpdatesPerFrame;
    this.onError = onError;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.dimensions = dimensions;
    this.render = render || ((callback, dt, t) => callback?.(this.context(t, dt)));
    this.scene = null;
    this.frameId = null;
    this.generation = 0;
    this.lastTime = null;
    this.accumulator = 0;
    this.elapsed = 0;
    this.updateElapsed = 0;
  }

  context(t, dt) {
    const { w, h } = this.dimensions();
    return dict('t', t, 'dt', dt, 'w', w, 'h', h);
  }

  stop() {
    this.generation++;
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  replace(scene) {
    this.stop();
    const previous = this.scene;
    this.scene = null;
    previous?.detach?.();
    this.input?.reset();
    this.lastTime = null;
    this.accumulator = 0;
    this.elapsed = 0;
    this.updateElapsed = 0;
    if (!scene) return;
    this.scene = scene;
    try { scene.attach?.(); }
    catch (error) {
      this.scene = null;
      try { scene.detach?.(); } catch (cleanupError) { this.onError(cleanupError); }
      throw error;
    }
    if (this.scene === scene) this.schedule();
  }

  schedule() {
    const generation = this.generation;
    this.frameId = this.requestFrame(time => {
      if (generation !== this.generation) return;
      this.frameId = null;
      try { this.frame(time); }
      catch (error) { this.stop(); this.onError(error); return; }
      if (this.scene && generation === this.generation) this.schedule();
    });
  }

  frame(time) {
    const scene = this.scene;
    const generation = this.generation;
    if (!scene) return;
    this.input?.poll();
    if (this.scene !== scene || this.generation !== generation) return;
    const frameDt = this.lastTime === null ? 0 : Math.max(0, (time - this.lastTime) / 1000);
    this.accumulator += frameDt;
    this.elapsed += frameDt;
    this.lastTime = time;
    let updates = 0;
    while (this.accumulator + this.dt * 1e-9 >= this.dt && updates < this.maxUpdatesPerFrame) {
      this.accumulator = Math.max(0, this.accumulator - this.dt);
      this.updateElapsed += this.dt;
      scene.update?.(this.context(this.updateElapsed, this.dt));
      updates++;
      if (this.scene !== scene || this.generation !== generation) return;
    }
    this.render(scene.render, frameDt, this.elapsed);
  }
}
