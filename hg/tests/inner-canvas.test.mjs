import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InnerCanvas } from "../inner-canvas.js";
import { Input } from "../input.js";
import { Compiler } from "../compiler.js";
import { Bindings } from "../bindings.js";
import { Forms } from "../forms.js";
import { Data } from "../data.js";
import { AppCore } from "../app.js";
import { Scheduler } from "../scheduler.js";

function harness(options = {}, services = {}) {
  const calls = [], context = { save() {}, restore() {}, setTransform(...args) { calls.push(['transform', ...args]); },
    clearRect(...args) { calls.push(['clear', ...args]); }, drawImage(...args) { calls.push(['draw', this.imageSmoothingEnabled, ...args]); } };
  const outer = new EventTarget(), document = new EventTarget(), window = new EventTarget();
  const bounds = { left: 10, top: 20, width: 400, height: 300 };
  Object.assign(outer, { width: 800, height: 600, ownerDocument: document, tabIndex: 0,
    getContext: type => { assert.equal(type, '2d'); return context; },
    getAttribute: () => '0', setAttribute() {}, removeAttribute() {}, focus() { document.activeElement = outer; },
    setPointerCapture() {}, getBoundingClientRect: () => bounds,
  });
  const display = InnerCanvas.new(outer, options, { outerSize: InnerCanvas.displaySize, createCanvas: (w,h) => ({ width: w, height: h }), ...services });
  return { outer, display, calls, document, window, bounds };
}

test('inner dimensions default independently and presentation fits, centers, snaps and crops at minimum scale', () => {
  const options = InnerCanvas.validateInnerOptions({ width: 320, height: 180, scaleStep: 1 });
  assert.deepEqual(InnerCanvas.canvasLayout(800,600,options), { w: 320, h: 180, scale: 2, x: 80, y: 120, outerWidth: 800, outerHeight: 600 });
  assert.equal(InnerCanvas.canvasLayout(800,600,{ ...options, scaleStep: 0.5 }).scale, 2.5);
  const small = InnerCanvas.canvasLayout(100,50,options);
  assert.equal(small.scale, 1); assert.equal(small.x, -110); assert.equal(small.y, -65);
  assert.equal(InnerCanvas.canvasLayout(800,600,InnerCanvas.validateInnerOptions({ width: 320 })).h, 600);
  const h = harness(); assert.equal(h.display.innerCanvas.width, 400); assert.equal(h.display.innerCanvas.height, 300);
  h.outer.width = 1000; InnerCanvas.sync(h.display); assert.equal(h.display.innerCanvas.width, 400);
  h.bounds.width = 1000; InnerCanvas.sync(h.display); assert.equal(h.display.innerCanvas.width, 1000);
  InnerCanvas.configure(h.display, { width: 320 }); InnerCanvas.sync(h.display); assert.equal(h.display.innerCanvas.height, 300);
});

test('runtime-owned presentation observes outer bounds, sizes both canvases, and releases resize observation', () => {
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
  assert.deepEqual(Data.values(Data.get(events[0], 'old-wh')), [400, 300]);
  notify(); assert.equal(events.length, 1);
  InnerCanvas.configure(h.display, { width: 320, height: 180 }); InnerCanvas.sync(h.display);
  InnerCanvas.paint(h.display); assert.equal(InnerCanvas.needsPresent(h.display), false);
  h.bounds.width = 800; notify();
  assert.equal(InnerCanvas.needsPresent(h.display), true);
  assert.equal(h.outer.width, 800);
  assert.deepEqual([h.display.innerCanvas.width, h.display.innerCanvas.height], [320, 180]);
  InnerCanvas.destroy(h.display); assert.equal(disconnected, true);
  h.bounds.width = 1200; notify(); assert.equal(h.outer.width, 800);
});

