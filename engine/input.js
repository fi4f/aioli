import { dict, list, vector, reCopy } from './data.js';

export const inputCallbacks = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'pointerenter', 'pointerleave', 'wheel', 'joyconnected', 'joydisconnected', 'joydown', 'joyup', 'joyaxis'];
const modifiers = event => ['alt', !!event.altKey, 'ctrl', !!event.ctrlKey, 'shift', !!event.shiftKey, 'meta', !!event.metaKey];
const index = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Input index must be a nonnegative integer');
  return value;
};

export function createInput(canvas, { emit = () => {}, window = globalThis.window, navigator = globalThis.navigator } = {}) {
  const keys = new Set(), pointers = new Map(), pads = new Map(), listeners = [], captured = new Set();
  let primary = null, destroyed = false, generation = 0;
  const oldTabIndex = canvas.getAttribute('tabindex');
  if (canvas.tabIndex < 0) canvas.tabIndex = 0;
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn);
    listeners.push(() => target.removeEventListener(name, fn));
  };
  const dispatch = (name, value) => { if (!destroyed) emit(name, reCopy(value)); };
  const reset = () => {
    generation++;
    keys.clear(); pointers.clear(); pads.clear(); primary = null;
    for (const id of captured) {
      try { if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id); } catch {}
    }
    captured.clear();
  };
  const key = (event, down) => {
    if (canvas.ownerDocument.activeElement === canvas && !event.ctrlKey && !event.metaKey && !event.altKey &&
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.code)) {
      event.preventDefault();
    }
    if (down) keys.add(event.code); else keys.delete(event.code);
    dispatch(down ? 'keydown' : 'keyup', dict('code', event.code, 'key', event.key, 'repeat', !!event.repeat, ...modifiers(event)));
  };
  listen(canvas, 'keydown', event => key(event, true));
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(window, 'keyup', event => { if (keys.has(event.code) || canvas.ownerDocument.activeElement === canvas) key(event, false); });
  listen(canvas, 'blur', reset);
  listen(window, 'blur', reset);
  listen(canvas.ownerDocument, 'visibilitychange', () => { if (canvas.ownerDocument.hidden) reset(); });
  const pointerValue = event => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / (rect.width || 1);
    const y = (event.clientY - rect.top) * canvas.height / (rect.height || 1);
    return dict('id', event.pointerId, 'type', event.pointerType, 'primary', !!event.isPrimary,
      'x', x, 'y', y, 'xy', vector(2, [x, y]), 'uv', vector(2, [x / (canvas.width || 1), y / (canvas.height || 1)]),
      'button', event.button, 'buttons', event.buttons, 'pressure', event.pressure ?? 0, ...modifiers(event));
  };
  for (const name of inputCallbacks.filter(name => name.startsWith('pointer'))) listen(canvas, name, event => {
    if (name === 'pointerdown') {
      canvas.focus({ preventScroll: true });
      try { canvas.setPointerCapture(event.pointerId); captured.add(event.pointerId); } catch {}
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
  listen(canvas, 'lostpointercapture', event => {
    captured.delete(event.pointerId);
    const state = pointers.get(event.pointerId);
    if (state?.values.buttons) {
      pointers.delete(event.pointerId);
      if (primary === event.pointerId) primary = null;
      state.values.buttons = 0; state.values.pressure = 0;
      dispatch('pointercancel', state);
    }
  });
  listen(canvas, 'wheel', event => dispatch('wheel', dict('dx', event.deltaX, 'dy', event.deltaY, 'dz', event.deltaZ, 'mode', event.deltaMode, ...modifiers(event))));
  const snapshotPad = pad => dict('index', pad.index, 'id', pad.id, 'mapping', pad.mapping, 'connected', pad.connected,
    'timestamp', pad.timestamp, 'axes', list(...pad.axes),
    'buttons', list(...pad.buttons.map(button => dict('pressed', button.pressed, 'touched', button.touched, 'value', button.value))));
  const poll = () => {
    if (destroyed || canvas.ownerDocument.hidden) return;
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
      return reCopy(pointers.get(args.length ? index(args[0]) : primary) ?? null);
    },
    pointers: (...args) => { if (args.length) throw new TypeError('pointers expects no arguments'); return list(...Array.from(pointers.values(), value => reCopy(value))); },
    joy: (...args) => { if (args.length !== 1) throw new TypeError('joy expects one index'); return reCopy(pads.get(index(args[0])) ?? null); },
    joys: (...args) => { if (args.length) throw new TypeError('joys expects no arguments'); return list(...Array.from(pads.values(), value => reCopy(value))); },
  };
  return { bindings, poll, reset, destroy() {
    destroyed = true; reset(); listeners.forEach(remove => remove());
    if (oldTabIndex === null) canvas.removeAttribute('tabindex'); else canvas.setAttribute('tabindex', oldTabIndex);
  } };
}
