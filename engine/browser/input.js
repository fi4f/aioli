import { dict, list, vector, reCopy } from '../language/data.js';

import { inputCallbacks } from '../runtime/contracts.js';
export { inputCallbacks } from '../runtime/contracts.js';
const modifiers = event => ['alt', !!event.altKey, 'ctrl', !!event.ctrlKey, 'shift', !!event.shiftKey, 'meta', !!event.metaKey];
const index = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Input index must be a nonnegative integer');
  return value;
};

export function createInput(outerCanvas, { emit = () => {}, window = globalThis.window, navigator = globalThis.navigator,
  coordinates = (x, y) => ({ x, y, w: outerCanvas.width, h: outerCanvas.height, inside: x >= 0 && y >= 0 && x < outerCanvas.width && y < outerCanvas.height }),
} = {}) {
  const keys = new Set(), pointers = new Map(), pads = new Map(), listeners = [], captured = new Set();
  const pointerPositions = new WeakMap();
  let primary = null, destroyed = false, generation = 0;
  const oldTabIndex = outerCanvas.getAttribute('tabindex');
  if (outerCanvas.tabIndex < 0) outerCanvas.tabIndex = 0;
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn);
    listeners.push(() => target.removeEventListener(name, fn));
  };
  const dispatch = (name, value) => { if (!destroyed) emit(name, reCopy(value)); };
  const reset = () => {
    generation++;
    keys.clear(); pointers.clear(); pads.clear(); primary = null;
    for (const id of captured) {
      try { if (outerCanvas.hasPointerCapture?.(id)) outerCanvas.releasePointerCapture(id); } catch {}
    }
    captured.clear();
  };
  const key = (event, down) => {
    if (outerCanvas.ownerDocument.activeElement === outerCanvas && !event.ctrlKey && !event.metaKey && !event.altKey &&
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.code)) {
      event.preventDefault();
    }
    if (down) keys.add(event.code); else keys.delete(event.code);
    dispatch(down ? 'keydown' : 'keyup', dict('code', event.code, 'key', event.key, 'repeat', !!event.repeat, ...modifiers(event)));
  };
  listen(outerCanvas, 'keydown', event => key(event, true));
  listen(outerCanvas, 'contextmenu', event => event.preventDefault());
  listen(window, 'keyup', event => { if (keys.has(event.code) || outerCanvas.ownerDocument.activeElement === outerCanvas) key(event, false); });
  listen(outerCanvas, 'blur', reset);
  listen(window, 'blur', reset);
  listen(outerCanvas.ownerDocument, 'visibilitychange', () => { if (outerCanvas.ownerDocument.hidden) reset(); });
  const pointerSnapshot = state => {
    if (!state) return null;
    const snapshot = reCopy(state), [x, y] = pointerPositions.get(state);
    const rect = outerCanvas.getBoundingClientRect();
    const inner = coordinates((x - rect.left) * outerCanvas.width / (rect.width || 1),
      (y - rect.top) * outerCanvas.height / (rect.height || 1));
    Object.assign(snapshot.values, { x: inner.x, y: inner.y, xy: vector(2, [inner.x, inner.y]),
      uv: vector(2, [inner.x / (inner.w || 1), inner.y / (inner.h || 1)]), inside: inner.inside });
    pointerPositions.set(snapshot, [x, y]);
    return snapshot;
  };
  const pointerValue = event => {
    const x = event.clientX;
    const y = event.clientY;
    const state = dict('id', event.pointerId, 'type', event.pointerType, 'primary', !!event.isPrimary,
      'button', event.button, 'buttons', event.buttons, 'pressure', event.pressure ?? 0, ...modifiers(event));
    pointerPositions.set(state, [x, y]);
    return pointerSnapshot(state);
  };
  for (const name of inputCallbacks.filter(name => name.startsWith('pointer'))) listen(outerCanvas, name, event => {
    if (name === 'pointerdown') {
      outerCanvas.focus({ preventScroll: true });
      try { outerCanvas.setPointerCapture(event.pointerId); captured.add(event.pointerId); } catch {}
    }
    const state = pointerValue(event);
    pointers.set(event.pointerId, state);
    if (event.isPrimary) primary = event.pointerId;
    if (name === 'pointercancel' || name === 'pointerup' && event.pointerType !== 'mouse' || name === 'pointerleave' && !event.buttons) {
      pointers.delete(event.pointerId);
      if (primary === event.pointerId) primary = null;
    }
    if (name === 'pointerup' || name === 'pointercancel') captured.delete(event.pointerId);
    dispatch(name, state);
  });
  listen(outerCanvas, 'lostpointercapture', event => {
    captured.delete(event.pointerId);
    const state = pointers.get(event.pointerId);
    if (state?.values.buttons) {
      pointers.delete(event.pointerId);
      if (primary === event.pointerId) primary = null;
      state.values.buttons = 0; state.values.pressure = 0;
      dispatch('pointercancel', pointerSnapshot(state));
    }
  });
  listen(outerCanvas, 'wheel', event => dispatch('wheel', dict('dx', event.deltaX, 'dy', event.deltaY, 'dz', event.deltaZ, 'mode', event.deltaMode, ...modifiers(event))));
  const snapshotPad = pad => dict('index', pad.index, 'id', pad.id, 'mapping', pad.mapping, 'connected', pad.connected,
    'timestamp', pad.timestamp, 'axes', list(...pad.axes),
    'buttons', list(...pad.buttons.map(button => dict('pressed', button.pressed, 'touched', button.touched, 'value', button.value))));
  const poll = () => {
    if (destroyed || outerCanvas.ownerDocument.hidden) return;
    const currentGeneration = generation;
    let devices;
    try { devices = navigator?.getGamepads?.() ?? []; } catch { devices = []; }
    const next = new Map(Array.from(devices).filter(pad => pad?.connected).map(pad => [pad.index, snapshotPad(pad)]));
    const previous = new Map(pads);
    pads.clear(); for (const [id, pad] of next) pads.set(id, pad);
    for (const [id, old] of previous) {
      if (generation !== currentGeneration) return;
      if (!next.has(id)) { old.values.connected = false; dispatch('joydisconnected', old); }
    }
    for (const [id, pad] of next) {
      if (generation !== currentGeneration) return;
      const old = previous.get(id);
      if (!old) dispatch('joyconnected', pad);
      pad.values.buttons.values.forEach((button, i) => {
        if (generation !== currentGeneration) return;
        const was = old?.values.buttons.values[i]?.values.pressed ?? false;
        if (button.values.pressed !== was) dispatch(button.values.pressed ? 'joydown' : 'joyup', dict('index', id, 'button', i, 'value', button.values.value, 'pressed', button.values.pressed));
      });
      pad.values.axes.values.forEach((value, i) => {
        if (generation !== currentGeneration) return;
        if (value !== (old?.values.axes.values[i] ?? 0)) dispatch('joyaxis', dict('index', id, 'axis', i, 'value', value));
      });
    }
  };
  const bindings = {
    'key?': (...args) => {
      if (args.length !== 1 || typeof args[0] !== 'string') throw new TypeError('key? expects a keyboard code string');
      return keys.has(args[0]);
    },
    'pointer?': (...args) => {
      if (args.length < 1 || args.length > 2) throw new TypeError('pointer? expects a button mask and optional pointer id');
      const mask = args[0];
      if (!Number.isSafeInteger(mask) || mask <= 0 || mask > 0xffffffff) throw new TypeError('pointer? expects a positive 32-bit button mask');
      const state = pointers.get(args.length === 2 ? index(args[1]) : primary);
      return !!state && ((state.values.buttons & mask) >>> 0) === mask;
    },
    'joy?': (...args) => {
      if (args.length < 1 || args.length > 2) throw new TypeError('joy? expects a button index and optional gamepad index');
      const button = index(args[0]), pad = pads.get(args.length === 2 ? index(args[1]) : 0);
      return pad?.values.buttons.values[button]?.values.pressed ?? false;
    },
    pointer: (...args) => {
      if (args.length > 1) throw new TypeError('pointer expects zero or one pointer id');
      return pointerSnapshot(pointers.get(args.length ? index(args[0]) : primary));
    },
    pointers: (...args) => { if (args.length) throw new TypeError('pointers expects no arguments'); return list(...Array.from(pointers.values(), pointerSnapshot)); },
    joy: (...args) => { if (args.length !== 1) throw new TypeError('joy expects one index'); return reCopy(pads.get(index(args[0])) ?? null); },
    joys: (...args) => { if (args.length) throw new TypeError('joys expects no arguments'); return list(...Array.from(pads.values(), value => reCopy(value))); },
  };
  return { bindings, poll, reset, destroy() {
    destroyed = true; reset(); listeners.forEach(remove => remove());
    if (oldTabIndex === null) outerCanvas.removeAttribute('tabindex'); else outerCanvas.setAttribute('tabindex', oldTabIndex);
  } };
}
