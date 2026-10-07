import { compile } from '../compiler/compiler.js';
import { bindings as defaults } from '../language/bindings.js';
import { forms } from '../compiler/forms.js';
import { createGraphics } from '../browser/graphics.js';
import { Stage } from './stage.js';
import { createInput } from '../browser/input.js';
import { createInnerCanvas, validateInnerOptions } from '../browser/inner-canvas.js';
import { ModuleLoader } from './modules.js';
import { registerPromise } from '../language/promises.js';
import { dict, get } from '../language/data.js';
import { createTextProxy } from '../browser/text-proxy.js';
import { formatTrace } from '../language/trace.js';
import { tokenize } from '../compiler/tokenize.js';
export { formatTrace } from '../language/trace.js';

const owners = new WeakMap();

export class Aioli {
  constructor({ bindings = {}, trace = true, onError = console.error, updateHz = 60, ups = updateHz,
    maxUpdatesPerFrame = 8, innerCanvas = {}, baseURL = globalThis.document?.baseURI ?? new URL('../../aioli.js', import.meta.url).href,
    fetch: fetchSource } = {}) {
    this.trace = trace;
    this.onError = onError;
    this.bindings = { ...defaults, ...bindings };
    this.textProxies = new Set();
    this.context = dict('source', '', 'source-url', '', 'state', dict(), 'tokenize', tokenize,
      'reload', source => this.reload(source, get(this.context, 'source-url')));
    this.bindings.aioli = this.context;
    this.outerCanvas = null;
    this.graphics = null;
    this.destroyed = false;
    this.innerOptions = validateInnerOptions(innerCanvas);
    this.stage = new Stage({ ups, maxUpdatesPerFrame, onError,
      dimensions: () => ({ w: this.display?.innerCanvas.width ?? 0, h: this.display?.innerCanvas.height ?? 0 }) });
    this.loadGeneration = 0;
    this.modules = new ModuleLoader({ baseURL, fetch: fetchSource,
      compile: (source, options) => this.compile(source, options), alive: () => !this.destroyed });
  }

  async attach(outerCanvas) {
    if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
    if (this.outerCanvas) throw new Error('Aioli runtime already has a canvas.');
    if (!(outerCanvas instanceof HTMLCanvasElement)) throw new TypeError('Aioli requires an HTML canvas.');
    if (owners.has(outerCanvas)) throw new Error('Canvas already belongs to an Aioli runtime.');
    owners.set(outerCanvas, this);
    this.outerCanvas = outerCanvas;
    try {
      const display = createInnerCanvas(outerCanvas, this.innerOptions, { updateRate: this.stage,
        onError: this.onError,
        onResize: event => {
          if (!this.stage.attaching) this.stage.invoke(this.stage.scene?.resize, event);
        } });
      this.display = display;
      this.syncInnerCanvas = limit => {
        const event = display.sync(limit);
        if (event && !this.stage.attaching) this.stage.invoke(this.stage.scene?.resize, event);
      };
      const graphics = await createGraphics(display.innerCanvas, this.onError, { prepare: limit => this.syncInnerCanvas(limit), present: () => display.paint() });
      if (this.destroyed) {
        graphics.destroy();
        throw new Error('Aioli runtime was destroyed during initialization.');
      }
      this.graphics = graphics;
      this.input = createInput(outerCanvas, { coordinates: (x, y) => display.toInner(x, y), emit: (name, event) => {
        if (this.inputFailed || this.stage.failed || this.stage.attaching) return;
        try { this.stage.invoke(this.stage.scene?.[name], event); }
        catch (error) { this.inputFailed = true; this.stage.stop(); this.onError(error); }
      } });
      this.stage.input = this.input;
      this.stage.prepare = () => this.syncInnerCanvas();
      this.stage.render = (callback, dt, t) => {
        const scene = this.stage.scene;
        return graphics.render(context => { if (this.stage.scene === scene) this.stage.invoke(callback, context, scene); }, dt, t);
      };
      Object.assign(this.bindings, graphics.bindings);
      Object.assign(this.bindings, this.input.bindings);
      Object.assign(this.bindings, display.bindings);
      this.bindings['text-proxy'] = callback => {
        const proxy = createTextProxy(outerCanvas, callback, { toOuter: (x, y) => display.toOuter(x, y) });
        this.textProxies.add(proxy);
        const dispose = get(proxy, 'dispose');
        proxy.values.dispose = () => { dispose(); this.textProxies.delete(proxy); };
        return proxy;
      };
      return this;
    } catch (error) {
      if (owners.get(outerCanvas) === this) owners.delete(outerCanvas);
      this.outerCanvas = null;
      this.display?.destroy();
      this.display = null;
      throw error;
    }
  }

