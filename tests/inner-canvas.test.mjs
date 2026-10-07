import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInnerCanvas, canvasLayout, validateInnerOptions } from '../engine/browser/inner-canvas.js';
import { createInput } from '../engine/browser/input.js';
import { compile } from '../engine/compiler/compiler.js';
import { bindings } from '../engine/language/bindings.js';
import { forms } from '../engine/compiler/forms.js';
import { get, put } from '../engine/language/data.js';
import { Aioli } from '../engine/runtime/aioli.js';

function harness(options = {}, services = {}) {
  const calls = [], context = { save() {}, restore() {}, setTransform(...args) { calls.push(['transform', ...args]); },
    fillRect(...args) { calls.push(['fill', ...args]); }, drawImage(...args) { calls.push(['draw', this.imageSmoothingEnabled, ...args]); } };
  const outer = new EventTarget(), document = new EventTarget(), window = new EventTarget();
  const bounds = { left: 10, top: 20, width: 400, height: 300 };
  Object.assign(outer, { width: 800, height: 600, ownerDocument: document, tabIndex: 0,
    getContext: type => { assert.equal(type, '2d'); return context; },
    getAttribute: () => '0', setAttribute() {}, removeAttribute() {}, focus() { document.activeElement = outer; },
    setPointerCapture() {}, getBoundingClientRect: () => bounds,
  });
  const display = createInnerCanvas(outer, options, { createCanvas: (w,h) => ({ width: w, height: h }), ...services });
  return { outer, display, calls, document, window, bounds };
}

test('inner dimensions default independently and presentation fits, centers, snaps and crops at minimum scale', () => {
  const options = validateInnerOptions({ width: 320, height: 180, scaleStep: 1 });
  assert.deepEqual(canvasLayout(800,600,options), { w: 320, h: 180, scale: 2, x: 80, y: 120, outerWidth: 800, outerHeight: 600 });
  assert.equal(canvasLayout(800,600,{ ...options, scaleStep: 0.5 }).scale, 2.5);
  const small = canvasLayout(100,50,options);
  assert.equal(small.scale, 1); assert.equal(small.x, -110); assert.equal(small.y, -65);
  assert.equal(canvasLayout(800,600,validateInnerOptions({ width: 320 })).h, 600);
  const h = harness(); assert.equal(h.display.innerCanvas.width, 400); assert.equal(h.display.innerCanvas.height, 300);
  h.outer.width = 1000; h.display.sync(); assert.equal(h.display.innerCanvas.width, 400);
  h.bounds.width = 1000; h.display.sync(); assert.equal(h.display.innerCanvas.width, 1000);
  h.display.configure({ width: 320 }); h.display.sync(); assert.equal(h.display.innerCanvas.height, 300);
});

test('runtime observes outer bounds, sizes both canvases, and releases resize observation', () => {
  let notify, observed, disconnected = false;
  const events = [];
  class Observer {
    constructor(callback) { notify = callback; }
    observe(target) { observed = target; }
    disconnect() { disconnected = true; }
  }
  const h = harness({}, { ResizeObserver: Observer, onResize: event => events.push(event) });
  assert.equal(observed, h.outer);
  assert.deepEqual([h.outer.width, h.outer.height], [400, 300]);
  h.bounds.width = 1000.4; h.bounds.height = 500.6;
  notify();
  assert.deepEqual([h.outer.width, h.outer.height], [1000, 501]);
  assert.deepEqual([h.display.innerCanvas.width, h.display.innerCanvas.height], [1000, 501]);
  assert.deepEqual(get(events[0], 'old-wh').values, [400, 300]);
  notify(); assert.equal(events.length, 1);
  h.display.configure({ width: 320, height: 180 }); h.display.sync();
  h.bounds.width = 800; notify();
  assert.equal(h.outer.width, 800);
  assert.deepEqual([h.display.innerCanvas.width, h.display.innerCanvas.height], [320, 180]);
  h.display.destroy(); assert.equal(disconnected, true);
  h.bounds.width = 1200; notify(); assert.equal(h.outer.width, 800);
});

test('configuration is atomic and deferred, coordinates round trip and painting disables smoothing', () => {
  const h = harness({ width: 320, height: 180, scaleStep: 1 });
  h.display.paint();
  assert.deepEqual(h.calls.at(-1), ['draw', false, h.display.innerCanvas, 40,60,320,180]);
  for (const trace of [true,false]) {
    const evaluate = source => compile(source, { ...bindings, ...h.display.bindings }, forms, { trace }).run();
    assert.deepEqual(h.display.toOuter(320, 180), { x: 360, y: 240 });
    const point = h.display.toOuter(7, 9), mapped = h.display.toInner(point.x, point.y);
    assert.deepEqual([mapped.x, mapped.y], [7,9]);
    assert.deepEqual(Object.keys(evaluate('(canvas)').values), ['w', 'h', 'wh']);
    for (const source of ['(logical-to-virtual (vec2))', '(virtual-to-logical (vec2))', '(outer-to-inner (vec2))', '(inner-to-outer (vec2))']) assert.throws(() => evaluate(source), /Unknown symbol/);
    evaluate('(configure (dict "w" 160 "scale-step" 0.5))');
    assert.equal(get(evaluate('(canvas)'), 'w'), 320);
    h.display.sync(); assert.equal(h.display.innerCanvas.width, 160);
    const settings = evaluate('(let options (dict "w" 320 "scale-step" 1)) (configure options)');
    assert.equal(get(settings, 'w'), 320);
    evaluate('(configure w 320 "h" 180 scale-step 1)');
    assert.equal(get(evaluate('(configure)'), 'h'), 180);
    h.display.sync();
    assert.deepEqual(get(evaluate('(canvas)'), 'wh').values, [320,180]);
    assert.throws(() => evaluate('(canvas 1)'), /no arguments/);
    for (const source of ['(configure w)', '(configure 1 2)', '(configure w 160 h -1)', '(configure bad 1)']) assert.throws(() => evaluate(source), Error);
    assert.equal(get(evaluate('(configure)'), 'w'), 320);
    for (const source of ['(configure (dict "w" 0))', '(configure (dict "w" 100 "h" -1))', '(configure (dict "scale-step" -1))', '(configure (dict "bad" 1))', '(logical-to-virtual (vec3))']) assert.throws(() => evaluate(source), Error);
    assert.equal(h.display.innerCanvas.width, 320);
  }
  h.display.sync(1024);
  assert.throws(() => h.display.configure({ width: 2048 }), /GPU texture limit/);
  assert.equal(h.display.layout().w, 320);
});

