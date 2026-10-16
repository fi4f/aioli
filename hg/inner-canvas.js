import { Data } from './data.js';

import { Scheduler } from './scheduler.js';

import { Contracts } from './contracts.js';

function __validateInnerOptions__(patch, base = { width: null, height: null, scaleStep: 0 }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new TypeError('Inner canvas options must be an object');
  const result = { imageSmoothing: false, ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!['width', 'height', 'scaleStep', 'imageSmoothing'].includes(key))
      throw new TypeError(`Unknown inner canvas option: ${key}`);
    if (key === 'imageSmoothing') {
      if (typeof value !== 'boolean') throw new TypeError('is must be a boolean');
      result[key] = value;
    } else if (key === 'scaleStep') {
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
        throw new TypeError('scaleStep must be a finite nonnegative number or null');
      result[key] = value ?? 0;
    } else {
      if (value != null && (!Number.isSafeInteger(value) || value <= 0))
        throw new TypeError(`${key} must be a positive integer or null`);
      result[key] = value ?? null;
    }
  }
  return result;
}

function __canvasLayout__(outerWidth, outerHeight, options) {
  if (
    !Number.isSafeInteger(outerWidth) ||
    !Number.isSafeInteger(outerHeight) ||
    outerWidth <= 0 ||
    outerHeight <= 0
  )
    throw new RangeError('Outer canvas dimensions must be positive integers');
  const w = options.width ?? outerWidth,
    h = options.height ?? outerHeight;
  const fit = Math.min(outerWidth / w, outerHeight / h);
  let scale = fit;
  if (options.scaleStep > 0) {
    const snapped = Math.floor(fit / options.scaleStep + 1e-12) * options.scaleStep;
    scale =
      Number.isFinite(snapped) && snapped > 0 ? snapped : snapped === 0 ? options.scaleStep : fit;
  }
  return {
    w,
    h,
    scale,
    x: (outerWidth - w * scale) / 2,
    y: (outerHeight - h * scale) / 2,
    outerWidth,
    outerHeight,
  };
}

function __createInnerCanvas__(
  outerCanvas,
  initial = {},
  {
    updateRate = null,
    onResize = () => {},
    onConfigure = () => {},
    outerSize = __bitmapSize__,
    onError = (error) => {
      throw error;
    },
    ResizeObserver: Observer = globalThis.ResizeObserver,
    createCanvas = (w, h) => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
      const innerCanvas = outerCanvas.ownerDocument.createElement('canvas');
      innerCanvas.width = w;
      innerCanvas.height = h;
      return innerCanvas;
    },
  } = {},
) {
  const state = {
    outerCanvas,
    initial,
    updateRate,
    onResize,
    onConfigure,
    outerSize,
    onError,
    Observer,
    createCanvas,
  };
  state.requestedUps = state.updateRate?.requestedUps ?? 60;
  state.requested = __validateInnerOptions__(state.initial);
  state.applied = { ...state.requested };
  state.limit = Infinity;
  state.destroyed = false;
  state.presented = null;
  state.__presentedSmoothing__ = null;
  __resizeOuter__(state, state.outerSize(state.outerCanvas));
  state.initialLayout = __canvasLayout__(
    state.outerCanvas.width,
    state.outerCanvas.height,
    state.applied,
  );
  state.innerCanvas = state.createCanvas(state.initialLayout.w, state.initialLayout.h);
  state.outerContext = state.outerCanvas.getContext('2d');
  if (!state.outerContext) throw new Error('Canvas 2D is required for outer canvas presentation');
  state.bindings = __bindings__(state);
  Contracts.registerConfigureBinding(state.bindings.configure);
  state.observer = state.Observer
    ? new state.Observer(() => {
        if (state.destroyed) return;
        try {
          const event = __sync__(state);
          if (event) state.onResize(event);
        } catch (error) {
          state.onError(error);
        }
      })
    : null;
  state.observer?.observe(state.outerCanvas);
  return state;
}

function __bindings__(state) {
  return {
    configure: (...args) => {
      const options =
        args.length === 1 && Data.dataKind(args[0]) === 'dict' ? args[0] : Data.dict(...args);
      const ups = Object.hasOwn(options, 'ups')
        ? Scheduler.validateUps(options.ups)
        : state.requestedUps;
      const patch = {},
        names = { w: 'width', h: 'height', 'scale-step': 'scaleStep', is: 'imageSmoothing' };
      for (const [key, value] of Object.entries(options)) {
        if (key === 'ups') continue;
        if (!Object.hasOwn(names, key)) throw new TypeError(`Unknown inner canvas option: ${key}`);
        patch[names[key]] = value;
      }
      const result = __configure__(state, patch);
      if (state.updateRate) Scheduler.configureUps(state.updateRate, ups);
      state.requestedUps = ups;
      Data.put(result, 'ups', ups);
      return result;
    },
    canvas: (...args) => {
      __noArgs__(state, args, 'canvas');
      const view = __layout__(state);
      return Data.dict('w', view.w, 'h', view.h, 'wh', Data.vector(2, [view.w, view.h]));
    },
  };
}

