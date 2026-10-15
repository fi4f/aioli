import { Graphics } from './graphics.js';
import { Input } from './input.js';
import { Data } from './data.js';
// Fixed-step simulation; rendering follows the browser's animation frames.
function __schedulerData__({
  updateHz = 60,
  ups = updateHz,
  maxUpdatesPerFrame = 8,
  onError = console.error,
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  render,
  dimensions,
  prepare,
  services = { graphics: Graphics, input: Input },
} = {}) {
  const app = {};
  app.services = services;
  __validateUps__(ups);
  if (!Number.isSafeInteger(maxUpdatesPerFrame) || maxUpdatesPerFrame < 1) {
    throw new TypeError('maxUpdatesPerFrame must be a positive integer');
  }
  app.ups = ups;
  app.appliedUps = ups;
  app.requestedUps = ups;
  app.dt = 1 / ups;
  app.maxUpdatesPerFrame = maxUpdatesPerFrame;
  app.onError = onError;
  app.requestFrame = requestFrame;
  app.cancelFrame = cancelFrame;
  app.dimensions = dimensions;
  app.renderHook = render;
  app.__prepare__ = prepare;
  app.scene = null;
  app.attaching = false;
  app.failed = false;
  app.paused = false;
  app.frameId = null;
  app.generation = 0;
  app.__attachmentGeneration__ = 0;
  app.lastTime = null;
  app.accumulator = 0;
  app.elapsed = 0;
  app.updateElapsed = 0;
  return app;
}

