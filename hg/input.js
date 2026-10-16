import { Data } from './data.js';

import { Contracts } from './contracts.js';

const __modifiers__ = (event) => [
  'alt',
  !!event.altKey,
  'ctrl',
  !!event.ctrlKey,
  'shift',
  !!event.shiftKey,
  'meta',
  !!event.metaKey,
];
const __index__ = (value) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Input index must be a nonnegative integer');
  return value;
};

function __createInput__(
  outerCanvas,
  {
    emit = () => {},
    listen = true,
    window = globalThis.window,
    navigator = globalThis.navigator,
    coordinates = (x, y) => ({
      x,
      y,
      w: outerCanvas.width,
      h: outerCanvas.height,
      inside: x >= 0 && y >= 0 && x < outerCanvas.width && y < outerCanvas.height,
    }),
  } = {},
) {
  const service = { outerCanvas, emit, window, navigator, coordinates, listen, active: listen };
  service.keys = new Set();
  service.pointers = new Map();
  service.pads = new Map();
  service.listeners = [];
  service.captured = new Set();
  service.pointerPositions = new WeakMap();
  service.primary = null;
  service.destroyed = false;
  service.__oldCursor__ = service.outerCanvas.style?.cursor ?? '';
  service.__oldCursorPriority__ = service.outerCanvas.style?.getPropertyPriority?.('cursor') ?? '';
  service.__cursor__ = null;
  service.generation = 0;
  service.oldTabIndex = service.outerCanvas.getAttribute('tabindex');
  if (listen) {
    if (service.outerCanvas.tabIndex < 0) service.outerCanvas.tabIndex = 0;
    __listen__(service, service.outerCanvas, 'keydown', (event) => __key__(service, event, true));
    __listen__(service, service.outerCanvas, 'contextmenu', (event) => event.preventDefault());
    __listen__(service, service.window, 'keyup', (event) => {
      if (
        service.keys.has(event.code) ||
        service.outerCanvas.ownerDocument.activeElement === service.outerCanvas
      )
        __key__(service, event, false);
    });
    for (const name of Contracts.inputCallbacks.filter((name) => name.startsWith('pointer')))
      __listen__(service, service.outerCanvas, name, (event) => {
        if (name === 'pointerdown') {
          service.outerCanvas.focus({ preventScroll: true });
          try {
            service.outerCanvas.setPointerCapture(event.pointerId);
            service.captured.add(event.pointerId);
          } catch {}
        }
        const state = __pointerValue__(service, event);
        service.pointers.set(event.pointerId, state);
        if (event.isPrimary) service.primary = event.pointerId;
        if (
          name === 'pointercancel' ||
          (name === 'pointerup' && event.pointerType !== 'mouse') ||
          (name === 'pointerleave' && !event.buttons)
        ) {
          service.pointers.delete(event.pointerId);
          if (service.primary === event.pointerId) service.primary = null;
        }
        if (name === 'pointerup' || name === 'pointercancel')
          service.captured.delete(event.pointerId);
        __dispatch__(service, name, state);
        // TextProxy may take keyboard focus during dispatch. Restore capture after
        // its canvas blur so selection drags still receive movement off the canvas.
        if (name === 'pointerdown' && !service.destroyed && event.buttons) {
          service.pointers.set(event.pointerId, state);
          if (event.isPrimary) service.primary = event.pointerId;
          try {
            service.outerCanvas.setPointerCapture(event.pointerId);
            service.captured.add(event.pointerId);
          } catch {}
        }
      });
    __listen__(service, service.outerCanvas, 'lostpointercapture', (event) => {
      service.captured.delete(event.pointerId);
      const state = service.pointers.get(event.pointerId);
      if (state?.buttons) {
        service.pointers.delete(event.pointerId);
        if (service.primary === event.pointerId) service.primary = null;
        state.buttons = 0;
        state.pressure = 0;
        __dispatch__(service, 'pointercancel', __pointerSnapshot__(service, state));
      }
    });
    __listen__(service, service.outerCanvas, 'wheel', (event) => {
      const rect = service.outerCanvas.getBoundingClientRect();
      const point = service.coordinates(
        (((event.clientX ?? rect.left) - rect.left) * service.outerCanvas.width) / (rect.width || 1),
        (((event.clientY ?? rect.top) - rect.top) * service.outerCanvas.height) / (rect.height || 1),
      );
      const result = __dispatch__(
        service,
        'wheel',
        Data.dict(
          'dx',
          event.deltaX,
          'dy',
          event.deltaY,
          'dz',
          event.deltaZ,
          'mode',
          event.deltaMode,
          'x',
          point.x,
          'y',
          point.y,
          'inside',
          point.inside,
          'prevent-default',
          false,
          ...__modifiers__(event),
        ),
      );
      if (result?.['prevent-default']) event.preventDefault();
    });
  }
  __listen__(service, service.outerCanvas, 'blur', (...args) => __reset__(service, ...args));
  __listen__(service, service.window, 'blur', (...args) => __reset__(service, ...args));
  __listen__(service, service.outerCanvas.ownerDocument, 'visibilitychange', () => {
    if (service.outerCanvas.ownerDocument.hidden) __reset__(service);
  });
  service.bindings = {
    cursor: (...args) => {
      if (args.length !== 1) throw new TypeError('cursor expects one CSS cursor string or nil');
      return __cursor__(service, args[0]);
    },
    'key?': (...args) => {
      if (args.length !== 1 || typeof args[0] !== 'string')
        throw new TypeError('key? expects a keyboard code string');
      return service.keys.has(args[0]);
    },
    'pointer?': (...args) => {
      if (args.length < 1 || args.length > 2)
        throw new TypeError('pointer? expects a button mask and optional pointer id');
      const mask = args[0];
      if (!Number.isSafeInteger(mask) || mask <= 0 || mask > 0xffffffff)
        throw new TypeError('pointer? expects a positive 32-bit button mask');
      const state = service.pointers.get(args.length === 2 ? __index__(args[1]) : service.primary);
      return !!state && (state.buttons & mask) >>> 0 === mask;
    },
    'joy?': (...args) => {
      if (args.length < 1 || args.length > 2)
        throw new TypeError('joy? expects a button index and optional gamepad index');
      const button = __index__(args[0]),
        pad = service.pads.get(args.length === 2 ? __index__(args[1]) : 0);
      return pad?.buttons[button]?.pressed ?? false;
    },
    pointer: (...args) => {
      if (args.length > 1) throw new TypeError('pointer expects zero or one pointer id');
      return __pointerSnapshot__(
        service,
        service.pointers.get(args.length ? __index__(args[0]) : service.primary),
      );
    },
    pointers: (...args) => {
      if (args.length) throw new TypeError('pointers expects no arguments');
      return Data.list(
        ...Array.from(service.pointers.values(), (...args) =>
          __pointerSnapshot__(service, ...args),
        ),
      );
    },
    joy: (...args) => {
      if (args.length !== 1) throw new TypeError('joy expects one index');
      return Data.reCopy(service.pads.get(__index__(args[0])) ?? null);
    },
    joys: (...args) => {
      if (args.length) throw new TypeError('joys expects no arguments');
      return Data.list(...Array.from(service.pads.values(), (value) => Data.reCopy(value)));
    },
  };
  return service;
}

