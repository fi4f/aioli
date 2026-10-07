// Shared execution contracts; no DOM or GPU dependencies.
export const inputCallbacks = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'pointerenter', 'pointerleave', 'wheel', 'joyconnected', 'joydisconnected', 'joydown', 'joyup', 'joyaxis'];
const configurationBindings = new WeakSet();
export const isConfigureBinding = value => configurationBindings.has(value);
export const registerConfigureBinding = value => { configurationBindings.add(value); return value; };