test('outer pointer events outside the inner area still fire and queries reproject after configuration', () => {
  const h = harness({ width: 320, height: 180, scaleStep: 1 }), events = [];
  const input = createInput(h.outer, { window: h.window, navigator: {}, coordinates: (x,y) => h.display.toInner(x,y), emit: (name,event) => events.push(event) });
  const send = (x,y) => h.outer.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: -1, buttons: 0 }));
  send(10,20);
  assert.equal(get(events[0], 'logical-xy'), null);
  assert.equal(get(events[0], 'inside'), false); assert.deepEqual(get(events[0], 'xy').values, [-40,-60]);
  send(210,170); assert.deepEqual(get(input.bindings.pointer(), 'xy').values, [160,90]);
  assert.equal(get(input.bindings.pointer(), 'inside'), true);
  assert.equal(get(input.bindings.pointer(), 'logical-xy'), null);
  h.display.configure({ width: 160, height: 90 }); h.display.sync();
  assert.deepEqual(get(input.bindings.pointer(), 'xy').values, [80,45]);
  put(get(input.bindings.pointer(), 'xy'), 0, 99);
  assert.deepEqual(get(input.bindings.pointer(), 'xy').values, [80,45]);
  input.destroy();
});

test('stationary pointer retains its client position when both canvases resize', () => {
  const h = harness();
  const input = createInput(h.outer, { window: h.window, navigator: {}, coordinates: (x, y) => h.display.toInner(x, y) });
  h.outer.dispatchEvent(Object.assign(new Event('pointermove'), {
    pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 210, clientY: 170, button: -1, buttons: 0,
  }));
  assert.deepEqual(get(input.bindings.pointer(), 'xy').values, [200, 150]);
  h.bounds.width = 800; h.bounds.height = 600; h.display.sync();
  assert.deepEqual(get(input.bindings.pointer(), 'xy').values, [200, 150]);
  input.destroy(); h.display.destroy();
});

test('runtime validates initial configuration and supports pre-attach configuration', () => {
  assert.throws(() => new Aioli({ innerCanvas: { width: -1 } }), /positive integer/);
  const runtime = new Aioli({ innerCanvas: { width: 320 } });
  runtime.configureInnerCanvas({ height: 180, scaleStep: 1 });
  assert.deepEqual(runtime.innerOptions, { width: 320, height: 180, scaleStep: 1 });
  runtime.destroy();
  assert.throws(() => runtime.configureInnerCanvas({ width: 100 }), /destroyed/);
});

test('inner resize snapshots fire only for applied size changes and callbacks accept one event', () => {
  const h = harness({ width: 320, height: 180 });
  assert.equal(h.display.sync(), null);
  h.display.configure({ width: 160 });
  const event = h.display.sync();
  assert.deepEqual(get(event, 'old-wh').values, [320,180]); assert.deepEqual(get(event, 'wh').values, [160,180]);
  assert.equal(h.display.sync(), null);
  h.outer.width = 900; assert.equal(h.display.sync(), null);
  h.display.configure({ scaleStep: 1 }); assert.equal(h.display.sync(), null);
  h.display.configure({ width: null });
  assert.equal(get(h.display.sync(), 'w'), 400);
  h.bounds.width = 1000; assert.equal(get(h.display.sync(), 'w'), 1000);
  for (const trace of [true,false]) {
    const events = [];
    const scene = compile('(on resize (event:dict) (record event.wh))', { ...bindings, record: value => events.push(value.values) }, forms, { trace, scene: true }).run();
    scene.resize(event); assert.deepEqual(events, [[160,180]]);
    assert.throws(() => compile('(on resize (a b))', bindings, forms, { scene: true }), SyntaxError);
  }
});

test('configure accepts ups with dictionary and named pairs, validating mixed changes atomically', () => {
  for (const trace of [true, false]) {
    const runtime = new Aioli({ ups: 120 });
    const h = harness();
    const display = createInnerCanvas(h.outer, {}, { updateRate: runtime.stage, createCanvas: (w,h) => ({ width: w, height: h }) });
    const evaluate = source => compile(source, { ...bindings, ...display.bindings }, forms, { trace }).run();
    assert.equal(get(evaluate('(configure)'), 'ups'), 120);
    evaluate('(configure ups 240 w 320)');
    assert.equal(runtime.stage.requestedUps, 240);
    assert.equal(runtime.stage.dt, 1 / 120);
    evaluate('(configure (dict "ups" 60))');
    assert.equal(runtime.stage.requestedUps, 60);
    for (const source of ['(configure ups 0 w 160)', '(configure ups 240 h -1)', '(configure ups nil)', '(configure ups "60")']) assert.throws(() => evaluate(source), Error);
    assert.equal(get(evaluate('(configure)'), 'ups'), 60);
    assert.equal(get(evaluate('(configure)'), 'w'), 320);
    runtime.destroy();
  }
});
