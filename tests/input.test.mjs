import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInput, inputCallbacks } from '../engine/input.js';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { get, put } from '../engine/data.js';
import { ScenePlayer } from '../engine/scenes.js';

function harness(onEvent = () => {}) {
  const document = new EventTarget(), window = new EventTarget(), canvas = new EventTarget();
  const attributes = new Map(), captures = new Set(), events = [];
  Object.assign(canvas, { ownerDocument: document, width: 200, height: 100, tabIndex: -1,
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }),
    focus: () => { document.activeElement = canvas; },
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id),
  });
  let pads = [];
  const input = createInput(canvas, { window, navigator: { getGamepads: () => pads }, emit: (name, value) => { events.push([name, value]); onEvent(name, value); } });
  const send = (target, name, values = {}) => target.dispatchEvent(Object.assign(new Event(name), values));
  return { input, canvas, document, window, events, captures, send, pads: value => { pads = value; } };
}

test('keyboard is canvas scoped, repeats are preserved, blur resets state and teardown removes listeners', () => {
  const h = harness();
  h.send(h.canvas, 'keydown', { code: 'KeyW', key: 'w', repeat: false });
  assert.equal(h.input.bindings['key?']('KeyW'), true);
  h.send(h.canvas, 'keydown', { code: 'KeyW', key: 'w', repeat: true });
  assert.equal(get(h.events.at(-1)[1], 'repeat'), true);
  h.send(h.window, 'keyup', { code: 'KeyW', key: 'w' });
  assert.equal(h.input.bindings['key?']('KeyW'), false);
  h.send(h.canvas, 'keydown', { code: 'Space', key: ' ' });
  h.send(h.window, 'blur');
  assert.equal(h.input.bindings['key?']('Space'), false);
  const count = h.events.length;
  h.input.destroy(); h.send(h.canvas, 'keydown', { code: 'KeyA', key: 'a' });
  assert.equal(h.events.length, count); assert.equal(h.input.bindings['key?']('KeyA'), false);
});

test('focused canvas suppresses scrolling keys while preserving navigation and browser shortcuts', () => {
  const h = harness();
  h.canvas.focus();
  const dispatch = (target, type, code, options = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, key: code, ...options });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  for (const code of ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) {
    assert.equal(dispatch(h.canvas, 'keydown', code), true);
    assert.equal(h.input.bindings['key?'](code), true);
    assert.equal(dispatch(h.window, 'keyup', code), true);
    assert.equal(h.input.bindings['key?'](code), false);
  }
  assert.equal(dispatch(h.canvas, 'keydown', 'Space', { repeat: true }), true);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(dispatch(h.canvas, 'keydown', 'Home', options), false);
  assert.equal(dispatch(h.canvas, 'keydown', 'Tab'), false);
  h.document.activeElement = null;
  assert.equal(dispatch(h.window, 'keyup', 'Space'), false);
  h.input.destroy();
  h.canvas.focus();
  assert.equal(dispatch(h.canvas, 'keydown', 'Space'), false);
});

test('canvas context menu is suppressed until input is destroyed', () => {
  const h = harness();
  const event = new Event('contextmenu', { cancelable: true });
  h.canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  const outside = new Event('contextmenu', { cancelable: true });
  h.window.dispatchEvent(outside);
  assert.equal(outside.defaultPrevented, false);
  h.input.destroy();
  const after = new Event('contextmenu', { cancelable: true });
  h.canvas.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});

test('pointer uses backing pixels, supports multiple touches, capture and independent snapshots', () => {
  const h = harness();
  const p = { pointerId: 4, pointerType: 'touch', isPrimary: true, clientX: 35, clientY: 45, button: 0, buttons: 1, pressure: 0.5 };
  h.send(h.canvas, 'pointerdown', p);
  assert.equal(h.document.activeElement, h.canvas); assert.ok(h.captures.has(4));
  assert.deepEqual(get(h.input.bindings.pointer(), 'xy').values, [50,50]);
  assert.deepEqual(get(h.input.bindings.pointer(), 'uv').values, [0.25,0.5]);
  put(h.input.bindings.pointer(), 'buttons', 99);
  assert.equal(get(h.input.bindings.pointer(), 'buttons'), 1);
  h.send(h.canvas, 'pointerdown', { ...p, pointerId: 5, isPrimary: false });
  assert.equal(h.input.bindings.pointers().values.length, 2);
  h.send(h.canvas, 'pointerup', { ...p, buttons: 0, pressure: 0 });
  assert.equal(h.input.bindings.pointer(4), null);
  h.send(h.canvas, 'lostpointercapture', { pointerId: 5 });
  assert.equal(h.input.bindings.pointers().values.length, 0);
  assert.equal(h.events.at(-1)[0], 'pointercancel');
  h.input.destroy();
});