function __listen__(service, target, name, fn) {
  target.addEventListener(name, fn);
  service.listeners.push(() => target.removeEventListener(name, fn));
}

function __dispatch__(service, name, value) {
  if (service.destroyed) return;
  const snapshot = Data.reCopy(value);
  service.emit(name, snapshot);
  return snapshot;
}

function __reset__(service) {
  service.generation++;
  service.keys.clear();
  service.pointers.clear();
  service.pads.clear();
  service.primary = null;
  for (const id of service.captured) {
    try {
      if (service.outerCanvas.hasPointerCapture?.(id))
        service.outerCanvas.releasePointerCapture(id);
    } catch {}
  }
  service.captured.clear();
}

function __key__(service, event, down) {
  if (
    service.outerCanvas.ownerDocument.activeElement === service.outerCanvas &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    [
      'Space',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End',
    ].includes(event.code)
  ) {
    event.preventDefault();
  }
  if (down) service.keys.add(event.code);
  else service.keys.delete(event.code);
  const result = __dispatch__(
    service,
    down ? 'keydown' : 'keyup',
    Data.dict(
      'code',
      event.code,
      'key',
      event.key,
      'repeat',
      !!event.repeat,
      'prevent-default',
      false,
      ...__modifiers__(event),
    ),
  );
  if (result?.['prevent-default']) event.preventDefault();
}

function __pointerSnapshot__(service, state) {
  if (!state) return null;
  const snapshot = Data.reCopy(state),
    [x, y] = service.pointerPositions.get(state);
  const rect = service.listen ? service.outerCanvas.getBoundingClientRect() : null;
  const inner = service.coordinates(
    rect ? ((x - rect.left) * service.outerCanvas.width) / (rect.width || 1) : x,
    rect ? ((y - rect.top) * service.outerCanvas.height) / (rect.height || 1) : y,
  );
  Object.assign(snapshot, {
    x: inner.x,
    y: inner.y,
    xy: Data.vector(2, [inner.x, inner.y]),
    uv: Data.vector(2, [inner.x / (inner.w || 1), inner.y / (inner.h || 1)]),
    inside: inner.inside,
  });
  service.pointerPositions.set(snapshot, [x, y]);
  return snapshot;
}

function __pointerValue__(service, event) {
  const x = event.clientX;
  const y = event.clientY;
  const state = Data.dict(
    'id',
    event.pointerId,
    'type',
    event.pointerType,
    'primary',
    !!event.isPrimary,
    'button',
    event.button,
    'buttons',
    event.buttons,
    'pressure',
    event.pressure ?? 0,
    ...__modifiers__(event),
  );
  service.pointerPositions.set(state, [x, y]);
  return __pointerSnapshot__(service, state);
}

