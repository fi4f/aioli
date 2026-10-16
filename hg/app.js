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
import { Resources, resourceResponse } from './resources.js';
import { Strings } from './strings.js';
import { Storage } from './storage.js';
import { Trace } from './trace.js';
import { Tokenizer } from './tokenize.js';
import { SceneMemory } from './scene-memory.js';
import { Preview } from './preview.js';
import { Embedded } from './embedded.js';

const __owners__ = new WeakMap();

function __appData__({
  bindings = {},
  trace = true,
  onError = console.error,
  updateHz = 60,
  ups = updateHz,
  maxUpdatesPerFrame = 8,
  innerCanvas = {},
  baseURL = globalThis.document?.baseURI ?? new URL('../hg.js', import.meta.url).href,
  fetch: fetchSource,
} = {}) {
  const app = {};
  app.services = { graphics: Graphics, input: Input, display: InnerCanvas };
  app.trace = trace;
  app.onError = onError;
  app.bindings = { ...Bindings, ...bindings };
  app.textProxies = new Set();
  app.__children__ = new Set();
  app.__inputRoutes__ = new Set();
  app.__tokenizer__ = Tokenizer.new();
  app.outerCanvas = null;
  app.graphics = null;
  app.source = '';
  app.sourceURL = '';
  app.filesystem = null;
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
  app.bindings.Resources = Resources;
  app.bindings.Strings = Strings;
  app.bindings.Storage = Storage;
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
        onError: (error) => Scheduler.fail(app, error),
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
      const graphics = await app.services.graphics.new(
        display.innerCanvas,
        (error) => Scheduler.fail(app, error),
        {
          prepare: (limit) => AppCore.syncInnerCanvas(app, limit),
          present: () => app.services.display.paint(display),
          needsPresent: () => app.services.display.needsPresent(display),
        },
      );
      if (app.destroyed) {
        app.services.graphics.destroy(graphics);
        throw new Error('Mercury runtime was destroyed during initialization.');
      }
      app.graphics = graphics;
      app.input = app.services.input.new(outerCanvas, {
        coordinates: (x, y) => app.services.display.toInner(display, x, y),
        emit: (name, event) => AppCore.dispatchInput(app, name, event),
      });
      Object.assign(app.bindings, graphics.bindings);
      Object.assign(app.bindings, app.input.bindings);
      Object.assign(app.bindings, display.bindings);
      AppCore.bindTextInput(app, outerCanvas, (x, y) => app.services.display.toOuter(display, x, y));
      return app;
    } catch (error) {
      if (__owners__.get(outerCanvas) === app) __owners__.delete(outerCanvas);
      app.outerCanvas = null;
      app.display == null ? undefined : app.services.display.destroy(app.display);
      app.display = null;
      throw error;
    }
  },

  dispatchInput(app, name, event) {
    if (app.inputFailed || app.failed || app.attaching) return;
    try {
      for (const callback of [...app.__inputRoutes__].reverse()) {
        Scheduler.invoke(app, (value) => callback(name, value), event);
        if (event.handled) break;
      }
      if (!event.handled) Scheduler.invoke(app, app.scene?.[name], event);
      Scheduler.requestRender(app);
    } catch (error) {
      app.inputFailed = true;
      Scheduler.fail(app, error);
    }
  },
  bindTextInput(app, outerCanvas, toOuter) {
    app.bindings['text-proxy'] = (callback) => {
      const proxy = TextProxy.new(outerCanvas, (edit) => {
        if (app.destroyed || app.failed) return;
        const result = callback(edit);
        Scheduler.requestRender(app);
        return result;
      }, {
        toOuter,
        onEdit: (edit) => Tokenizer.noteEdit(app.__tokenizer__, edit),
        onError: (error) => {
          app.inputFailed = true;
          Scheduler.fail(app, error);
        },
      });
      app.textProxies.add(proxy);
      proxy.__onDispose__ = () => app.textProxies.delete(proxy);
      return proxy;
    };
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
    app.reloadPreparation.suspended = true;
    Scheduler.stop(app);
    app.attaching = true;
    return AppCore.execute(app, program, app.reloadPreparation.previous);
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
    return AppCore.reload(app, source, sourceURL, AppCore.executePatch);
  },

  cancelPreparation(app) {
    const preparation = app.reloadPreparation;
    if (!preparation) return;
    app.reloadPreparation = null;
    __detachCandidate__(app, preparation);
    if (preparation.suspended && !app.destroyed) Scheduler.replace(app, preparation.previous);
  },

  reload(app, source, sourceURL, executeScene = AppCore.execute) {
    return Promises.registerPromise(
      Promise.resolve()
        .then(async () => {
          // Also supersede pending initialization when the next draft fails to compile.
          const generation = ++app.loadGeneration;
          AppCore.cancelPreparation(app);
          const program = AppCore.compileScene(app, source, { sourceURL });
          const preparation = { previous: app.scene, scene: null, attached: false, suspended: false };
          app.reloadPreparation = preparation;
          try {
            const scene = await executeScene(app, program);
            if (generation !== app.loadGeneration || app.destroyed) return;
            preparation.scene = scene;
            preparation.suspended = true;
            Scheduler.stop(app);
            app.attaching = true;
            preparation.attached = true;
            await scene.attach?.();
            if (generation !== app.loadGeneration || app.destroyed) return;
            // Exercise render-time expressions while the working scene is retained.
            // Graphics discards failed command recording and preserves its last image.
            app.services.graphics.render(app.graphics, (context) => scene.render?.(context), 0, 0);
            if (generation !== app.loadGeneration || app.destroyed) return;
            app.services.graphics.resetScene(app.graphics);
            Scheduler.install(app, scene);
            if (generation !== app.loadGeneration || app.destroyed || app.scene !== scene) return;
            // Fresh scenes have no predecessor; patches retain same-name references.
            SceneMemory.patch(app.__reflection__, scene);
            app.source = program.source;
            app.sourceURL = program.sourceURL;
            app.inputFailed = false;
            preparation.attached = false;
            app.reloadPreparation = null;
            return scene;
          } catch (error) {
            if (generation === app.loadGeneration && !app.destroyed) throw error;
          } finally {
            if (app.reloadPreparation === preparation) AppCore.cancelPreparation(app);
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
      SceneMemory.load(app.__reflection__, scene);
      return scene;
    };
    const result = AppCore.execute(app, program);
    return result instanceof Promise ? result.then(finish) : finish(result);
  },

  setScene(app, source, options) {
    return AppCore.activate(app, AppCore.compileScene(app, source, options));
  },

  destroy(app, callbacks = true) {
    if (app.destroyed) return;
    app.destroyed = true;
    for (const child of [...app.__children__]) AppCore.destroy(child, callbacks);
    if (app.parent) Embedded.release(app);
    SceneMemory.clear(app.__reflection__);
    const preparation = app.reloadPreparation;
    app.reloadPreparation = null;
    if (callbacks) __detachCandidate__(app, preparation);
    app.modules.cache.clear();
    app.loadGeneration++;
    app.input == null ? undefined : app.services.input.destroy(app.input);
    for (const proxy of [...app.textProxies]) TextProxy.dispose(proxy);
    try {
      if (!callbacks) app.scene = null;
      Scheduler.replace(app, null);
    } catch (error) {
      app.onError(error);
    }
    app.__inputRoutes__.clear();
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
  abandon(app) {
    if (!__isApp__(app)) throw new TypeError('Expected an app');
    AppCore.destroy(app, false);
  },
  setFilesystem(app, filesystem, api) {
    if (!__isApp__(app) || app.destroyed) throw new TypeError('Expected a live app');
    if (
      !filesystem ||
      typeof filesystem.baseURL !== 'string' ||
      typeof Data.get(api, 'fetch') !== 'function'
    )
      throw new TypeError('Expected filesystem state and an explicit operation namespace');
    app.filesystem = filesystem;
    app.__filesystemApi__ = api;
    app.bindings.Vfs = api;
    app.modules.baseURL = filesystem.baseURL;
    app.modules.fetch = async (url, options) =>
      resourceResponse(await Data.get(api, 'fetch')(filesystem, url, options ?? null));
    return app;
  },
  listenInput(app, callback) {
    if (!__isApp__(app) || app.destroyed) throw new TypeError('listenInput expects a live app');
    if (typeof callback !== 'function') throw new TypeError('listenInput expects a function');
    app.__inputRoutes__.add(callback);
    return () => {
      app.__inputRoutes__.delete(callback);
    };
  },
  embed: (parent, options = {}) => Embedded.create(parent, options),
  resize: (app, w, h) => Embedded.resize(app, w, h),
  focus: (app, focused) => Embedded.focus(app, focused),
  setVisible: (app, visible) => Embedded.setVisible(app, visible),
  sendInput: (app, name, event) => Embedded.sendInput(app, name, event),
  new(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new TypeError('App.new expects options');
    const {
      c = null,
      w = null,
      h = null,
      si = null,
      is = false,
      ups = 60,
      trace = true,
    } = options;
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
  loadSource(app, source, options = {}) {
    return __sourceRequest__(app, source, options, AppCore.reload, 'loadSource');
  },
  patchSource(app, source, options = {}) {
    return __sourceRequest__(app, source, options, AppCore.patch, 'patchSource');
  },
  load(app, url, options = {}) {
    return __urlRequest__(app, url, options, AppCore.reload, 'load');
  },
  patch(app, url, options = {}) {
    return __urlRequest__(app, url, options, AppCore.patch, 'patch');
  },
  reloadModules(app, url) {
    return Promises.registerPromise(
      Promise.resolve().then(async () => {
        if (!__isApp__(app) || app.destroyed || !app.sourceURL)
          throw new TypeError('reloadModules expects a loaded, live app');
        url ??= app.sourceURL;
        if (app.__moduleReload__) return app.__moduleReload__;
        const previous = app.modules.cache;
        const candidate = new Map();
        app.modules.cache = candidate;
        const pending = App.load(app, url).catch((error) => {
          if (app.modules.cache === candidate) app.modules.cache = previous;
          throw error;
        });
        app.__moduleReload__ = pending;
        try {
          return await pending;
        } finally {
          app.__moduleReload__ = null;
        }
      }),
    );
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
  preview(app, reference, path = [], limit = 50, offset = 0) {
    return Preview.describe(SceneMemory.read(__reflection__(app, 'preview'), reference), path, limit, offset);
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

function __detachCandidate__(app, preparation) {
  if (!preparation?.attached) return;
  preparation.attached = false;
  try {
    const result = preparation.scene.detach?.();
    if (result?.then) result.catch((error) => app.onError(error));
  } catch (error) {
    app.onError(error);
  }
}

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
  return __request__(app, operation, () => {
    if (typeof source !== 'string') throw new TypeError(`App.${operation} expects source text`);
    __requestOptions__(options, operation, 'source');
    return () =>
      replace(
        app,
        source,
        options.sourceURL ??
          SceneMemory.sourceURL(app.__reflection__.scene) ??
          (app.sourceURL || undefined),
      );
  });
}

function __prepareRequest__(app) {
  const generation = ++app.loadGeneration;
  AppCore.cancelPreparation(app);
  // Obsolete asynchronous initialization must not leave candidate source published.
  const program = SceneMemory.program(app.__reflection__.scene);
  app.source = program?.source ?? '';
  app.sourceURL = program?.sourceURL ?? '';
  return generation;
}

function __urlRequest__(app, path, options, replace, operation) {
  return __request__(app, operation, () => {
    if (typeof path !== 'string' || !path.length)
      throw new TypeError(`App.${operation} expects a nonempty URL string`);
    __requestOptions__(options, operation, 'URL');
    const url = Modules.resolve(
      app.modules,
      path,
      options.sourceURL ?? SceneMemory.sourceURL(app.__reflection__.scene) ?? app.modules.baseURL,
    );
    return async (current) => {
      const source = await Modules.read(app.modules, url);
      if (current()) await replace(app, source, url);
    };
  });
}

function __requestOptions__(options, operation, kind) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError(`App.${operation} expects ${kind} options`);
  for (const key of Object.keys(options))
    if (key !== 'sourceURL') throw new TypeError(`Unknown ${operation} option: ${key}`);
}

// Resolve inputs before readiness; all replacements share readiness and supersession.
function __request__(app, operation, prepare) {
  return Promises.registerPromise(
    Promise.resolve().then(async () => {
      if (!__isApp__(app)) throw new TypeError(`App.${operation} expects app data`);
      const replace = prepare();
      const request = (app.requestGeneration = (app.requestGeneration ?? 0) + 1);
      await app.ready;
      if (app.destroyed) throw new Error('Mercury app has been disposed');
      if (request !== app.requestGeneration) return app;
      const generation = __prepareRequest__(app);
      await replace(() => request === app.requestGeneration && generation === app.loadGeneration);
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
  const filesystem = () => {
    if (app.destroyed || !app.__filesystemApi__)
      throw new Error('This app has no live filesystem');
    return app.filesystem;
  };
  const fileCall = (name, ...args) => {
    const state = filesystem();
    return Data.get(app.__filesystemApi__, name)(state, ...args);
  };
  const pathCall = (name, ...args) => {
    filesystem();
    return Data.get(app.__filesystemApi__, name)(...args);
  };
  // Callable shorthand retains this owner even when the Lisp app name is shadowed.
  const resourceBindings = {
    'source-url': (reference = '.') => {
      if (typeof reference !== 'string') throw new TypeError('source-url expects one string');
      return Modules.resolve(app.modules, reference, sourceURL);
    },
    image: (...args) => {
      if (args.length !== 1 || typeof args[0] !== 'string')
        throw new TypeError('image expects one URL string');
      const url = new URL(args[0], sourceURL);
      if (app.filesystem && fileCall('ownsURL', url.href)) {
        const entry = fileCall('stat', decodeURIComponent(url.pathname));
        if (entry) url.searchParams.set('revision', entry.revision);
      }
      return Promises.registerPromise(
        app.services.graphics.loadImage(app.graphics, url.href, app.modules.fetch),
      );
    },
    'listen-input': (...args) => {
      if (args.length !== 1) throw new TypeError('listen-input expects one function');
      return App.listenInput(app, args[0]);
    },
    app,
    fetch: (url) => Resources.fetch(new URL(url, sourceURL).href),
    resource: (url) =>
      Promises.registerPromise(
        Promise.resolve().then(() => fileCall('fetch', new URL(url, sourceURL).href, null)),
      ),
    'fs-stat': (path) => fileCall('stat', path),
    'fs-list': (path = '/') => fileCall('list', path),
    'fs-read-text': (path) => fileCall('readText', path),
    'fs-read-bytes': (path) => fileCall('readBytes', path),
    'fs-write-text': (path, content, revision = null) =>
      fileCall('writeText', path, content, revision),
    'fs-write-bytes': (path, bytes, mime = 'application/octet-stream', revision = null) =>
      fileCall('writeBytes', path, bytes, mime, revision),
    'fs-mkdir': (path) => fileCall('mkdir', path),
    'fs-move': (from, to) => fileCall('move', from, to),
    'fs-remove': (path) => fileCall('remove', path),
    'fs-remove-tree': (path) => fileCall('removeTree', path),
    'fs-url': (path) => fileCall('url', path),
    'fs-join': (directory, name) => pathCall('join', directory, name),
    'fs-parent': (path) => pathCall('parent', path),
    'fs-name': (path) => pathCall('name', path),
    'fs-contains': (directory, path) => pathCall('contains', directory, path),
    'fs-rebase': (path, from, to) => pathCall('rebase', path, from, to),
    'fs-refresh': () => fileCall('refresh'),
    pause: (...args) => {
      if (args.length !== 0) throw new TypeError('pause expects no arguments');
      return App.pause(app);
    },
    start: (...args) => {
      if (args.length !== 0) throw new TypeError('start expects no arguments');
      return App.start(app);
    },
    'load-source': (...args) => {
      if (args.length < 1 || args.length > 2)
        return Promises.registerPromise(
          Promise.reject(
            new TypeError('load-source expects source text and optional source options'),
          ),
        );
      return App.loadSource(app, ...args);
    },
    'patch-source': (...args) => {
      if (args.length < 1 || args.length > 2)
        return Promises.registerPromise(
          Promise.reject(
            new TypeError('patch-source expects source text and optional source options'),
          ),
        );
      return App.patchSource(app, ...args);
    },
    load: (...args) => {
      if (args.length !== 1)
        return Promises.registerPromise(
          Promise.reject(new TypeError('load expects one URL string')),
        );
      return App.load(app, args[0], { sourceURL });
    },
    patch: (...args) => {
      if (args.length !== 1)
        return Promises.registerPromise(
          Promise.reject(new TypeError('patch expects one URL string')),
        );
      return App.patch(app, args[0], { sourceURL });
    },
    exec: (...args) => {
      if (args.length !== 1) throw new TypeError('exec expects one source text argument');
      return App.exec(app, args[0]);
    },
    import: (...args) => {
      if (args.length !== 1)
        return Promises.registerPromise(Promise.reject(new TypeError('import expects one path')));
      return Modules.import(app.modules, args[0], sourceURL);
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
