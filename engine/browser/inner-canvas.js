import { dataKind, dict, vector, put } from '../language/data.js';

import { validateUps } from '../runtime/stage.js';

import { registerConfigureBinding } from '../runtime/contracts.js';
export { isConfigureBinding } from '../runtime/contracts.js';

export function validateInnerOptions(patch, base = { width: null, height: null, scaleStep: 0 }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Inner canvas options must be an object');
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!['width', 'height', 'scaleStep'].includes(key)) throw new TypeError(`Unknown inner canvas option: ${key}`);
    if (key === 'scaleStep') {
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new TypeError('scaleStep must be a finite nonnegative number or null');
      result[key] = value ?? 0;
    } else {
      if (value != null && (!Number.isSafeInteger(value) || value <= 0)) throw new TypeError(`${key} must be a positive integer or null`);
      result[key] = value ?? null;
    }
  }
  return result;
}

export function canvasLayout(outerWidth, outerHeight, options) {
  if (!Number.isSafeInteger(outerWidth) || !Number.isSafeInteger(outerHeight) || outerWidth <= 0 || outerHeight <= 0) throw new RangeError('Outer canvas dimensions must be positive integers');
  const w = options.width ?? outerWidth, h = options.height ?? outerHeight;
  const fit = Math.min(outerWidth / w, outerHeight / h);
  let scale = fit;
  if (options.scaleStep > 0) {
    const snapped = Math.floor((fit / options.scaleStep) + 1e-12) * options.scaleStep;
    scale = Number.isFinite(snapped) && snapped > 0 ? snapped : snapped === 0 ? options.scaleStep : fit;
  }
  return { w, h, scale, x: (outerWidth - w * scale) / 2, y: (outerHeight - h * scale) / 2,
    outerWidth, outerHeight };
}

export function createInnerCanvas(outerCanvas, initial = {}, { updateRate = null, onResize = () => {},
  onError = error => { throw error; },
  ResizeObserver: Observer = globalThis.ResizeObserver, createCanvas = (w, h) => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const innerCanvas = outerCanvas.ownerDocument.createElement('canvas'); innerCanvas.width = w; innerCanvas.height = h; return innerCanvas;
} } = {}) {
  let requestedUps = updateRate?.requestedUps ?? 60;
  let requested = validateInnerOptions(initial), applied = { ...requested }, limit = Infinity;
  let destroyed = false;
  const boundsSize = () => {
    const bounds = outerCanvas.getBoundingClientRect();
    return { width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) };
  };
  const resizeOuter = size => {
    if (outerCanvas.width !== size.width) outerCanvas.width = size.width;
    if (outerCanvas.height !== size.height) outerCanvas.height = size.height;
  };
  resizeOuter(boundsSize());
  const initialLayout = canvasLayout(outerCanvas.width, outerCanvas.height, applied);
  const innerCanvas = createCanvas(initialLayout.w, initialLayout.h);
  const outerContext = outerCanvas.getContext('2d');
  if (!outerContext) throw new Error('Canvas 2D is required for outer canvas presentation');
  const layout = () => canvasLayout(outerCanvas.width, outerCanvas.height, applied);
  const sync = (maxDimension = limit) => {
    if (destroyed) return null;
    const size = boundsSize();
    const next = canvasLayout(size.width, size.height, requested);
    if (next.w > maxDimension || next.h > maxDimension) throw new RangeError('Inner canvas dimensions exceed the GPU texture limit');
    limit = maxDimension;
    resizeOuter(size);
    const oldWidth = innerCanvas.width, oldHeight = innerCanvas.height;
    if (innerCanvas.width !== next.w) innerCanvas.width = next.w;
    if (innerCanvas.height !== next.h) innerCanvas.height = next.h;
    applied = { ...requested };
    return oldWidth === next.w && oldHeight === next.h ? null : dict('w', next.w, 'h', next.h,
      'wh', vector(2, [next.w, next.h]), 'old-w', oldWidth, 'old-h', oldHeight, 'old-wh', vector(2, [oldWidth, oldHeight]));
  };
  const configure = patch => {
    const next = validateInnerOptions(patch, requested), size = canvasLayout(outerCanvas.width, outerCanvas.height, next);
    if (size.w > limit || size.h > limit) throw new RangeError('Inner canvas dimensions exceed the GPU texture limit');
    requested = next;
    return dict('w', requested.width, 'h', requested.height, 'scale-step', requested.scaleStep);
  };
  const toInner = (x, y) => {
    const view = layout();
    const innerX = (x - view.x) / view.scale, innerY = (y - view.y) / view.scale;
    return { x: innerX, y: innerY, w: view.w, h: view.h, inside: innerX >= 0 && innerY >= 0 && innerX < view.w && innerY < view.h };
  };
  const toOuter = (x, y) => {
    const view = layout();
    return { x: view.x + x * view.scale, y: view.y + y * view.scale };
  };
  const noArgs = (args, name) => { if (args.length) throw new TypeError(`${name} expects no arguments`); };
  const bindings = {
    configure: (...args) => {
      const options = args.length === 1 && dataKind(args[0]) === 'dict' ? args[0] : dict(...args);
      const ups = Object.hasOwn(options.values, 'ups') ? validateUps(options.values.ups) : requestedUps;
      const patch = {}, names = { w: 'width', h: 'height', 'scale-step': 'scaleStep' };
      for (const [key, value] of Object.entries(options.values)) {
        if (key === 'ups') continue;
        if (!Object.hasOwn(names, key)) throw new TypeError(`Unknown inner canvas option: ${key}`);
        patch[names[key]] = value;
      }
      const result = configure(patch);
      updateRate?.configureUps(ups);
      requestedUps = ups;
      put(result, 'ups', ups);
      return result;
    },
    canvas: (...args) => {
      noArgs(args, 'canvas'); const view = layout();
      return dict('w', view.w, 'h', view.h, 'wh', vector(2, [view.w, view.h]));
    },
  };
  registerConfigureBinding(bindings.configure);
  const observer = Observer ? new Observer(() => {
    if (destroyed) return;
    try {
      const event = sync();
      if (event) onResize(event);
    } catch (error) { onError(error); }
  }) : null;
  observer?.observe(outerCanvas);
  return { innerCanvas, outerCanvas, outerContext, layout, sync, configure, toInner, toOuter, bindings,
    destroy() { destroyed = true; observer?.disconnect(); },
    paint() {
      const view = layout();
      outerContext.save();
      try {
        outerContext.setTransform(1, 0, 0, 1, 0, 0);
        outerContext.globalAlpha = 1; outerContext.globalCompositeOperation = 'source-over';
        outerContext.filter = 'none'; outerContext.shadowBlur = 0; outerContext.shadowColor = 'transparent';
        outerContext.imageSmoothingEnabled = false;
        outerContext.fillStyle = 'black'; outerContext.fillRect(0, 0, outerCanvas.width, outerCanvas.height);
        outerContext.drawImage(innerCanvas, view.x, view.y, view.w * view.scale, view.h * view.scale);
      } finally { outerContext.restore(); }
    },
  };
}
