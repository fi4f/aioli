import { Compiler } from './compiler.js';
import { Bindings } from './bindings.js';
import { Forms } from './forms.js';
import { Graphics } from './graphics.js';
import { Scheduler } from './scheduler.js';
import { Input } from './input.js';
import { InnerCanvas } from './inner-canvas.js';
import { Modules } from './modules.js';
import { Promises } from './promises.js';
import { Data } from './data.js';
import { TextProxy } from './text-proxy.js';
import { Trace } from './trace.js';
import { Tokenizer } from './tokenize.js';
import { SceneMemory } from './scene-memory.js';

const __owners__ = new WeakMap();

function __appData__({
  bindings = {},
  trace = true,
  onError = console.error,
  updateHz = 60,
  ups = updateHz,
  maxUpdatesPerFrame = 8,
  innerCanvas = {},
  baseURL = globalThis.document?.baseURI ?? new URL('./hg.js', import.meta.url).href,
  fetch: fetchSource,
} = {}) {
  const app = {};
  app.services = { graphics: Graphics, input: Input, display: InnerCanvas };
  app.trace = trace;
  app.onError = onError;
  app.bindings = { ...Bindings, ...bindings };
  app.textProxies = new Set();
  app.__tokenizer__ = Tokenizer.new();
  app.outerCanvas = null;
  app.graphics = null;
  app.source = '';
  app.sourceURL = '';
  app.state = Data.dict();
  app.__reflection__ = SceneMemory.reflection();
  app.destroyed = false;
  __innerOptions__(app, app.services.display.validateInnerOptions(innerCanvas));
  Object.assign(
    app,
    Scheduler.new({
      ups,
      maxUpdatesPerFrame,
      onError,
      services: app.services,
      prepare: (target) => AppCore.syncInnerCanvas(target),
    }),
  );
  app.loadGeneration = 0;
  app.modules = Modules.new({
    baseURL,
    fetch: fetchSource,
    compile: (source, options) => AppCore.compileModule(app, source, options),
    execute: (program) => AppCore.executeModule(app, program),
    alive: () => !app.destroyed,
  });
  app.bindings.App = App;
  app.bindings.TextProxy = Data.registerHostData(TextProxy);
  return Data.registerHostData(app);
}