test('gamepad polling preserves indices and emits connection, button and axis transitions once', () => {
  const h = harness();
  const pad = { index: 2, id: 'test', mapping: 'standard', connected: true, timestamp: 1, axes: [0,0], buttons: [{ pressed: false, touched: false, value: 0 }] };
  h.pads([null, null, pad]); h.input.poll(); h.input.poll();
  assert.deepEqual(h.events.map(event => event[0]), ['joyconnected']);
  assert.equal(h.input.bindings.joy(0), null);
  pad.axes[0] = 0.5; pad.buttons[0] = { pressed: true, touched: true, value: 1 };
  h.input.poll();
  assert.deepEqual(h.events.slice(1).map(event => event[0]), ['joydown','joyaxis']);
  put(get(h.input.bindings.joy(2), 'axes'), 0, 99);
  assert.equal(get(h.input.bindings.joy(2), 'axes').values[0], 0.5);
  pad.buttons[0].pressed = false; h.input.poll();
  assert.equal(h.events.at(-1)[0], 'joyup');
  h.pads([]); h.input.poll();
  assert.equal(h.events.at(-1)[0], 'joydisconnected');
  assert.equal(h.input.bindings.joy(2), null);
  for (const fn of [() => h.input.bindings.joy(-1), () => h.input.bindings.pointer(0.5), () => h.input.bindings['key?'](), () => h.input.bindings.joys(1)]) assert.throws(fn, TypeError);
  h.input.destroy();
});

test('pointer? and joy? query masks and buttons with optional device selection', () => {
  const h = harness();
  assert.equal(h.input.bindings['pointer?'](1), false);
  assert.equal(h.input.bindings['joy?'](0), false);
  const pointer = { pointerId: 7, pointerType: 'mouse', isPrimary: true, clientX: 20, clientY: 30, button: 0, buttons: 3 };
  h.send(h.canvas, 'pointerdown', pointer);
  h.send(h.canvas, 'pointerdown', { ...pointer, pointerId: 8, isPrimary: false, buttons: 4 });
  const pad = { index: 0, id: 'test', mapping: 'standard', connected: true, timestamp: 1, axes: [], buttons: [{ pressed: true, touched: true, value: 1 }] };
  h.pads([pad, { ...pad, index: 2, buttons: [{ pressed: false, touched: false, value: 0 }] }]); h.input.poll();
  for (const trace of [true, false]) {
    const result = compile('(list (pointer? 1) (pointer? 2) (pointer? 3) (pointer? 5) (pointer? 4 8) (pointer? 1 99) (joy? 0) (joy? 0 2) (joy? 99) (joy? 0 99))', { ...bindings, ...h.input.bindings }, forms, { trace }).run();
    assert.deepEqual(result.values, [true,true,true,false,true,false,true,false,false,false]);
  }
  h.send(h.canvas, 'pointerup', { ...pointer, buttons: 0 });
  assert.equal(h.input.bindings['pointer?'](1), false);
  pad.buttons[0].pressed = false; h.input.poll();
  assert.equal(h.input.bindings['joy?'](0), false);
  for (const args of [[], [0], [-1], [1.5], ['left'], [2 ** 32], [1,-1], [1,0,0]]) assert.throws(() => h.input.bindings['pointer?'](...args), TypeError);
  for (const args of [[], [-1], [0.5], ['a'], [0,-1], [0,0,0]]) assert.throws(() => h.input.bindings['joy?'](...args), TypeError);
  h.input.reset();
  assert.equal(h.input.bindings['pointer?'](4,8), false);
  h.input.destroy();
});

test('input callbacks compile in both modes, share scene state and validate arity', () => {
  for (const trace of [true, false]) {
    const h = harness(), values = [];
    const scene = compile('(let pressed 0) (on keydown (event:dict) (set pressed (+ pressed 1))) (on update () (record pressed (key? "KeyW")))', {
      ...bindings, ...h.input.bindings, record: (...args) => values.push(args),
    }, forms, { scene: true, trace }).run();
    h.send(h.canvas, 'keydown', { code: 'KeyW', key: 'w' });
    scene.keydown(h.events[0][1]); scene.update();
    assert.deepEqual(values, [[1, true]]);
    for (const name of inputCallbacks) {
      assert.doesNotThrow(() => compile(`(on ${name} (event))`, bindings, forms, { scene: true, trace }));
      assert.throws(() => compile(`(on ${name} (a b))`, bindings, forms, { scene: true, trace }), SyntaxError);
    }
    h.input.destroy();
  }
});

test('scene player resets input on replacement and polls before simulation and render', () => {
  const events = [];
  const player = new ScenePlayer({ requestFrame: () => 1, cancelFrame() {}, updateHz: 10 });
  player.input = { reset: () => events.push('reset'), poll: () => events.push('poll') };
  player.replace({ attach: () => events.push('attach'), update: () => events.push('update'), render: () => events.push('render') });
  player.frame(0); player.frame(100); player.replace(null);
  assert.deepEqual(events, ['reset','attach','poll','render','poll','update','render','reset']);
});

test('stopping or replacing a scene during gamepad polling discards remaining callbacks and frame work', () => {
  const h = harness(name => { if (name === 'joyconnected') h.input.reset(); });
  h.pads([{ index: 0, id: 'test', mapping: 'standard', connected: true, timestamp: 1, axes: [1], buttons: [{ pressed: true, touched: true, value: 1 }] }]);
  h.input.poll();
  assert.deepEqual(h.events.map(event => event[0]), ['joyconnected']);
  assert.equal(h.input.bindings.joys().values.length, 0);
  const player = new ScenePlayer({ requestFrame: () => 1, cancelFrame() {} });
  let rendered = false;
  player.replace({ render: () => { rendered = true; } });
  player.input = { poll: () => player.stop() };
  player.frame(0);
  assert.equal(rendered, false);
  h.input.destroy();
});