export const Scheduler = {
  configureUps(app, ups) {
    __validateUps__(ups);
    app.requestedUps = ups;
  },

  context(app, t, dt) {
    const { w, h } = app.dimensions?.() ?? {
      w: app.display?.innerCanvas.width ?? 0,
      h: app.display?.innerCanvas.height ?? 0,
    };
    return Data.dict('t', t, 'dt', dt, 'w', w, 'h', h);
  },

  render(app, callback, dt, t) {
    if (app.renderHook) return app.renderHook(callback, dt, t);
    if (!app.graphics) return callback?.(Scheduler.context(app, t, dt));
    const scene = app.scene;
    return app.services.graphics.render(
      app.graphics,
      (context) => {
        if (app.scene === scene) Scheduler.invoke(app, callback, context, scene);
      },
      dt,
      t,
    );
  },

  stop(app) {
    __stopFrames__(app);
    app.__attachmentGeneration__++;
  },

  fail(app, error) {
    if (app.destroyed || app.failed) return;
    app.failed = true;
    Scheduler.stop(app);
    app.onError(error);
  },

  pause(app) {
    app.paused = true;
    __stopFrames__(app);
    app.lastTime = null;
    app.accumulator = 0;
  },

  start(app) {
    if (app.paused) {
      app.paused = false;
      app.lastTime = null;
      app.accumulator = 0;
    }
    Scheduler.schedule(app);
  },

  // Install a prepared scene without invoking its attach hook again.
  install(app, scene) {
    Scheduler.stop(app);
    const previous = app.scene;
    app.scene = null;
    const detached = previous?.detach?.();
    if (detached?.then) detached.catch((error) => app.onError(error));
    app.attaching = false;
    app.failed = false;
    app.input == null ? undefined : app.services.input.reset(app.input);
    app.lastTime = null;
    app.accumulator = 0;
    app.elapsed = 0;
    app.updateElapsed = 0;
    app.scene = app.destroyed ? null : scene;
    Scheduler.schedule(app);
  },

  replace(app, scene) {
    Scheduler.install(app, null);
    if (!scene || app.destroyed) return;
    app.scene = scene;
    try {
      const attached = scene.attach?.();
      if (attached?.then) {
        app.attaching = true;
        const generation = app.__attachmentGeneration__;
        attached.then(
          () => {
            if (app.scene !== scene || app.__attachmentGeneration__ !== generation) return;
            app.attaching = false;
            Scheduler.schedule(app);
          },
          (error) => {
            if (app.scene !== scene || app.__attachmentGeneration__ !== generation) return;
            app.attaching = false;
            app.scene = null;
            Scheduler.stop(app);
            app.failed = true;
            try {
              const result = scene.detach?.();
              if (result?.then) result.catch((cleanupError) => app.onError(cleanupError));
            } catch (cleanupError) {
              app.onError(cleanupError);
            }
            app.onError(error);
          },
        );
      }
    } catch (error) {
      app.scene = null;
      try {
        const result = scene.detach?.();
        if (result?.then) result.catch((cleanupError) => app.onError(cleanupError));
      } catch (cleanupError) {
        app.onError(cleanupError);
      }
      throw error;
    }
    if (app.scene === scene && !app.attaching) Scheduler.schedule(app);
  },

  invoke(app, callback, argument, scene = app.scene) {
    const generation = app.__attachmentGeneration__;
    const result = callback?.(argument);
    if (result?.then)
      result.catch((error) => {
        if (app.scene !== scene || app.__attachmentGeneration__ !== generation) return;
        Scheduler.fail(app, error);
      });
    return result;
  },

  schedule(app) {
    if (
      !app.scene ||
      app.paused ||
      app.attaching ||
      app.failed ||
      app.destroyed ||
      app.frameId !== null
    )
      return;
    const generation = app.generation;
    app.frameId = app.requestFrame((time) => {
      if (generation !== app.generation || app.paused || app.destroyed) return;
      app.frameId = null;
      try {
        Scheduler.frame(app, time);
      } catch (error) {
        Scheduler.fail(app, error);
        return;
      }
      if (app.scene && generation === app.generation) Scheduler.schedule(app);
    });
  },

  requestRender(app) {
    if (
      !app.scene ||
      app.paused ||
      app.destroyed ||
      app.attaching ||
      app.failed ||
      app.renderRequest
    )
      return;
    const request = { generation: app.generation, scene: app.scene };
    app.renderRequest = request;
    queueMicrotask(() => {
      if (app.renderRequest !== request) return;
      app.renderRequest = null;
      if (
        request.generation !== app.generation ||
        request.scene !== app.scene ||
        app.paused ||
        app.destroyed ||
        app.attaching ||
        app.failed
      )
        return;
      try {
        if (app.display) app.__prepare__?.(app);
        if (request.generation !== app.generation || request.scene !== app.scene) return;
        Scheduler.render(app, app.scene.render, 0, app.elapsed);
      } catch (error) {
        Scheduler.fail(app, error);
      }
    });
  },

  frame(app, time) {
    const scene = app.scene;
    const generation = app.generation;
    if (!scene || app.paused || app.destroyed || app.attaching || app.failed) return;
    if (app.ups !== app.appliedUps) app.requestedUps = __validateUps__(app.ups);
    app.ups = __validateUps__(app.requestedUps);
    app.appliedUps = app.ups;
    app.dt = 1 / app.ups;
    if (app.display) app.__prepare__?.(app);
    if (app.scene !== scene || app.generation !== generation) return;
    app.input == null ? undefined : app.services.input.poll(app.input);
    if (app.scene !== scene || app.generation !== generation) return;
    const frameDt = app.lastTime === null ? 0 : Math.max(0, (time - app.lastTime) / 1000);
    app.accumulator += frameDt;
    app.elapsed += frameDt;
    app.lastTime = time;
    let updates = 0;
    while (app.accumulator + app.dt * 1e-9 >= app.dt && updates < app.maxUpdatesPerFrame) {
      app.accumulator = Math.max(0, app.accumulator - app.dt);
      app.updateElapsed += app.dt;
      Scheduler.invoke(app, scene.update, Scheduler.context(app, app.updateElapsed, app.dt), scene);
      updates++;
      if (app.scene !== scene || app.generation !== generation) return;
    }
    Scheduler.render(app, scene.render, frameDt, app.elapsed);
  },
  new: __schedulerData__,
  validateUps: __validateUps__,
};

function __stopFrames__(app) {
  app.generation++;
  app.renderRequest = null;
  if (app.frameId !== null) app.cancelFrame(app.frameId);
  app.frameId = null;
}

function __validateUps__(ups) {
  if (typeof ups !== 'number' || !Number.isFinite(ups) || ups <= 0 || !Number.isFinite(1 / ups)) {
    throw new TypeError('ups must be a positive finite number with a finite update interval');
  }
  return ups;
}
