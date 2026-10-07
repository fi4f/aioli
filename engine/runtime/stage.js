import { dict } from '../language/data.js';
// Fixed-step simulation; rendering follows the browser's animation frames.
export class Stage {
  constructor({ updateHz = 60, ups = updateHz, maxUpdatesPerFrame = 8, onError = console.error,
    requestFrame = callback => globalThis.requestAnimationFrame(callback),
    cancelFrame = id => globalThis.cancelAnimationFrame(id),
    render,
    dimensions = () => ({ w: 0, h: 0 }),
  } = {}) {
    validateUps(ups);
    if (!Number.isSafeInteger(maxUpdatesPerFrame) || maxUpdatesPerFrame < 1) {
      throw new TypeError('maxUpdatesPerFrame must be a positive integer');
    }
    this.ups = ups;
    this.requestedUps = ups;
    this.dt = 1 / ups;
    this.maxUpdatesPerFrame = maxUpdatesPerFrame;
    this.onError = onError;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.dimensions = dimensions;
    this.render = render || ((callback, dt, t) => callback?.(this.context(t, dt)));
    this.scene = null;
    this.attaching = false;
    this.failed = false;
    this.frameId = null;
    this.generation = 0;
    this.lastTime = null;
    this.accumulator = 0;
    this.elapsed = 0;
    this.updateElapsed = 0;
  }

  configureUps(ups) {
    validateUps(ups);
    this.requestedUps = ups;
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
    const detached = previous?.detach?.();
    if (detached?.then) detached.catch(error => this.onError(error));
    this.attaching = false;
    this.failed = false;
    this.input?.reset();
    this.lastTime = null;
    this.accumulator = 0;
    this.elapsed = 0;
    this.updateElapsed = 0;
    if (!scene) return;
    this.scene = scene;
    try {
      const attached = scene.attach?.();
      if (attached?.then) {
        this.attaching = true;
        const generation = this.generation;
        attached.then(() => {
          if (this.scene !== scene || this.generation !== generation) return;
          this.attaching = false; this.schedule();
        }, error => {
          if (this.scene !== scene || this.generation !== generation) return;
          this.attaching = false; this.scene = null; this.stop();
          this.failed = true;
          try { const result = scene.detach?.(); if (result?.then) result.catch(cleanupError => this.onError(cleanupError)); }
          catch (cleanupError) { this.onError(cleanupError); }
          this.onError(error);
        });
      }
    }
    catch (error) {
      this.scene = null;
      try { const result = scene.detach?.(); if (result?.then) result.catch(cleanupError => this.onError(cleanupError)); } catch (cleanupError) { this.onError(cleanupError); }
      throw error;
    }
    if (this.scene === scene && !this.attaching) this.schedule();
  }

  invoke(callback, argument, scene = this.scene) {
    const generation = this.generation;
    const result = callback?.call(scene, argument);
    if (result?.then) result.catch(error => {
      if (this.scene !== scene || this.generation !== generation) return;
      this.failed = true; this.stop(); this.onError(error);
    });
    return result;
  }

  schedule() {
    const generation = this.generation;
    this.frameId = this.requestFrame(time => {
      if (generation !== this.generation) return;
      this.frameId = null;
      try { this.frame(time); }
      catch (error) { this.failed = true; this.stop(); this.onError(error); return; }
      if (this.scene && generation === this.generation) this.schedule();
    });
  }

  frame(time) {
    const scene = this.scene;
    const generation = this.generation;
    if (!scene || this.attaching) return;
    this.ups = this.requestedUps;
    this.dt = 1 / this.ups;
    this.prepare?.();
    if (this.scene !== scene || this.generation !== generation) return;
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
      this.invoke(scene.update, this.context(this.updateElapsed, this.dt), scene);
      updates++;
      if (this.scene !== scene || this.generation !== generation) return;
    }
    this.render(scene.render, frameDt, this.elapsed);
  }
}

export function validateUps(ups) {
  if (typeof ups !== 'number' || !Number.isFinite(ups) || ups <= 0 || !Number.isFinite(1 / ups)) {
    throw new TypeError('ups must be a positive finite number with a finite update interval');
  }
  return ups;
}