function __offscreen__(initial, updateRate, onConfigure) {
  const requested = __validateInnerOptions__(initial);
  const state = {
    outerCanvas: { width: 320, height: 180 }, outerSize: __bitmapSize__,
    requested, applied: { ...requested }, updateRate, onConfigure, limit: Infinity, destroyed: false,
    requestedUps: updateRate?.requestedUps ?? 60,
    innerCanvas: { width: requested.width ?? 320, height: requested.height ?? 180 },
  };
  state.bindings = __bindings__(state);
  Contracts.registerConfigureBinding(state.bindings.configure);
  return state;
}

function __bitmapSize__(outerCanvas) {
  return { width: outerCanvas.width, height: outerCanvas.height };
}

function __displaySize__(outerCanvas) {
  const bounds = outerCanvas.getBoundingClientRect();
  const ratio = outerCanvas.ownerDocument?.defaultView?.devicePixelRatio ?? 1;
  return {
    width: Math.max(1, Math.round(bounds.width * ratio)),
    height: Math.max(1, Math.round(bounds.height * ratio)),
  };
}

function __resizeOuter__(state, size) {
  if (state.outerCanvas.width !== size.width) state.outerCanvas.width = size.width;
  if (state.outerCanvas.height !== size.height) state.outerCanvas.height = size.height;
}

function __layout__(state) {
  return __canvasLayout__(state.outerCanvas.width, state.outerCanvas.height, state.applied);
}

function __sync__(state, maxDimension = state.limit) {
  if (state.destroyed) return null;
  const size = state.outerSize(state.outerCanvas);
  const next = __canvasLayout__(size.width, size.height, state.requested);
  if (next.w > maxDimension || next.h > maxDimension)
    throw new RangeError('Inner canvas dimensions exceed the GPU texture limit');
  state.limit = maxDimension;
  __resizeOuter__(state, size);
  const oldWidth = state.innerCanvas.width,
    oldHeight = state.innerCanvas.height;
  if (state.innerCanvas.width !== next.w) state.innerCanvas.width = next.w;
  if (state.innerCanvas.height !== next.h) state.innerCanvas.height = next.h;
  state.applied = { ...state.requested };
  return oldWidth === next.w && oldHeight === next.h
    ? null
    : Data.dict(
        'w',
        next.w,
        'h',
        next.h,
        'wh',
        Data.vector(2, [next.w, next.h]),
        'old-w',
        oldWidth,
        'old-h',
        oldHeight,
        'old-wh',
        Data.vector(2, [oldWidth, oldHeight]),
      );
}

function __configure__(state, patch) {
  const next = __validateInnerOptions__(patch, state.requested),
    size = __canvasLayout__(state.outerCanvas.width, state.outerCanvas.height, next);
  if (size.w > state.limit || size.h > state.limit)
    throw new RangeError('Inner canvas dimensions exceed the GPU texture limit');
  state.requested = next;
  state.onConfigure({ ...next }, { ...patch });
  return Data.dict(
    'w',
    state.requested.width,
    'h',
    state.requested.height,
    'scale-step',
    state.requested.scaleStep,
    'is',
    state.requested.imageSmoothing,
  );
}

function __toInner__(state, x, y) {
  const view = __layout__(state);
  const innerX = (x - view.x) / view.scale,
    innerY = (y - view.y) / view.scale;
  return {
    x: innerX,
    y: innerY,
    w: view.w,
    h: view.h,
    inside: innerX >= 0 && innerY >= 0 && innerX < view.w && innerY < view.h,
  };
}

function __toOuter__(state, x, y) {
  const view = __layout__(state);
  return { x: view.x + x * view.scale, y: view.y + y * view.scale };
}

function __noArgs__(state, args, name) {
  if (args.length) throw new TypeError(`${name} expects no arguments`);
}

function __needsPresent__(state) {
  const view = __layout__(state);
  return (
    !state.presented ||
    state.__presentedSmoothing__ !== state.applied.imageSmoothing ||
    ['outerWidth', 'outerHeight', 'w', 'h', 'x', 'y', 'scale'].some(
      (key) => state.presented[key] !== view[key],
    )
  );
}

function __destroy__(state) {
  state.destroyed = true;
  state.observer?.disconnect();
}

function __paint__(state) {
  const view = __layout__(state);
  state.outerContext.save();
  try {
    state.outerContext.setTransform(1, 0, 0, 1, 0, 0);
    state.outerContext.globalAlpha = 1;
    state.outerContext.globalCompositeOperation = 'source-over';
    state.outerContext.filter = 'none';
    state.outerContext.shadowBlur = 0;
    state.outerContext.shadowColor = 'transparent';
    state.outerContext.imageSmoothingEnabled = state.applied.imageSmoothing;
    state.outerContext.clearRect(0, 0, state.outerCanvas.width, state.outerCanvas.height);
    state.outerContext.drawImage(
      state.innerCanvas,
      view.x,
      view.y,
      view.w * view.scale,
      view.h * view.scale,
    );
    state.presented = view;
    state.__presentedSmoothing__ = state.applied.imageSmoothing;
  } finally {
    state.outerContext.restore();
  }
}

export const InnerCanvas = {
  new: __createInnerCanvas__,
  offscreen: __offscreen__,
  layout: __layout__,
  sync: __sync__,
  configure: __configure__,
  toInner: __toInner__,
  toOuter: __toOuter__,
  needsPresent: __needsPresent__,
  destroy: __destroy__,
  paint: __paint__,
  validateInnerOptions: __validateInnerOptions__,
  canvasLayout: __canvasLayout__,
  bitmapSize: __bitmapSize__,
  displaySize: __displaySize__,
};