test('configuration is atomic and deferred, coordinates round trip and painting disables smoothing', () => {
  const h = harness({ width: 320, height: 180, scaleStep: 1 });
  assert.equal(InnerCanvas.needsPresent(h.display), true);
  InnerCanvas.paint(h.display);
  assert.equal(InnerCanvas.needsPresent(h.display), false);
  assert.deepEqual(h.calls.at(-1), ['draw', false, h.display.innerCanvas, 40,60,320,180]);
  for (const trace of [true,false]) {
    const evaluate = source => Compiler.run(Compiler.compile(source, { ...Bindings, ...h.display.bindings }, Forms, { trace }));
    assert.deepEqual(InnerCanvas.toOuter(h.display, 320, 180), { x: 360, y: 240 });
    const point = InnerCanvas.toOuter(h.display, 7, 9), mapped = InnerCanvas.toInner(h.display, point.x, point.y);
    assert.deepEqual([mapped.x, mapped.y], [7,9]);
    assert.deepEqual(Object.keys(Data.values(evaluate('(canvas)'))), ['w', 'h', 'wh']);
    for (const source of ['(logical-to-virtual (vec2))', '(virtual-to-logical (vec2))', '(outer-to-inner (vec2))', '(inner-to-outer (vec2))']) assert.throws(() => evaluate(source), /Unknown symbol/);
    evaluate('(configure (dict "w" 160 "scale-step" 0.5))');
    assert.equal(Data.get(evaluate('(canvas)'), 'w'), 320);
    InnerCanvas.sync(h.display); assert.equal(h.display.innerCanvas.width, 160);
    const settings = evaluate('(let options (dict "w" 320 "scale-step" 1)) (configure options)');
    assert.equal(Data.get(settings, 'w'), 320);
    evaluate('(configure w 320 "h" 180 scale-step 1)');
    assert.equal(Data.get(evaluate('(configure)'), 'h'), 180);
    InnerCanvas.sync(h.display);
    assert.deepEqual(Data.values(Data.get(evaluate('(canvas)'), 'wh')), [320,180]);
    assert.throws(() => evaluate('(canvas 1)'), /no arguments/);
    for (const source of ['(configure w)', '(configure 1 2)', '(configure w 160 h -1)', '(configure bad 1)']) assert.throws(() => evaluate(source), Error);
    assert.equal(Data.get(evaluate('(configure)'), 'w'), 320);
    for (const source of ['(configure (dict "w" 0))', '(configure (dict "w" 100 "h" -1))', '(configure (dict "scale-step" -1))', '(configure (dict "bad" 1))', '(logical-to-virtual (vec3))']) assert.throws(() => evaluate(source), Error);
    assert.equal(h.display.innerCanvas.width, 320);
  }
  InnerCanvas.sync(h.display, 1024);
  assert.throws(() => InnerCanvas.configure(h.display, { width: 2048 }), /GPU texture limit/);
  assert.equal(InnerCanvas.layout(h.display).w, 320);
});

test('outer pointer events outside the inner area still fire and queries reproject after configuration', () => {
  const h = harness({ width: 320, height: 180, scaleStep: 1 }), events = [];
  const input = Input.new(h.outer, { window: h.window, navigator: {}, coordinates: (x,y) => InnerCanvas.toInner(h.display, x, y), emit: (name,event) => events.push(event) });
  const send = (x,y) => h.outer.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: -1, buttons: 0 }));
  send(10,20);
  assert.equal(Data.get(events[0], 'logical-xy'), null);
  assert.equal(Data.get(events[0], 'inside'), false); assert.deepEqual(Data.values(Data.get(events[0], 'xy')), [-40,-60]);
  send(210,170); assert.deepEqual(Data.values(Data.get(input.bindings.pointer(), 'xy')), [160,90]);
  assert.equal(Data.get(input.bindings.pointer(), 'inside'), true);
  assert.equal(Data.get(input.bindings.pointer(), 'logical-xy'), null);
  InnerCanvas.configure(h.display, { width: 160, height: 90 }); InnerCanvas.sync(h.display);
  assert.deepEqual(Data.values(Data.get(input.bindings.pointer(), 'xy')), [80,45]);
  Data.put(Data.get(input.bindings.pointer(), 'xy'), 0, 99);
  assert.deepEqual(Data.values(Data.get(input.bindings.pointer(), 'xy')), [80,45]);
  Input.destroy(input);
});