function __snapshotPad__(service, pad) {
  return Data.dict(
    'index',
    pad.index,
    'id',
    pad.id,
    'mapping',
    pad.mapping,
    'connected',
    pad.connected,
    'timestamp',
    pad.timestamp,
    'axes',
    Data.list(...pad.axes),
    'buttons',
    Data.list(
      ...pad.buttons.map((button) =>
        Data.dict('pressed', button.pressed, 'touched', button.touched, 'value', button.value),
      ),
    ),
  );
}

function __poll__(service) {
  if (service.destroyed || !service.active || service.outerCanvas.ownerDocument.hidden) return;
  const currentGeneration = service.generation;
  let devices;
  try {
    devices = service.navigator?.getGamepads?.() ?? [];
  } catch {
    devices = [];
  }
  const next = new Map(
    Array.from(devices)
      .filter((pad) => pad?.connected)
      .map((pad) => [pad.index, __snapshotPad__(service, pad)]),
  );
  const previous = new Map(service.pads);
  service.pads.clear();
  for (const [id, pad] of next) service.pads.set(id, pad);
  for (const [id, old] of previous) {
    if (service.generation !== currentGeneration) return;
    if (!next.has(id)) {
      old.connected = false;
      __dispatch__(service, 'joydisconnected', old);
    }
  }
  for (const [id, pad] of next) {
    if (service.generation !== currentGeneration) return;
    const old = previous.get(id);
    if (!old) __dispatch__(service, 'joyconnected', pad);
    pad.buttons.forEach((button, i) => {
      if (service.generation !== currentGeneration) return;
      const was = old?.buttons[i]?.pressed ?? false;
      if (button.pressed !== was)
        __dispatch__(
          service,
          button.pressed ? 'joydown' : 'joyup',
          Data.dict('index', id, 'button', i, 'value', button.value, 'pressed', button.pressed),
        );
    });
    pad.axes.forEach((value, i) => {
      if (service.generation !== currentGeneration) return;
      if (value !== (old?.axes[i] ?? 0))
        __dispatch__(service, 'joyaxis', Data.dict('index', id, 'axis', i, 'value', value));
    });
  }
}

function __restoreCursor__(service) {
  if (!service.listen) { service.__cursor__ = null; return; }
  const style = service.outerCanvas.style;
  if (style && service.__cursor__ !== null && style.cursor === service.__cursor__) {
    if (service.__oldCursor__) {
      style.setProperty('cursor', service.__oldCursor__, service.__oldCursorPriority__);
    } else {
      style.removeProperty('cursor');
    }
  }
  service.__cursor__ = null;
}

function __cursor__(service, value) {
  if (value === null) {
    __restoreCursor__(service);
    return null;
  }
  if (service.destroyed) throw new TypeError('Cursor input service has been destroyed');
  if (typeof value !== 'string' || !value.trim())
    throw new TypeError('cursor expects a nonempty CSS cursor string or nil');
  if (!service.listen) return (service.__cursor__ = value);
  if (service.outerCanvas.style.cursor !== value) service.outerCanvas.style.cursor = value;
  service.__cursor__ = service.outerCanvas.style.cursor;
  return service.__cursor__;
}

function __destroy__(service) {
  __restoreCursor__(service);
  service.destroyed = true;
  __reset__(service);
  service.listeners.forEach((remove) => remove());
  if (!service.listen) return;
  if (service.oldTabIndex === null) service.outerCanvas.removeAttribute('tabindex');
  else service.outerCanvas.setAttribute('tabindex', service.oldTabIndex);
}

// Forward canonical input through the same held-state queries and event dispatch.
function __feed__(service, name, value) {
  if (service.destroyed || (!service.active && name.startsWith("key"))) return;
  let state = Data.reCopy(value);
  if (name === 'keydown') service.keys.add(state.code);
  if (name === 'keyup') service.keys.delete(state.code);
  if (name.startsWith('pointer')) {
    service.pointerPositions.set(state, [state.x, state.y]);
    state = __pointerSnapshot__(service, state);
    service.pointers.set(state.id, state);
    if (state.primary) service.primary = state.id;
    if (name === 'pointercancel' || (name === 'pointerup' && state.type !== 'mouse') ||
      (name === 'pointerleave' && !state.buttons)) {
      service.pointers.delete(state.id);
      if (service.primary === state.id) service.primary = null;
    }
  } else if (name === 'wheel') {
    Object.assign(state, service.coordinates(state.x, state.y));
  }
  return __dispatch__(service, name, state);
}

export const Input = {
  new: __createInput__,
  feed: __feed__,
  poll: __poll__,
  reset: __reset__,
  cursor: __cursor__,
  destroy: __destroy__,
};