export const AppCore = {
  async attach(app, outerCanvas) {
    if (app.destroyed) throw new Error('Mercury runtime has been destroyed.');
    if (app.outerCanvas) throw new Error('Mercury runtime already has a canvas.');
    const Canvas = outerCanvas?.ownerDocument?.defaultView?.HTMLCanvasElement;
    if (!Canvas || !(outerCanvas instanceof Canvas))
      throw new TypeError('Mercury requires an HTML canvas.');
    if (__owners__.has(outerCanvas)) throw new Error('Canvas already belongs to a Mercury app.');
    __owners__.set(outerCanvas, app);
    app.outerCanvas = outerCanvas;
    try {
      const display = app.services.display.new(outerCanvas, app.innerOptions, {
        updateRate: app,
        outerSize:
          app.ownedCanvas === outerCanvas
            ? app.services.display.displaySize
            : app.services.display.bitmapSize,
        onError: app.onError,
        onConfigure: (options, patch) => {
          app.innerOptions = { ...options };
          if (Object.hasOwn(patch, 'width')) app.w = options.width;
          if (Object.hasOwn(patch, 'height')) app.h = options.height;
          if (Object.hasOwn(patch, 'scaleStep')) app.si = options.scaleStep;
          if (Object.hasOwn(patch, 'imageSmoothing')) app.is = options.imageSmoothing;
        },
        onResize: (event) => {
          if (!app.attaching) Scheduler.invoke(app, app.scene?.resize, event);
        },
      });
      app.display = display;
      const graphics = await app.services.graphics.new(display.innerCanvas, app.onError, {
        prepare: (limit) => AppCore.syncInnerCanvas(app, limit),
        present: () => app.services.display.paint(display),
        needsPresent: () => app.services.display.needsPresent(display),
      });
      if (app.destroyed) {
        app.services.graphics.destroy(graphics);
        throw new Error('Mercury runtime was destroyed during initialization.');
      }
      app.graphics = graphics;
      app.input = app.services.input.new(outerCanvas, {
        coordinates: (x, y) => app.services.display.toInner(display, x, y),
        emit: (name, event) => {
          if (app.inputFailed || app.failed || app.attaching) return;
          try {
            Scheduler.invoke(app, app.scene?.[name], event);
            Scheduler.requestRender(app);
          } catch (error) {
            app.inputFailed = true;
            Scheduler.stop(app);
            app.onError(error);
          }
        },
      });
      Object.assign(app.bindings, graphics.bindings);
      Object.assign(app.bindings, app.input.bindings);
      Object.assign(app.bindings, display.bindings);
      app.bindings['text-proxy'] = (callback) => {
        const proxy = TextProxy.new(
          outerCanvas,
          (edit) => {
            const result = callback(edit);
            Scheduler.requestRender(app);
            return result;
          },
          {
            toOuter: (x, y) => app.services.display.toOuter(display, x, y),
            onEdit: (edit) => Tokenizer.noteEdit(app.__tokenizer__, edit),
          },
        );
        app.textProxies.add(proxy);
        proxy.__onDispose__ = () => app.textProxies.delete(proxy);
        return proxy;
      };
      return app;
    } catch (error) {
      if (__owners__.get(outerCanvas) === app) __owners__.delete(outerCanvas);
      app.outerCanvas = null;
      app.display == null ? undefined : app.services.display.destroy(app.display);
      app.display = null;
      throw error;
    }
  },

  compile(app, source, options) {
    return __compileApp__(app, source, Compiler.compile, options);
  },
  compileModule(app, source, options) {
    return __compileApp__(app, source, Compiler.compileModule, options);
  },
  executeModule(app, program) {
    if (app.destroyed) throw new Error('Mercury runtime has been destroyed.');
    return Compiler.run(program, program.__shaderValues__);
  },
  execute(app, program, previousScene) {
    if (app.destroyed) throw new Error('Mercury runtime has been destroyed.');
    const previous = app.source,
      previousURL = app.sourceURL,
      generation = app.loadGeneration;
    app.source = program.source;
    app.sourceURL = program.sourceURL;
    const restore = () => {
      if (generation === app.loadGeneration) {
        app.source = previous;
        app.sourceURL = previousURL;
      }
    };
    try {
      const result = Compiler.run(program, program.__shaderValues__, previousScene);
      if (result?.then) return result.finally(restore);
      restore();
      return result;
    } catch (error) {
      restore();
      throw error;
    }
  },
  run(app, source, options) {
    return AppCore.execute(app, AppCore.compile(app, source, options));
  },
  executePatch(app, program) {
    // Pause callbacks while new bindings initialize, including across awaits.
    const previous = app.scene;
    const generation = app.loadGeneration;
    const preparation = { previous, dispose() {} };
    app.reloadPreparation = preparation;
    Scheduler.stop(app);
    app.attaching = true;
    const failed = (error) => {
      if (app.reloadPreparation === preparation) {
        app.reloadPreparation = null;
        if (!app.destroyed && generation === app.loadGeneration) Scheduler.replace(app, previous);
      }
      throw error;
    };
    try {
      const result = AppCore.execute(app, program, previous);
      return result?.then ? result.catch(failed) : result;
    } catch (error) {
      return failed(error);
    }
  },

  configureInnerCanvas(app, options) {
    if (app.destroyed) throw new Error('Mercury runtime has been destroyed.');
    const next = app.services.display.validateInnerOptions(options, app.innerOptions);
    const result =
      app.display == null ? undefined : app.services.display.configure(app.display, options);
    __innerOptions__(app, next);
    return result;
  },

  syncInnerCanvas(app, limit) {
    const options = {
      width: app.w,
      height: app.h,
      scaleStep: app.si,
      imageSmoothing: app.is,
    };
    if (
      app.w !== app.innerOptions.width ||
      app.h !== app.innerOptions.height ||
      app.si !== app.innerOptions.scaleStep ||
      app.is !== app.innerOptions.imageSmoothing
    )
      AppCore.configureInnerCanvas(app, options);
    const event = app.services.display.sync(app.display, limit);
    if (event && !app.attaching) Scheduler.invoke(app, app.scene?.resize, event);
  },

  compileScene(app, source, options) {
    return __compileApp__(app, source, Compiler.compileScene, options);
  },

  patch(app, source, sourceURL) {
    return AppCore.reload(app, source, sourceURL, AppCore.executePatch, SceneMemory.patch);
  },

  cancelPreparation(app) {
    const preparation = app.reloadPreparation;
    if (!preparation) return;
    app.reloadPreparation = null;
    preparation.dispose();
    Scheduler.replace(app, preparation.previous);
  },

  reload(
    app,
    source,
    sourceURL,
    executeScene = AppCore.execute,
    commitBindings = SceneMemory.serve,
  ) {
    return Promises.registerPromise(
      Promise.resolve()
        .then(async () => {
          // Also supersede pending initialization when the next draft fails to compile.
          const generation = ++app.loadGeneration;
          AppCore.cancelPreparation(app);
          // Untraced applications keep the ordinary execution/failure behavior.
          const program = AppCore.compileScene(app, source, { sourceURL });
          const scene = await executeScene(app, program);
          if (generation !== app.loadGeneration || app.destroyed) return;
          if (!app.trace) {
            app.reloadPreparation = null;
            app.services.graphics.resetScene(app.graphics);
            Scheduler.replace(app, scene);
            if (generation !== app.loadGeneration || app.destroyed || app.scene !== scene) return;
            commitBindings(app.__reflection__, scene);
            app.source = program.source;
            app.sourceURL = program.sourceURL;
            app.inputFailed = false;
            return scene;
          }
          const previous = app.scene;
          let attached = false;
          const disposeCandidate = () => {
            if (!attached) return;
            attached = false;
            try {
              const result = scene.detach?.();
              if (result?.then) result.catch(app.onError);
            } catch (error) {
              app.onError(error);
            }
          };
          const preparation = { previous, dispose: disposeCandidate };
          app.reloadPreparation = preparation;
          Scheduler.stop(app);
          app.attaching = true;
          try {
            attached = true;
            await scene.attach?.();
            if (generation !== app.loadGeneration || app.destroyed) {
              disposeCandidate();
              if (app.reloadPreparation === preparation) {
                app.reloadPreparation = null;
                if (!app.destroyed && app.scene === previous) Scheduler.replace(app, previous);
              }
              return;
            }
            // Exercise render-time expressions while the working scene is retained.
            // Graphics discards failed command recording and preserves its last image.
            app.services.graphics.render(app.graphics, (context) => scene.render?.(context), 0, 0);
            if (generation !== app.loadGeneration || app.destroyed) {
              disposeCandidate();
              if (app.reloadPreparation === preparation) {
                app.reloadPreparation = null;
                if (!app.destroyed && app.scene === previous) Scheduler.replace(app, previous);
              }
              return;
            }
            app.reloadPreparation = null;
            app.services.graphics.resetScene(app.graphics);
            const attach = scene.attach;
            scene.attach = undefined;
            try {
              Scheduler.replace(app, scene);
              if (generation !== app.loadGeneration || app.destroyed || app.scene !== scene) return;
              commitBindings(app.__reflection__, scene);
            } finally {
              scene.attach = attach;
            }
            app.source = program.source;
            app.sourceURL = program.sourceURL;
            app.inputFailed = false;
            return scene;
          } catch (error) {
            disposeCandidate();
            if (app.reloadPreparation === preparation) app.reloadPreparation = null;
            if (generation !== app.loadGeneration || app.destroyed) return;
            Scheduler.replace(app, previous);
            throw error;
          }
        })
        .catch((error) => {
          const diagnostic = new Error(Trace.formatTrace(error));
          diagnostic.name = error.name ?? 'Error';
          throw diagnostic;
        }),
    );
  },

  activate(app, program) {
    if (app.destroyed) throw new Error('Mercury runtime has been destroyed.');
    if (!program?.scene) throw new TypeError('activate requires a compiled scene');
    AppCore.cancelPreparation(app);
    const generation = ++app.loadGeneration;
    const finish = (scene) => {
      if (generation !== app.loadGeneration || app.destroyed) return;
      app.inputFailed = false;
      app.services.graphics.resetScene(app.graphics);
      app.source = program.source;
      app.sourceURL = program.sourceURL;
      Scheduler.replace(app, scene);
      if (generation !== app.loadGeneration || app.destroyed || app.scene !== scene) return;
      SceneMemory.serve(app.__reflection__, scene);
      return scene;
    };
    const result = AppCore.execute(app, program);
    return result instanceof Promise ? result.then(finish) : finish(result);
  },

  setScene(app, source, options) {
    return AppCore.activate(app, AppCore.compileScene(app, source, options));
  },

  async load(app, path, options = {}) {
    AppCore.cancelPreparation(app);
    const generation = ++app.loadGeneration;
    const url = Modules.resolve(app.modules, path, options.sourceURL ?? app.modules.baseURL);
    const source = await Modules.read(app.modules, url);
    if (generation !== app.loadGeneration || app.destroyed) return;
    return AppCore.setScene(app, source, { ...options, sourceURL: url });
  },

  destroy(app) {
    if (app.destroyed) return;
    app.destroyed = true;
    SceneMemory.clear(app.__reflection__);
    const preparation = app.reloadPreparation;
    app.reloadPreparation = null;
    preparation?.dispose();
    app.modules.cache.clear();
    app.loadGeneration++;
    app.input == null ? undefined : app.services.input.destroy(app.input);
    for (const proxy of [...app.textProxies]) TextProxy.dispose(proxy);
    try {
      Scheduler.replace(app, null);
    } catch (error) {
      app.onError(error);
    }
    const wasAttached = Boolean(app.graphics);
    app.graphics == null ? undefined : app.services.graphics.destroy(app.graphics);
    app.display == null ? undefined : app.services.display.destroy(app.display);
    app.graphics = null;
    app.display = null;
    // An in-flight attach retains ownership until initialization settles.
    if (app.outerCanvas && __owners__.get(app.outerCanvas) === app && wasAttached) {
      __owners__.delete(app.outerCanvas);
      app.outerCanvas = null;
    }
    app.ownedCanvas?.remove();
  },
  new: __appData__,
};

