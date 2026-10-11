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
const __isConfigureBinding__ = (value) => __configurationBindings__.has(value);
const __registerConfigureBinding__ = (value) => {
  __configurationBindings__.add(value);
  return value;
};

export const Contracts = {
  inputCallbacks: __inputCallbacks__,
  isConfigureBinding: __isConfigureBinding__,
  registerConfigureBinding: __registerConfigureBinding__,
};
