import { App, AppCore } from './app.js';
import { Graphics } from './graphics.js';
import { InnerCanvas } from './inner-canvas.js';
import { Input } from './input.js';
import { Data } from './data.js';
import { Types } from './types.js';
import { Scheduler } from './scheduler.js';
import { Promises } from './promises.js';
import { Trace } from './trace.js';

function __require__(app) {
  if (!app?.parent || app.destroyed) throw new TypeError('Expected a live embedded app');
}
function __publish__(app) {
  if (app.destroyed || app.parent.destroyed || !app.graphics) return;
  Graphics.publish(app.graphics, app.parent.graphics, app.output);
  app.outputRevision++;
}
function __toOuter__(app, x, y) {
  const point = app.services.display.toOuter(app.display, x, y);
  return app.parent
    ? __toOuter__(app.parent, point.x + app.position.x, point.y + app.position.y)
    : point;
}
function __create__(parent, options) {
  if (!parent?.__children__ || parent.destroyed) throw new TypeError('App.embed expects a live parent');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('App.embed expects options');
  for (const key of Object.keys(options))
    if (!['w', 'h', 'si', 'is', 'ups', 'trace'].includes(key)) throw new TypeError(`Unknown embedded App option: ${key}`);
  const app = AppCore.new({ trace: options.trace ?? parent.trace, ups: options.ups ?? 60,
    baseURL: parent.modules.baseURL,
    innerCanvas: { width: options.w ?? null, height: options.h ?? null,
      scaleStep: options.si ?? null, imageSmoothing: options.is ?? false } });
  app.parent = parent;
  app.position = Data.vector(2, [0, 0]);
  app.output = null;
  app.outputRevision = 0;
  app.view = Data.dict();
  app.error = '';
  app.hidden = false;
  app.onError = error => {
    app.error = Trace.formatTrace(error);
    if (app.input) Input.reset(app.input);
  };
  app.display = InnerCanvas.offscreen(app.innerOptions, app, (next) => {
    app.innerOptions = { ...next };
    app.w = next.width; app.h = next.height; app.si = next.scaleStep; app.is = next.imageSmoothing;
  });
  const prepare = limit => {
    AppCore.syncInnerCanvas(app, limit);
    Object.assign(app.view, InnerCanvas.layout(app.display));
  };
  parent.__children__.add(app);
  if (parent.filesystem) App.setFilesystem(app, parent.filesystem, parent.__filesystemApi__);
  prepare();
  app.ready = Promises.registerPromise((async () => {
    await parent.ready;
    if (app.destroyed || parent.destroyed) throw new Error('Embedded app was disposed during initialization');
    app.outerCanvas = parent.outerCanvas;
    const graphics = await Graphics.new(app.display.innerCanvas, error => Scheduler.fail(app, error),
      { shared: parent.graphics, prepare, present: () => __publish__(app), needsPresent: () => false });
    if (app.destroyed || parent.destroyed) { Graphics.destroy(graphics); throw new Error('Embedded app was disposed during initialization'); }
    app.graphics = graphics;
    app.output = Types.textureHandle(graphics.width, graphics.height);
    app.input = Input.new(app.outerCanvas, { listen: false,
      coordinates: (x, y) => InnerCanvas.toInner(app.display, x, y),
      emit: (name, event) => AppCore.dispatchInput(app, name, event) });
    Object.assign(app.bindings, graphics.bindings, app.input.bindings, app.display.bindings);
    AppCore.bindTextInput(app, app.outerCanvas, (x, y) => __toOuter__(app, x, y));
    __publish__(app);
    return app;
  })());
  app.ready.catch(error => {
    app.initializationError = error;
    if (!app.destroyed) app.onError(error);
  });
  return app;
}

export const Embedded = {
  create: __create__,
  resize(app, w, h) {
    __require__(app);
    if (![w, h].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError('Embedded viewport dimensions must be positive integers');
    if (app.display.outerCanvas.width === w && app.display.outerCanvas.height === h) return app;
    app.display.outerCanvas.width = w; app.display.outerCanvas.height = h;
    try {
      AppCore.syncInnerCanvas(app, app.graphics?.device.limits.maxTextureDimension2D);
    } catch (error) {
      Scheduler.fail(app, error);
    }
    if (app.destroyed) return app;
    Object.assign(app.view, InnerCanvas.layout(app.display));
    return app;
  },
  focus(app, focused) {
    __require__(app);
    if (typeof focused !== 'boolean') throw new TypeError('Embedded focus must be boolean');
    if (app.input) {
      if (app.input.active === focused) return app;
      app.input.active = focused;
      if (!focused) Input.reset(app.input);
    }
    return app;
  },
  setVisible(app, visible) {
    __require__(app);
    if (typeof visible !== 'boolean') throw new TypeError('Embedded visibility must be boolean');
    if (app.hidden === !visible) return app;
    app.hidden = !visible;
    app.lastTime = null; app.accumulator = 0;
    if (visible) Scheduler.schedule(app);
    else { Scheduler.stop(app); if (app.input) Input.reset(app.input); }
    return app;
  },
  sendInput(app, name, event) {
    __require__(app);
    if (app.hidden || app.failed || app.attaching || !app.input) return;
    if (!['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'pointerenter', 'wheel'].includes(name))
      throw new TypeError(`Unsupported embedded input: ${name}`);
    return Input.feed(app.input, name, event);
  },
  release(app) {
    app.parent.__children__.delete(app);
    if (app.output) app.parent.graphics?.handles.delete(app.output);
    app.output = null;
  },
};