// Public operations take ordinary app data explicitly. Readiness is per app.
export const App = Data.registerHostData({
  new(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new TypeError('App.new expects options');
    const { c = null, w = null, h = null, si = null, is = false, ups = 60, trace = true } = options;
    for (const key of Object.keys(options))
      if (!['c', 'w', 'h', 'si', 'is', 'ups', 'trace'].includes(key))
        throw new TypeError(`Unknown App option: ${key}`);
    const app = __appData__({
      ups,
      trace,
      innerCanvas: { width: w, height: h, scaleStep: si, imageSmoothing: is },
    });
    let canvas = c;
    if (typeof canvas === 'string') {
      canvas = globalThis.document?.getElementById(canvas);
      if (!canvas) throw new TypeError(`Canvas element not found: ${c}`);
    } else if (canvas?.canvas) {
      if (canvas.canvas.getContext('2d') !== canvas)
        throw new TypeError('c expects a 2D canvas context');
      canvas = canvas.canvas;
    }
    if (canvas == null) {
      if (!globalThis.document?.body)
        throw new Error('A browser document body is required for default presentation');
      canvas = document.createElement('canvas');
      canvas.style.cssText =
        'position:fixed;left:0;top:0;width:100dvw;height:100dvh;background:black;';
      document.body.append(canvas);
      app.ownedCanvas = canvas;
    }
    app.ready = Promises.registerPromise(
      AppCore.attach(app, canvas).catch((error) => {
        app.initializationError = error;
        app.ownedCanvas?.remove();
        throw error;
      }),
    );
    app.ready.catch(() => {});
    return app;
  },
  serve(app, source, options = {}) {
    return __sourceRequest__(app, source, options, AppCore.reload, 'serve');
  },
  patch(app, source, options = {}) {
    return __sourceRequest__(app, source, options, AppCore.patch, 'patch');
  },
  inspect(app) {
    if (arguments.length !== 1) throw new TypeError('App.inspect expects exactly one app');
    return SceneMemory.inspect(__reflection__(app, 'inspect'));
  },
  read(app, reference) {
    if (arguments.length !== 2)
      throw new TypeError('App.read expects an app and binding reference');
    return SceneMemory.read(__reflection__(app, 'read'), reference);
  },
  write(app, reference, value) {
    if (arguments.length !== 3)
      throw new TypeError('App.write expects an app, binding reference, and value');
    return SceneMemory.write(__reflection__(app, 'write'), reference, value);
  },
  call(app, reference, args) {
    if (arguments.length !== 3)
      throw new TypeError('App.call expects an app, binding reference, and argument list');
    return SceneMemory.call(__reflection__(app, 'call'), reference, args);
  },
  exec(app, source) {
    if (arguments.length !== 2) throw new TypeError('App.exec expects an app and source text');
    const reflection = __reflection__(app, 'exec');
    if (app.attaching) throw new TypeError('App.exec requires a scene that is not attaching');
    const scene = app.scene;
    const memory = SceneMemory.execution(
      reflection,
      () => !app.destroyed && !app.attaching && app.scene === scene,
    );
    const program = __compileApp__(app, source, Compiler.compileExec, {
      sourceURL: SceneMemory.sourceURL(scene) ?? (app.sourceURL || undefined),
      environment: SceneMemory.environment(scene),
    });
    return Compiler.runExec(program, program.__shaderValues__, memory);
  },
  pause(app) {
    if (arguments.length !== 1) throw new TypeError('App.pause expects exactly one app');
    __requireApp__(app, 'pause');
    Scheduler.pause(app);
    return app;
  },
  start(app) {
    if (arguments.length !== 1) throw new TypeError('App.start expects exactly one app');
    __requireApp__(app, 'start');
    if (app.failed || app.inputFailed)
      throw new Error('Cannot start an app stopped by a runtime failure');
    Scheduler.start(app);
    return app;
  },
  dispose(app) {
    if (!__isApp__(app)) throw new TypeError('App.dispose expects app data');
    AppCore.destroy(app);
  },
  tokenize(app, source) {
    if (!__isApp__(app) || app.destroyed) throw new TypeError('App.tokenize expects a live app');
    return Tokenizer.tokenizeWith(app.__tokenizer__, source);
  },
});

