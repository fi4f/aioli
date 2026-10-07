import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler/compiler.js';
import { forms } from '../engine/compiler/forms.js';
import { bindings } from '../engine/language/bindings.js';
import { get } from '../engine/language/data.js';
import { rasterizeText, createTextBuilder, textOperation, finishTextBuilder } from '../engine/language/text.js';
const evaluate = (source, trace = true, extra = {}, options = {}) => compile(source, { ...bindings, ...extra }, forms, { trace, ...options }).run();

test('wrap false clips long lines without reflow and preserves explicit blank lines', t => {
  const painted = [];
  const context = { measureText: text => ({ width: text.length * 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText: (...args) => painted.push(args) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class { getContext() { return context; } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'OffscreenCanvas', previous) : delete globalThis.OffscreenCanvas);
  for (const trace of [true, false]) {
    let snapshot;
    evaluate('(text (width 30) (height 80) (line-height 20) (wrap false) "ab cd ef\\n\\nz\\n")', trace, {},
      { textRenderer: value => { snapshot = value; return null; } });
    painted.length = 0;
    const raster = rasterizeText(snapshot);
    assert.equal(snapshot.wrap, false);
    assert.equal(raster.width, 30);
    assert.equal(raster.height, 80);
    assert.equal(raster.lineCount, 4);
    assert.deepEqual(painted.map(args => [args[0], args[2]]), [['ab cd ef', 8], ['z', 48]]);
    evaluate('(text (width 30) "ab cd ef")', trace, {}, { textRenderer: value => { snapshot = value; return null; } });
    assert.equal(snapshot.wrap, true);
    assert.equal(rasterizeText(snapshot).lineCount, 3);
    evaluate('(text (wrap false) (wrap true) "ok")', trace, {}, { textRenderer: value => { snapshot = value; return null; } });
    assert.equal(snapshot.wrap, true);
    for (const setting of ['(wrap)', '(wrap nil)', '(wrap 0)', '(wrap "false")', '(wrap false true)']) {
      assert.throws(() => evaluate(`(text ${setting})`, trace), /wrap expects/);
    }
  }
});

test('text operation arity is rejected during compilation before a render callback can be installed', () => {
  for (const trace of [true, false]) {
    const source = '(on render (context) (let label (text (resolution) "hello")))';
    assert.throws(() => compile(source, bindings, forms, { trace, scene: true }), error => {
      assert.equal(error.name, 'SyntaxError');
      assert.match(error.message, /resolution expects one argument/);
      assert.equal(error.lisp.start, source.indexOf('(resolution)'));
      return true;
    });
    for (const body of ['(resolution)', '(resolution 1 2)', '(size)', '(line 1)', '(fill)', '(italic true false)']) {
      assert.throws(() => compile(`(text ${body})`, bindings, forms, { trace }), SyntaxError);
    }
    assert.doesNotThrow(() => compile('(text (resolution 2) (italic) (line) (fill 1) (stroke nil) "hello")', bindings, forms, { trace }));
    assert.throws(() => textOperation(createTextBuilder(), 'resolution'), TypeError);
  }
});

test('literal text settings validate before render while computed values retain runtime checks', () => {
  for (const trace of [true, false]) {
    for (const setting of ['(resolution 0)', '(resolution -1)', '(resolution nil)', '(resolution "bad")', '(size 0)', '(wrap 0)']) {
      const source = `(on render (context) (let label (text ${setting} "hello")))`;
      assert.throws(() => compile(source, bindings, forms, { trace, scene: true }), error => {
        assert.equal(error.lisp.start, source.indexOf(setting));
        return true;
      });
    }
    const scene = compile('(let value 0) (on render (context) (text (resolution value) "hello"))', bindings, forms, { trace, scene: true }).run();
    assert.throws(() => scene.render(bindings.dict()), /resolution expects a positive finite/);
  }
});

test('offset snapshots per-span vectors and isolates nested builders', () => {
  for (const trace of [true, false]) {
    const offset = bindings.vec2(3,-5);
    const result = evaluate('(text "H" (offset shift) "i" (set shift.x 99) (let inner (text "inner")) (offset (vec2 0)) "!")', trace, { shift: offset });
    const runs = get(result, 'runs').values;
    assert.deepEqual(runs.map(run => get(run, 'offset').values), [[0,0],[3,-5],[0,0]]);
    for (const source of ['(offset)', '(offset 2)', '(offset nil)', '(offset (vec3))', '(offset (vec2i))', '(offset (vec2 bad))', '(offset (vec2) (vec2))']) assert.throws(() => evaluate(`(text ${source})`, trace, { bad: Infinity }), Error);
  }
});

test('offset shifts painted spans and clipping, expands bounds and leaves advance and wrapping unchanged', t => {
  const painted = [], clips = [];
  const context = { measureText: text => ({ width: text.length*10, actualBoundingBoxRight: text.length*10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    save() {}, restore() {}, beginPath() {}, rect: (...args) => clips.push(args), clip() {}, fillText: (...args) => painted.push(args) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class { getContext() { return context; } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'OffscreenCanvas', previous) : delete globalThis.OffscreenCanvas);
  let snapshot;
  evaluate('(text "H" (offset (vec2 -20 -5)) "i" (offset (vec2 0)) "!")', true, {}, { textRenderer: value => { snapshot = value; return null; } });
  const raster = rasterizeText(snapshot);
  assert.equal(raster.width, 42); assert.equal(raster.height, 17); assert.equal(raster.baseline, 14);
  assert.deepEqual(painted, [['Hi!',11,14],['Hi!',-9,9],['Hi!',11,14]]);
  assert.equal(clips[1][0], 1);
  evaluate('(text (width 40) "one " (offset (vec2 100 20)) "two")', true, {}, { textRenderer: value => { snapshot = value; return null; } });
  assert.equal(rasterizeText(snapshot).lineCount, 2);
});

test('fixed text bounds align normal layout and clip offsets without shifting origin', t => {
  const painted = [];
  const context = { measureText: text => ({ width: text.length*10, actualBoundingBoxRight: text.length*10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText: (...args) => painted.push(args) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class { getContext() { return context; } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'OffscreenCanvas', previous) : delete globalThis.OffscreenCanvas);
  const render = source => {
    let snapshot; evaluate(source, true, {}, { textRenderer: value => { snapshot = value; return null; } });
    painted.length = 0;
    return rasterizeText(snapshot);
  };
  for (const [hAlign, x] of [['left',10],['center',40],['right',70]]) for (const [vAlign,y] of [['top',18],['center',28],['bottom',38]]) {
    const raster = render(`(text (width 100) (height 50) (padding 10) (h-align ${hAlign}) (v-align "${vAlign}") "AB")`);
    assert.equal(raster.width,100); assert.equal(raster.height,50); assert.deepEqual(painted[0], ['AB',x,y]);
  }
  const first = render('(text (width 100) (height 50) (padding (vec2 10)) (h-align center) (v-align center) (offset (vec2 0 -100)) "AB")');
  assert.deepEqual([first.width,first.height,first.offsetX,first.offsetY], [100,50,10,20]);
  assert.deepEqual(painted[0], ['AB',40,-72]);
  const second = render('(text "AB" (width 100) (height 50) (h-align left) (h-align center) (v-align bottom) (v-align center) (padding 10) (offset (vec2 0 100)) "")');
  assert.deepEqual([second.width,second.height,second.offsetX,second.offsetY], [100,50,10,20]);
  render('(text (width 100) (height 60) (padding 10) (line-height 20) (h-align center) (v-align center) "AB" (line) "A")');
  assert.deepEqual(painted, [['AB',40,23],['A',45,43]]);
  const oversized = render('(text (width 10) (height 5) "AB")');
  assert.equal(oversized.width,10); assert.equal(oversized.height,5); assert.equal(oversized.lineCount,1);
});

test('new block options snapshot final settings and reject invalid values and obsolete align', () => {
  for (const trace of [true,false]) {
    const snapshots = [];
    evaluate('(text (height 50) (height 60) (padding (vec2 3 4)) (h-align right) (v-align bottom) "x")', trace, {}, { textRenderer: value => { snapshots.push(value); return null; } });
    assert.equal(snapshots[0].height,60); assert.equal(snapshots[0].hAlign,'right'); assert.equal(snapshots[0].vAlign,'bottom');
    assert.deepEqual(snapshots[0].padding,[3,4]);
    for (const operation of ['(height 0)','(height -1)','(height nil)','(padding -1)','(padding (vec3))','(padding (vec2i))','(padding (vec2 bad))','(h-align "top")','(v-align "left")','(align "center")']) assert.throws(() => evaluate(`(text ${operation})`, trace, { bad: Infinity }), Error);
  }
});

test('resolution changes raster resolution without changing layout or final texture size', t => {
  for (const trace of [true,false]) for (const [name, expected] of [['half',0.5],['standard',1],['double',2]]) {
    for (const option of [name, JSON.stringify(name)]) {
      let snapshot;
      evaluate(`(text (resolution ${option}) "A")`, trace, {}, { textRenderer: value => { snapshot=value;return null; } });
      assert.equal(snapshot.resolution, expected);
    }
    assert.throws(() => evaluate('(text (resolution "unknown"))', trace), /resolution expects/);
  }
  const canvases = [], transforms = [], draws = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(w,h) { this.width=w;this.height=h;canvases.push(this); }
    getContext() { return { measureText: text => ({ width: text.length*10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText() {},
      setTransform: (...args) => transforms.push(args), drawImage: (...args) => draws.push(args),
    }; }
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'OffscreenCanvas', previous) : delete globalThis.OffscreenCanvas);
  for (const scale of [2,4,0.5]) {
    let snapshot;
    evaluate(`(text (width 100) (height 40) (v-align center) (resolution ${scale}) "AB")`, true, {}, { textRenderer: value => { snapshot=value;return null; } });
    const result = rasterizeText(snapshot);
    assert.equal(result.width,100); assert.equal(result.height,40); assert.equal(result.baseline,23);
    assert.equal(canvases.at(-2).width,100*scale); assert.equal(canvases.at(-2).height,40*scale);
    assert.equal(result.canvas.width,100); assert.equal(result.canvas.height,40);
    assert.deepEqual(transforms.at(-1),[scale,0,0,scale,0,0]);
    assert.deepEqual(draws.at(-1).slice(1),[0,0,100*scale,40*scale,0,0,100,40]);
  }
  for (const trace of [true,false]) {
    for (const value of ['0','-1','nil','"2"','Infinity','NaN']) assert.throws(() => evaluate(`(text (resolution ${value}))`,trace), Error);
  }
});

test('text captures outer values, executes ordinary statements, and snapshots immediate style', () => {
  for (const trace of [true, false]) {
    const events = [], red = bindings.vec3(1, 0, 0);
    const result = evaluate(`(let name "Ada") (let n 0)
      (let label (text (font "serif") (size 32) (span "Hello ")
        (if true { (fill red) (set n 2) (print name) })
        (span name) (line) (span (str n))))
      (set name "Changed") (set red.x 0) label`, trace, { red, print: value => events.push(value) });
    assert.deepEqual(events, ['Ada']); assert.equal(get(result, 'content'), 'Hello Ada\n2');
    const runs = get(result, 'runs').values;
    assert.deepEqual(get(runs[0], 'fill').values, [1, 1, 1, 1]);
    assert.deepEqual(get(runs[1], 'fill').values, [1, 0, 0, 1]);
    assert.deepEqual(get(runs[3], 'fill').values, [1, 0, 0, 1]);
    assert.equal(get(runs[1], 'font'), 'serif'); assert.equal(get(runs[1], 'size'), 32);
  }
});

test('bare strings and interpolated strings append only in text statement positions', () => {
  for (const trace of [true, false]) {
    const result = evaluate(`(let name "Ada")
      (text "Hello " (weight bold) f"{name}"
        (let hidden "hidden") (print "printed")
        (if false "skipped" elif true { "!" } else "also skipped")
        (line) (span "explicit")
        (let append (fn () " helper" (return "returned")))
        (let value (append)) (span value)
        (let inner (text "inner")) (span inner.content))`, trace, { print: () => {} });
    assert.equal(get(result, 'content'), 'Hello Ada!\nexplicit helperreturnedinner');
    const runs = get(result, 'runs').values;
    assert.equal(get(runs[0], 'weight'), 400); assert.equal(get(runs[1], 'weight'), 700);
    assert.equal(evaluate('"ordinary"', trace), 'ordinary');
    assert.equal(get(evaluate('(text (let value "unbound") value)', trace), 'content'), '');
    assert.equal(get(evaluate('(text (let value (if true "value" "other")) (span value))', trace), 'content'), 'value');
    assert.equal(get(evaluate('(text "a\\nb" "")', trace), 'content'), 'a\nb');
    assert.throws(() => evaluate('(let saved nil) (text (set saved (fn () "late"))) (saved)', trace), /already finished/);
  }
});

test('nested text isolates style, functions capture the builder, and rebuilding captures new values', () => {
  for (const trace of [true, false]) {
    const result = evaluate(`(let value "first")
      (let build (fn () (return (text (let append (fn (x) (span x))) (append value)))))
      (let first (build)) (set value "second") (let second (build))
      (let outer (text (fill (vec3 0 1 0))
        (let inner (text (fill (vec3 1 0 0)) (span "inner")))
        (span inner.content) (span "outer")))
      (list first.content second.content outer)`, trace);
    assert.deepEqual(result.values.slice(0, 2), ['first', 'second']);
    const outer = result.values[2]; assert.equal(get(outer, 'content'), 'innerouter');
    assert.deepEqual(get(get(outer, 'runs').values[0], 'fill').values, [0, 1, 0, 1]);
    assert.equal(evaluate(String.raw`(text (span "a\r\nb\rc"))`, trace).values.content, 'a\nb\nc');
    assert.throws(() => evaluate('(let saved nil) (text (set saved (fn () (span "late")))) (saved)', trace), /already finished/);
  }
});

test('text rejects invalid operations, premature returns, and preserves source traces', () => {
  for (const trace of [true, false]) for (const operation of ['(span 3)', '(span)', '(line 1)', '(fill (vec2 1))', '(fill (vec3 2))', '(font "")', '(size 0)', '(width -1)', '(h-align "bad")', '(line-height nil)']) {
    assert.throws(() => evaluate(`(text ${operation})`, trace), Error, operation);
  }
  assert.throws(() => evaluate('(span "outside")'), /Unknown symbol/);
  assert.throws(() => evaluate('((fn () (return (text (return 1)))))'), /return cannot exit/);
  assert.throws(() => evaluate('(text\n (size -1))'), error => Boolean(error.lisp) && error.lisp.start > 0);
  assert.throws(() => evaluate('(text (let inside 1)) inside'), /Unknown symbol/);
  assert.throws(() => evaluate('(text (let span 1))'), /Name already defined/);
  const snapshots = [];
  evaluate('(text (width 100) (h-align "center") (line-height 20) (span "ok"))', true, {}, {
    textRenderer: snapshot => { snapshots.push(snapshot); return null; },
  });
  assert.equal(snapshots[0].width, 100); assert.equal(snapshots[0].hAlign, 'center'); assert.equal(snapshots[0].lineHeight, 20);
});

test('fill and stroke accept scalar, vector and numeric channel overloads', () => {
  for (const trace of [true, false]) for (const operation of ['fill', 'stroke']) {
    for (const [args, expected] of [['0.5', [0.5,0.5,0.5,1]], ['(vec3 0.25 0.5 0.75)', [0.25,0.5,0.75,1]], ['(vec4 0.25 0.5 0.75 0)', [0.25,0.5,0.75,0]], ['0.25 0.5 0.75', [0.25,0.5,0.75,1]], ['0.25 0.5 0.75 0.5', [0.25,0.5,0.75,0.5]], ['nil', null]]) {
      const run = get(evaluate(`(text (${operation} ${args}) "x")`, trace), 'runs').values[0];
      assert.deepEqual(get(run, operation)?.values ?? null, expected);
    }
    for (const args of ['', '0 1', '0 0 0 1 1', '0 0 0 2', 'nil 0 0', '0 0 "x"', '(vec3i)', '-1']) assert.throws(() => evaluate(`(text (${operation} ${args}))`, trace), Error);
  }
});

test('text paint and line settings snapshot independently and accept named symbols or strings', () => {
  for (const trace of [true, false]) {
    const defaults = get(evaluate('(text (span "default"))', trace), 'runs').values[0];
    assert.deepEqual(get(defaults, 'fill').values, [1,1,1,1]); assert.equal(get(defaults, 'stroke'), null);
    assert.equal(get(defaults, 'line-width'), 1); assert.equal(get(defaults, 'line-join'), 'miter');
    assert.equal(get(defaults, 'miter-limit'), 10); assert.equal(get(defaults, 'line-cap'), 'butt');
    assert.deepEqual(get(defaults, 'line-dash').values, []);
    const result = evaluate(`(let dash (list 3 2 1))
      (text (stroke (vec3 1 0 0)) (line-width 2) (line-join round)
        (line-cap "square") (miter-limit 4) (line-dash dash) (h-align center)
        (fill nil) (span "outline") (put dash 0 99)
        (stroke nil) (fill (vec4 0 1 0 0.5)) (line-dash (list))
        (line-join "bevel") (line-cap butt) (span "fill"))`, trace);
    const [a, b] = get(result, 'runs').values;
    assert.equal(get(a, 'fill'), null); assert.deepEqual(get(a, 'stroke').values, [1,0,0,1]);
    assert.equal(get(a, 'line-width'), 2); assert.equal(get(a, 'line-join'), 'round');
    assert.equal(get(a, 'line-cap'), 'square'); assert.equal(get(a, 'miter-limit'), 4);
    assert.deepEqual(get(a, 'line-dash').values, [3,2,1,3,2,1]);
    assert.equal(get(b, 'stroke'), null); assert.deepEqual(get(b, 'fill').values, [0,1,0,0.5]);
    assert.deepEqual(get(b, 'line-dash').values, []);
    assert.equal(get(b, 'line-join'), 'bevel'); assert.equal(get(b, 'line-cap'), 'butt');
    assert.deepEqual(get(get(evaluate('(text (line-dash (array (f32) 2 3)) (span "a"))', trace), 'runs').values[0], 'line-dash').values, [2,3]);
    for (const op of ['(fill false)', '(stroke (vec2))', '(stroke (vec3 -1))', '(line-width 0)', '(miter-limit -1)', '(line-join "bad")', '(line-cap "bad")', '(line-dash nil)', '(line-dash (list -1))', '(line-dash (list "x"))', '(line-width)', '(line-cap round round)']) {
      assert.throws(() => evaluate(`(text ${op})`, trace), Error, op);
    }
  }
});

test('text weight and italic accept named weights, snapshot styles and isolate nested builders', () => {
  for (const trace of [true, false]) {
    const italicRuns = get(evaluate('(text "upright" (italic) "italic" (italic false) "upright again")', trace), 'runs').values;
    assert.deepEqual(italicRuns.map(run => get(run, 'italic')), [false, true, false]);
    const names = { thin: 100, extralight: 200, light: 300, normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
    for (const [name, weight] of Object.entries(names)) for (const option of [name, JSON.stringify(name)]) {
      const run = get(evaluate(`(text (weight ${option}) (span "x"))`, trace), 'runs').values[0];
      assert.equal(get(run, 'weight'), weight);
    }
    const result = evaluate(`(text (span "normal") (weight 550.5) (italic true)
      (let inner (text (span "inner"))) (span inner.content)
      (weight regular) (italic false) (span "upright"))`, trace);
    const [a, b, c] = get(result, 'runs').values;
    assert.equal(get(a, 'weight'), 400); assert.equal(get(a, 'italic'), false);
    assert.equal(get(b, 'weight'), 550.5); assert.equal(get(b, 'italic'), true);
    assert.equal(get(c, 'weight'), 400); assert.equal(get(c, 'italic'), false);
    for (const op of ['(weight 0)', '(weight 1001)', '(weight "unknown")', '(weight "constructor")', '(weight nil)', '(weight true)', '(italic 1)', '(italic "true")', '(italic nil)', '(weight)', '(italic true false)']) {
      assert.throws(() => evaluate(`(text ${op})`, trace), Error, op);
    }
    for (const bad of [Infinity, NaN]) assert.throws(() => evaluate('(text (weight bad))', trace, { bad }), /weight expects/);
  }
});

test('text layout and drawing use weight and italic and preserve shaping across paint changes', t => {
  const painted = [], measured = [];
  const context = {
    measureText(text) {
      measured.push([this.font, text]);
      const width = text.length * (this.font.includes('700') ? 20 : 10);
      return { width, actualBoundingBoxRight: width, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
    },
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillText(text) { painted.push([this.font, text]); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class { getContext() { return context; } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'OffscreenCanvas', previous) : delete globalThis.OffscreenCanvas);
  let snapshot;
  evaluate('(text (font "serif") (size 20) (span "A") (weight bold) (italic true) (span "B") (fill (vec3 1 0 0)) (span "C"))', true, {}, {
    textRenderer: value => { snapshot = value; return null; },
  });
  const raster = rasterizeText(snapshot);
  assert.equal(raster.width, 52);
  assert.deepEqual(painted, [['normal 400 20px serif', 'A'], ['italic 700 20px serif', 'BC'], ['italic 700 20px serif', 'BC']]);
  assert.ok(measured.some(([font, text]) => font === 'italic 700 20px serif' && text === 'BC'));
});

test('text renderer applies stroke settings, orders paint, skips disabled paint and pads bounds', t => {
  const calls = [];
  const context = { measureText: text => ({ width: text.length * 10, actualBoundingBoxRight: text.length * 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    setLineDash(dash) { this.dash = [...dash]; },
    strokeText(text) { calls.push(['stroke', text, this.lineWidth, this.lineJoin, this.miterLimit, this.lineCap, this.dash, this.strokeStyle]); },
    fillText(text) { calls.push(['fill', text, this.fillStyle]); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class { getContext() { return context; } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'OffscreenCanvas', previous) : delete globalThis.OffscreenCanvas);
  let snapshot;
  evaluate('(text (stroke (vec3 1 0 0)) (line-width 4) (line-join round) (miter-limit 2) (line-cap butt) (line-dash (list 3)) (span "A"))', true, {}, {
    textRenderer: value => { snapshot = value; return null; },
  });
  const raster = rasterizeText(snapshot);
  assert.deepEqual(calls, [['stroke', 'A', 4, 'round', 2, 'butt', [3,3], 'rgba(255, 0, 0, 1)'], ['fill', 'A', 'rgba(255, 255, 255, 1)']]);
  assert.equal(raster.width, 16); assert.equal(raster.height, 16);
  snapshot.runs[0].lineJoin = 'miter';
  const miterRaster = rasterizeText(snapshot);
  assert.equal(miterRaster.width, 20); assert.equal(miterRaster.height, 20);
  snapshot.runs[0].lineJoin = 'round';
  snapshot.runs[0].fill = null; calls.length = 0; rasterizeText(snapshot);
  assert.deepEqual(calls.map(call => call[0]), ['stroke']);
  snapshot.runs[0].stroke = null; calls.length = 0; rasterizeText(snapshot);
  assert.deepEqual(calls, []);
});

test('text layout wraps across paint spans, preserves blank lines, and shapes complete words', t => {
  const painted = [];
  const context = { measureText: text => ({ width: text.length * 10, actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText: (...args) => painted.push(args) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    getContext() { return context; }
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'OffscreenCanvas', previous) : delete globalThis.OffscreenCanvas);
  const builder = createTextBuilder();
  textOperation(builder, 'width', 50); textOperation(builder, 'line-height', 20);
  textOperation(builder, 'span', 'he'); textOperation(builder, 'fill', bindings.vec3(1,0,0));
  textOperation(builder, 'span', 'llo world\n\n');
  const text = finishTextBuilder(builder), raster = rasterizeText(text);
  assert.equal(raster.lineCount, 4); assert.equal(raster.height, 72);
  assert.equal(painted[0][0], 'hello'); assert.equal(painted[1][0], 'hello');
  assert.equal(painted[2][0], 'world'); assert.equal(painted[2][2] - painted[0][2], 20);
  assert.throws(() => rasterizeText(text, { maxSize: 20 }), /dimension limit/);
});
