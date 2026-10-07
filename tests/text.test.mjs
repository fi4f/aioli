import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { get } from '../engine/data.js';
import { rasterizeText, createTextBuilder, textOperation, finishTextBuilder } from '../engine/text.js';
const evaluate = (source, trace = true, extra = {}, options = {}) => compile(source, { ...bindings, ...extra }, forms, { trace, ...options }).run();

test('text captures outer values, executes ordinary statements, and snapshots immediate style', () => {
  for (const trace of [true, false]) {
    const events = [], red = bindings.vec3(1, 0, 0);
    const result = evaluate(`(let name "Ada") (let n 0)
      (let label (text (font "serif") (size 32) (span "Hello ")
        (if true { (color red) (set n 2) (print name) })
        (span name) (line) (span (str n))))
      (set name "Changed") (set red.x 0) label`, trace, { red, print: value => events.push(value) });
    assert.deepEqual(events, ['Ada']); assert.equal(get(result, 'content'), 'Hello Ada\n2');
    const runs = get(result, 'runs').values;
    assert.deepEqual(get(runs[0], 'color').values, [1, 1, 1, 1]);
    assert.deepEqual(get(runs[1], 'color').values, [1, 0, 0, 1]);
    assert.deepEqual(get(runs[3], 'color').values, [1, 0, 0, 1]);
    assert.equal(get(runs[1], 'font'), 'serif'); assert.equal(get(runs[1], 'size'), 32);
  }
});

test('nested text isolates style, functions capture the builder, and rebuilding captures new values', () => {
  for (const trace of [true, false]) {
    const result = evaluate(`(let value "first")
      (let build (fn () (return (text (let append (fn (x) (span x))) (append value)))))
      (let first (build)) (set value "second") (let second (build))
      (let outer (text (color (vec3 0 1 0))
        (let inner (text (color (vec3 1 0 0)) (span "inner")))
        (span inner.content) (span "outer")))
      (list first.content second.content outer)`, trace);
    assert.deepEqual(result.values.slice(0, 2), ['first', 'second']);
    const outer = result.values[2]; assert.equal(get(outer, 'content'), 'innerouter');
    assert.deepEqual(get(get(outer, 'runs').values[0], 'color').values, [0, 1, 0, 1]);
    assert.equal(evaluate(String.raw`(text (span "a\r\nb\rc"))`, trace).values.content, 'a\nb\nc');
    assert.throws(() => evaluate('(let saved nil) (text (set saved (fn () (span "late")))) (saved)', trace), /already finished/);
  }
});

test('text rejects invalid operations, premature returns, and preserves source traces', () => {
  for (const trace of [true, false]) for (const operation of ['(span 3)', '(span)', '(line 1)', '(color (vec2 1))', '(color (vec3 2))', '(font "")', '(size 0)', '(width -1)', '(align "bad")', '(line-height nil)']) {
    assert.throws(() => evaluate(`(text ${operation})`, trace), Error, operation);
  }
  assert.throws(() => evaluate('(span "outside")'), /Unknown symbol/);
  assert.throws(() => evaluate('((fn () (return (text (return 1)))))'), /return cannot exit/);
  assert.throws(() => evaluate('(text\n (size -1))'), error => Boolean(error.lisp) && error.lisp.start > 0);
  assert.throws(() => evaluate('(text (let inside 1)) inside'), /Unknown symbol/);
  assert.throws(() => evaluate('(text (let span 1))'), /Name already defined/);
  const snapshots = [];
  evaluate('(text (width 100) (align "center") (line-height 20) (span "ok"))', true, {}, {
    textRenderer: snapshot => { snapshots.push(snapshot); return null; },
  });
  assert.equal(snapshots[0].width, 100); assert.equal(snapshots[0].align, 'center'); assert.equal(snapshots[0].lineHeight, 20);
});

test('text layout wraps across color spans, preserves blank lines, and shapes complete words', t => {
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
  textOperation(builder, 'span', 'he'); textOperation(builder, 'color', bindings.vec3(1,0,0));
  textOperation(builder, 'span', 'llo world\n\n');
  const text = finishTextBuilder(builder), raster = rasterizeText(text);
  assert.equal(raster.lineCount, 4); assert.equal(raster.height, 72);
  assert.equal(painted[0][0], 'hello'); assert.equal(painted[1][0], 'hello');
  assert.equal(painted[2][0], 'world'); assert.equal(painted[2][2] - painted[0][2], 20);
  assert.throws(() => rasterizeText(text, { maxSize: 20 }), /dimension limit/);
});