function __isApp__(value) {
  return value?.modules?.cache instanceof Map && value?.textProxies instanceof Set;
}

function __requireApp__(app, operation) {
  if (!__isApp__(app) || app.destroyed) throw new TypeError(`App.${operation} expects a live app`);
}

function __reflection__(app, operation) {
  __requireApp__(app, operation);
  if (app.__reflection__.scene && app.__reflection__.scene !== app.scene)
    throw new TypeError('The reflected scene is no longer active');
  return app.__reflection__;
}

function __innerOptions__(app, options) {
  app.innerOptions = { ...options };
  app.w = options.width;
  app.h = options.height;
  app.si = options.scaleStep;
  app.is = options.imageSmoothing;
}

function __sourceRequest__(app, source, options, replace, operation) {
  return Promises.registerPromise(
    Promise.resolve().then(async () => {
      if (!__isApp__(app)) throw new TypeError(`App.${operation} expects app data`);
      if (typeof source !== 'string') throw new TypeError(`App.${operation} expects source text`);
      if (!options || typeof options !== 'object' || Array.isArray(options))
        throw new TypeError(`App.${operation} expects source options`);
      for (const key of Object.keys(options))
        if (key !== 'sourceURL') throw new TypeError(`Unknown ${operation} option: ${key}`);
      const generation = (app.requestGeneration = (app.requestGeneration ?? 0) + 1);
      await app.ready;
      if (app.destroyed) throw new Error('Mercury app has been disposed');
      if (generation !== app.requestGeneration) return app;
      await replace(
        app,
        source,
        options.sourceURL ??
          SceneMemory.sourceURL(app.__reflection__.scene) ??
          (app.sourceURL || undefined),
      );
      return app;
    }),
  );
}