  compile(source, { trace = this.trace, scene = false, module = false, sourceURL } = {}) {
    if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
    if (!this.graphics) throw new Error('Attach a canvas before compiling a program.');
    if (typeof source !== 'string') throw new TypeError('Aioli source must be a string.');
    const hasSourceURL = sourceURL !== undefined;
    sourceURL = this.modules.resolve(sourceURL ?? this.modules.baseURL);
    const traceURL = hasSourceURL ? sourceURL : undefined;
    const resourceBindings = {
      aioli: scene ? dict('source', source, 'source-url', sourceURL, 'state', get(this.context, 'state'), 'tokenize', tokenize,
        'reload', replacement => this.reload(replacement, sourceURL)) : this.context,
      import: (...args) => {
        if (args.length !== 1) return registerPromise(Promise.reject(new TypeError('import expects one path')));
        return this.modules.import(args[0], sourceURL);
      },
      'set-scene': (...args) => {
        if (args.length !== 1) return registerPromise(Promise.reject(new TypeError('set-scene expects one path')));
        return registerPromise(this.load(args[0], { sourceURL }));
      },
    };
    let program;
    try {
      program = compile(source, { ...this.bindings, ...resourceBindings }, forms,
        { trace, scene, module, sourceURL: traceURL, textRenderer: this.graphics.createText });
    } catch (error) {
      if (error instanceof Error && error.lisp && !error.lisp.sourceURL) error.lisp.sourceURL = traceURL;
      throw error;
    }
    program.sourceURL = sourceURL;
    program.source = source;
    const shaderValues = program.shaders.map(shader => this.graphics.createShader(shader));
    const execute = program.run;
    program.run = () => {
      if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
      return execute(shaderValues);
    };
    return program;
  }

  run(source, options) { return this.compile(source, options).run(); }

  configureInnerCanvas(options) {
    if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
    if (this.display) return this.display.configure(options);
    this.innerOptions = validateInnerOptions(options, this.innerOptions);
  }

  compileScene(source, options) { return this.compile(source, { ...options, scene: true }); }

  reload(source, sourceURL) {
    return registerPromise(Promise.resolve().then(async () => {
      // Also supersede pending initialization when the next draft fails to compile.
      const generation = ++this.loadGeneration;
      if (this.reloadPreparation) {
        const preparation = this.reloadPreparation;
        this.reloadPreparation = null;
        preparation.dispose();
        this.stage.replace(preparation.previous);
      }
      // Untraced applications keep the ordinary execution/failure behavior.
      if (!this.trace) return this.setScene(source, { sourceURL });
      const program = this.compileScene(source, { sourceURL });
      const scene = await program.run();
      if (generation !== this.loadGeneration || this.destroyed) return;
      const previous = this.stage.scene;
      let attached = false;
      const disposeCandidate = () => {
        if (!attached) return;
        attached = false;
        try { const result = scene.detach?.(); if (result?.then) result.catch(this.onError); }
        catch (error) { this.onError(error); }
      };
      const preparation = { previous, dispose: disposeCandidate };
      this.reloadPreparation = preparation;
      this.stage.stop();
      this.stage.attaching = true;
      try {
        attached = true;
        await scene.attach?.();
        if (generation !== this.loadGeneration || this.destroyed) {
          disposeCandidate();
          if (this.reloadPreparation === preparation) {
            this.reloadPreparation = null;
            if (!this.destroyed && this.stage.scene === previous) this.stage.replace(previous);
          }
          return;
        }
        // Exercise render-time expressions while the working scene is retained.
        // Graphics discards failed command recording and preserves its last image.
        this.graphics.render(context => scene.render?.(context), 0, 0);
        this.reloadPreparation = null;
        this.graphics.resetScene();
        const attach = scene.attach;
        scene.attach = undefined;
        try { this.stage.replace(scene); }
        finally { scene.attach = attach; }
        this.context.values.source = program.source;
        this.context.values['source-url'] = program.sourceURL;
        this.inputFailed = false;
        return scene;
      } catch (error) {
        disposeCandidate();
        if (this.reloadPreparation === preparation) this.reloadPreparation = null;
        if (generation !== this.loadGeneration || this.destroyed) return;
        this.stage.replace(previous);
        throw error;
      }
    }).catch(error => {
      const diagnostic = new Error(formatTrace(error));
      diagnostic.name = error.name ?? 'Error';
      throw diagnostic;
    }));
  }

  activate(program) {
    if (this.destroyed) throw new Error('Aioli runtime has been destroyed.');
    if (!program?.scene) throw new TypeError('activate requires a compiled scene');
    const generation = ++this.loadGeneration;
    const finish = scene => {
      if (generation !== this.loadGeneration || this.destroyed) return;
      this.inputFailed = false;
      this.graphics.resetScene();
      this.context.values.source = program.source;
      this.context.values['source-url'] = program.sourceURL;
      this.stage.replace(scene);
      return scene;
    };
    const result = program.run();
    return result instanceof Promise ? result.then(finish) : finish(result);
  }

  setScene(source, options) { return this.activate(this.compileScene(source, options)); }

  async load(path, options = {}) {
    const generation = ++this.loadGeneration;
    const url = this.modules.resolve(path, options.sourceURL ?? this.modules.baseURL);
    const source = await this.modules.read(url);
    if (generation !== this.loadGeneration || this.destroyed) return;
    return this.setScene(source, { ...options, sourceURL: url });
  }

  destroy() {
    this.destroyed = true;
    this.modules.cache.clear();
    this.loadGeneration++;
    this.input?.destroy();
    for (const proxy of [...this.textProxies]) get(proxy, 'dispose')();
    try { this.stage.replace(null); }
    catch (error) { this.onError(error); }
    const wasAttached = Boolean(this.graphics);
    this.graphics?.destroy();
    this.display?.destroy();
    this.graphics = null;
    this.display = null;
    this.stage.prepare = null;
    // An in-flight attach retains ownership until initialization settles.
    if (this.outerCanvas && owners.get(this.outerCanvas) === this && wasAttached) {
      owners.delete(this.outerCanvas);
      this.outerCanvas = null;
    }
  }
}
