import { Data } from './data.js';

const __instances__ = new WeakSet();

function __requireEvents__(events, name, operation) {
  if (!__instances__.has(events))
    throw new TypeError(`Events.${operation} expects an events instance`);
  if (typeof name !== 'string')
    throw new TypeError(`Events.${operation} expects a string event name`);
}

function __requireHandler__(handler, operation) {
  if (typeof handler !== 'function')
    throw new TypeError(`Events.${operation} expects a function handler`);
}

export const Events = Data.registerHostData({
  new() {
    if (arguments.length !== 0) throw new TypeError('Events.new expects no arguments');
    const events = Data.registerHostData({
      __handlers__: new Map(),
      __queue__: [],
      __dispatching__: false,
    });
    __instances__.add(events);
    return events;
  },
  on(events, name, handler) {
    if (arguments.length !== 3)
      throw new TypeError('Events.on expects an events instance, name, and handler');
    __requireEvents__(events, name, 'on');
    __requireHandler__(handler, 'on');
    const handlers = events.__handlers__.get(name) ?? new Set();
    handlers.add(handler);
    events.__handlers__.set(name, handlers);
    return handler;
  },
  off(events, name, handler) {
    if (arguments.length !== 3)
      throw new TypeError('Events.off expects an events instance, name, and handler');
    __requireEvents__(events, name, 'off');
    __requireHandler__(handler, 'off');
    const handlers = events.__handlers__.get(name);
    handlers?.delete(handler);
    if (handlers?.size === 0) events.__handlers__.delete(name);
    return handler;
  },
  emit(events, name, value) {
    if (arguments.length !== 3)
      throw new TypeError('Events.emit expects an events instance, name, and value');
    __requireEvents__(events, name, 'emit');
    const payload = Data.languageValue(value);
    events.__queue__.push({
      handlers: [...(events.__handlers__.get(name) ?? [])],
      value: payload,
    });
    if (events.__dispatching__) return events;
    events.__dispatching__ = true;
    try {
      for (let i = 0; i < events.__queue__.length; i++) {
        const emission = events.__queue__[i];
        for (const handler of emission.handlers) handler(emission.value);
      }
      return events;
    } finally {
      events.__queue__.length = 0;
      events.__dispatching__ = false;
    }
  },
});