test('stationary pointer retains its client position when both canvases resize', () => {
  const h = harness();
  const input = Input.new(h.outer, { window: h.window, navigator: {}, coordinates: (x, y) => InnerCanvas.toInner(h.display, x, y) });
  h.outer.dispatchEvent(Object.assign(new Event('pointermove'), {
    pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 210, clientY: 170, button: -1, buttons: 0,
  }));
  assert.deepEqual(Data.values(Data.get(input.bindings.pointer(), 'xy')), [200, 150]);
  h.bounds.width = 800; h.bounds.height = 600; InnerCanvas.sync(h.display);
  assert.deepEqual(Data.values(Data.get(input.bindings.pointer(), 'xy')), [200, 150]);
  Input.destroy(input); InnerCanvas.destroy(h.display);
});

test('runtime validates initial configuration and supports pre-attach configuration', () => {
  assert.throws(() => AppCore.new({ innerCanvas: { width: -1 } }), /positive integer/);
  const runtime = AppCore.new({ innerCanvas: { width: 320 } });
  AppCore.configureInnerCanvas(runtime,{ height: 180, scaleStep: 1 });
  assert.deepEqual(runtime.innerOptions, { width: 320, height: 180, scaleStep: 1, imageSmoothing: false });
  AppCore.destroy(runtime);
  assert.throws(() => AppCore.configureInnerCanvas(runtime,{ width: 100 }), /destroyed/);
});

test('inner resize snapshots fire only for applied size changes and callbacks accept one event', () => {
  const h = harness({ width: 320, height: 180 });
  assert.equal(InnerCanvas.sync(h.display), null);
  InnerCanvas.configure(h.display, { width: 160 });
  const event = InnerCanvas.sync(h.display);
  assert.deepEqual(Data.values(Data.get(event, 'old-wh')), [320,180]); assert.deepEqual(Data.values(Data.get(event, 'wh')), [160,180]);
  assert.equal(InnerCanvas.sync(h.display), null);
  h.outer.width = 900; assert.equal(InnerCanvas.sync(h.display), null);
  InnerCanvas.configure(h.display, { scaleStep: 1 }); assert.equal(InnerCanvas.sync(h.display), null);
  InnerCanvas.configure(h.display, { width: null });
  assert.equal(Data.get(InnerCanvas.sync(h.display), 'w'), 400);
  h.bounds.width = 1000; assert.equal(Data.get(InnerCanvas.sync(h.display), 'w'), 1000);
  for (const trace of [true,false]) {
    const events = [];
    const scene = Compiler.run(Compiler.compileScene('(on resize (event:dict) (record event.wh))', { ...Bindings, record: value => events.push(Data.values(value)) }, Forms, { trace }));
    scene.resize(event); assert.deepEqual(events, [[160,180]]);
    assert.throws(() => Compiler.compileScene('(on resize (a b))', Bindings, Forms, {  }), SyntaxError);
  }
});

test('configure accepts ups with dictionary and named pairs, validating mixed changes atomically', () => {
  for (const trace of [true, false]) {
    const runtime = AppCore.new({ ups: 120 });
    const h = harness();
    const display = InnerCanvas.new(h.outer, {}, { updateRate: runtime, createCanvas: (w,h) => ({ width: w, height: h }) });
    const evaluate = source => Compiler.run(Compiler.compile(source, { ...Bindings, ...display.bindings }, Forms, { trace }));
    assert.equal(Data.get(evaluate('(configure)'), 'ups'), 120);
    evaluate('(configure ups 240 w 320)');
    assert.equal(runtime.requestedUps, 240);
    assert.equal(runtime.dt, 1 / 120);
    evaluate('(configure (dict "ups" 60))');
    assert.equal(runtime.requestedUps, 60);
    for (const source of ['(configure ups 0 w 160)', '(configure ups 240 h -1)', '(configure ups nil)', '(configure ups "60")']) assert.throws(() => evaluate(source), Error);
    assert.equal(Data.get(evaluate('(configure)'), 'ups'), 60);
    assert.equal(Data.get(evaluate('(configure)'), 'w'), 320);
    AppCore.destroy(runtime);
  }
});
