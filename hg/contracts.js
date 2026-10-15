// Shared execution contracts; no DOM or GPU dependencies.
const __inputCallbacks__ = [
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'pointerenter',
  'pointerleave',
  'wheel',
  'joyconnected',
  'joydisconnected',
  'joydown',
  'joyup',
  'joyaxis',
];
const __configurationBindings__ = new WeakSet();
const __originBindings__ = new WeakMap();
function __withOrigin__(fn, fallback = null) {
  if (typeof fn !== 'function') throw new TypeError('withOrigin expects a function');
  const callable = (...args) => fn(fallback, ...args);
  __originBindings__.set(callable, { fn, fallback });
  return callable;
}
function __call__(fn, args, origin) {
  const binding = __originBindings__.get(fn);
  return binding ? binding.fn(origin ?? binding.fallback, ...args) : fn(...args);
}
const __isConfigureBinding__ = (value) => __configurationBindings__.has(value);
const __registerConfigureBinding__ = (value) => {
  __configurationBindings__.add(value);
  return value;
};

export const Contracts = {
  inputCallbacks: __inputCallbacks__,
  isConfigureBinding: __isConfigureBinding__,
  registerConfigureBinding: __registerConfigureBinding__,
  withOrigin: __withOrigin__,
  isOriginBinding: (value) => __originBindings__.has(value),
  call: __call__,
};
