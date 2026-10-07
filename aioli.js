import { compile } from './engine/compiler.js';
import { bindings as defaults } from './engine/bindings.js';
import { forms } from './engine/forms.js';
import { createGraphics } from './engine/graphics.js';
import { ScenePlayer } from './engine/scenes.js';
import { createInput } from './engine/input.js';
export { formatTrace } from './engine/trace.js';

const owners = new WeakMap();

export class Aioli {
  constructor({ bindings = {}, trace = true, onError = console.error, updateHz = 60,
    maxUpdatesPerFrame = 8 } = {}) {
    this.trace = trace;
    this.onError = onError;
    this.bindings = { ...defaults, ...bindings };
    this.canvas = null;
    this.graphics = null;
    this.destroyed = false;
    this.player = new ScenePlayer({ updateHz, maxUpdatesPerFrame, onError,
      dimensions: () => ({ w: this.canvas?.width ?? 0, h: this.canvas?.height ?? 0 }) });
    this.loadGeneration = 0;
  }

  async attach(canvas) {
    if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
    if (this.canvas) throw new Error('Aioli runtime already has a canvas.');
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('Aioli requires an HTML canvas.');
    if (owners.has(canvas)) throw new Error('Canvas already belongs to an Aioli runtime.');
    owners.set(canvas, this);
    this.canvas = canvas;
    try {
      const graphics = await createGraphics(canvas, this.onError);
      if (this.destroyed) {
        graphics.destroy();
        throw new Error('Aioli runtime was destroyed during initialization.');
      }
      this.graphics = graphics;
      this.input = createInput(canvas, { emit: (name, event) => {
        if (this.inputFailed) return;
        try { this.player.scene?.[name]?.(event); }
        catch (error) { this.inputFailed = true; this.player.stop(); this.onError(error); }
      } });
      this.player.input = this.input;
      this.player.render = (callback, dt, t) => graphics.render(callback, dt, t);
      Object.assign(this.bindings, graphics.bindings);
      Object.assign(this.bindings, this.input.bindings);
      return this;
    } catch (error) {
      if (owners.get(canvas) === this) owners.delete(canvas);
      this.canvas = null;
      throw error;
    }
  }

  compile(source, { trace = this.trace, scene = false } = {}) {
    if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
    if (!this.graphics) throw new Error('Attach a canvas before compiling a program.');
    if (typeof source !== 'string') throw new TypeError('Aioli source must be a string.');
    const program = compile(source, this.bindings, forms, { trace, scene, textRenderer: this.graphics.createText });
    const shaderValues = program.shaders.map(shader => this.graphics.createShader(shader));
    const execute = program.run;
    program.run = () => {
      if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
      return execute(shaderValues);
    };
    return program;
  }

  run(source, options) { return this.compile(source, options).run(); }

  compileScene(source, options) { return this.compile(source, { ...options, scene: true }); }

  activate(program) {
    if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
    if (!program?.scene) throw new TypeError('activate requires a compiled scene');
    const scene = program.run();
    this.inputFailed = false;
    this.loadGeneration++;
    this.graphics.resetScene();
    this.player.replace(scene);
    return scene;
  }

  setScene(source, options) { return this.activate(this.compileScene(source, options)); }

  async load(url, options) {
    const generation = ++this.loadGeneration;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
    const source = await response.text();
    if (generation !== this.loadGeneration || this.destroyed) return;
    return this.setScene(source, options);
  }

  destroy() {
    this.destroyed = true;
    this.loadGeneration++;
    this.input?.destroy();
    try { this.player.replace(null); }
    catch (error) { this.onError(error); }
    const wasAttached = Boolean(this.graphics);
    this.graphics?.destroy();
    this.graphics = null;
    // An in-flight attach retains ownership until initialization settles.
    if (this.canvas && owners.get(this.canvas) === this && wasAttached) {
      owners.delete(this.canvas);
      this.canvas = null;
    }
  }
}