function __compileApp__(app, source, compiler, { trace = app.trace, sourceURL, environment } = {}) {
  if (app.destroyed) throw new Error('Mercury runtime has been destroyed.');
  if (!app.graphics) throw new Error('Attach a canvas before compiling a program.');
  if (typeof source !== 'string') throw new TypeError('Mercury source must be a string.');
  const hasSourceURL = sourceURL !== undefined;
  sourceURL = Modules.resolve(app.modules, sourceURL ?? app.modules.baseURL);
  const traceURL = hasSourceURL ? sourceURL : undefined;
  const resourceBindings = {
    app,
    import: (...args) => {
      if (args.length !== 1)
        return Promises.registerPromise(Promise.reject(new TypeError('import expects one path')));
      return Modules.import(app.modules, args[0], sourceURL);
    },
    'set-scene': (...args) => {
      if (args.length !== 1)
        return Promises.registerPromise(
          Promise.reject(new TypeError('set-scene expects one path')),
        );
      return Promises.registerPromise(AppCore.load(app, args[0], { sourceURL }));
    },
  };
  let program;
  try {
    program = compiler(source, { ...app.bindings, ...resourceBindings }, Forms, {
      trace,
      environment,
      sourceURL: traceURL,
      textRenderer: (text) => app.services.graphics.createText(app.graphics, text),
    });
  } catch (error) {
    if (error instanceof Error && error.lisp && !error.lisp.sourceURL)
      error.lisp.sourceURL = traceURL;
    throw error;
  }
  program.sourceURL = sourceURL;
  program.source = source;
  program.__shaderValues__ = program.shaders.map((shader) =>
    app.services.graphics.createShader(app.graphics, shader),
  );
  return program;
}
