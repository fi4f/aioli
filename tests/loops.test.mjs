import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler/compiler.js';
import { bindings } from '../engine/language/bindings.js';
import { forms } from '../engine/compiler/forms.js';

const evaluate = (source, trace, extra = {}) => compile(source, { ...bindings, ...extra }, forms, { trace }).run();
const shader = source => compile(source, bindings, forms).shaders[0].wgsl;

test('range syntax preserves numeric literals and dot access and supports expression endpoints', () => {
  const nodes = read('1..10 10..1 a.x..b.y (+ a 1)..(- b 1) 1.25 .5 1e2');
  assert.deepEqual(nodes.slice(0,4).map(node => node.kind), ['range','range','range','range']);
  assert.equal(nodes[0].from.value, 1); assert.equal(nodes[0].to.value, 10);
  assert.equal(nodes[2].from.kind, 'access'); assert.equal(nodes[3].to.kind, 'list');
  assert.deepEqual(nodes.slice(4).map(node => node.value), [1.25,0.5,100]);
  for (const source of ['1..', '..2', 'a..']) assert.throws(() => read(source), SyntaxError);
  for (const source of ['1..2', '(let r 1..2)', '(list 1..2)', '(for i 1..2..3)']) assert.throws(() => evaluate(source, true), SyntaxError);
});

test('for counts and exclusive bidirectional ranges evaluate endpoints once and create fresh bindings', () => {
  for (const trace of [true, false]) {
    const events = [];
    const result = evaluate(`(let out (list))
      (for i 3 (insert out i))
      (for i 1..4 (insert out i))
      (for i 4..1 (insert out i))
      (for i 2..2 (insert out 99))
      (for i (next 2)..(next 4) (insert out i)) out`, trace, { next: value => { events.push(value); return value; } });
    assert.deepEqual(result.values, [0,1,2,1,2,3,4,3,2,2,3]); assert.deepEqual(events, [2,4]);
    assert.deepEqual(evaluate('(let f (list)) (for i 3 (insert f (fn () (return i)))) (list ((get f 0)) ((get f 1)) ((get f 2)))', trace).values, [0,1,2]);
    assert.equal(evaluate('(let i 99) (for i 2 (set i 100)) i', trace), 99);
    assert.throws(() => evaluate('(for i 2) i', trace), /Unknown symbol/);
    assert.throws(() => evaluate('(for 2 i)', trace), /Variable name must be a symbol/);
    assert.deepEqual(evaluate('(let a (vec2 1 4)) (let out (list)) (for i a.x..a.y { (insert out i) }) out', trace).values, [1,2,3]);
  }
});

test('while reevaluates conditions and loop control handles nesting and returns', () => {
  for (const trace of [true, false]) {
    assert.equal(evaluate('(let n 0) (while (not (= n 3)) (set n (+ n 1))) n', trace), 3);
    assert.equal(evaluate('(let n 0) (until (= n 3) (set n (+ n 1))) n', trace), 3);
    assert.equal(evaluate('(let n 0) (until true (set n 99)) n', trace), 0);
    assert.throws(() => evaluate('(each i 3)', trace), /Unknown symbol/);
    assert.deepEqual(evaluate('(let out (list)) (for i 5 (if (= i 1) (continue)) (if (= i 3) (break)) (insert out i)) out', trace).values, [0,2]);
    assert.equal(evaluate('(let n 0) (for i 3 (while true (set n (+ n 1)) (break))) n', trace), 3);
    assert.equal(evaluate('((fn () (for i 4 (if (= i 2) (return i))) (return -1)))', trace), 2);
    assert.equal(evaluate('(text (for i 2 "x"))', trace).values.content, 'xx');
    for (const source of ['(break)', '(continue)', '(for i 1 (break 1))', '(for i 1 (let f (fn () (break))))', '(for i 1 (text (break)))', '(let a (for i 2))', '(while)', '(for 2)', '(for (list))', '(for 2 1)', '(for i 1 (let i 2))']) assert.throws(() => evaluate(source, trace), SyntaxError, source);
  }
});

test('for evaluates its collection once and iterates lists, arrays and many', () => {
  for (const trace of [true, false]) {
    for (const collection of ['(list 1 2 3)', '(array (f32) 1 2 3)', '(many (f32) 1 2 3)']) {
      assert.equal(evaluate(`(let sum 0) (for value ${collection} (set sum (+ sum value))) sum`, trace), 6);
    }
    let calls = 0;
    assert.equal(evaluate('(let sum 0) (for n (items) (set sum (+ sum n))) sum', trace, { items: () => { calls++; return bindings.list(2,3); } }), 5);
    assert.equal(calls, 1);
    assert.deepEqual(evaluate('(let a (list 1 2)) (let out (list)) (for value a (insert a 9) (insert out value)) out', trace).values, [1,2]);
    assert.equal(evaluate('(let total 0) (for item (list) (set total 99)) total', trace), 0);
    assert.throws(() => evaluate('(for item (dict))', trace), /for expects/);
    for (const bound of ['1.5', '-1', 'nil', 'Infinity', 'NaN', '9007199254740992']) assert.throws(() => evaluate(`(for i ${bound})`, trace), Error);
  }
});

test('shader loops emit structured loops with bound checks, collection reads and control flow', () => {
  const wgsl = shader(`(sh (items:array<f32> more:many<f32>)
    (let sum 0)
    (while (- 2 sum) (set sum (+ sum 1)))
    (until (bool sum) (set sum 1))
    (for i 1..4 (if (not (bool (- i 2))) (continue)) (set sum (+ sum i)))
    (for i 4..1 (set sum (+ sum i)))
    (for value items (set sum (+ sum value)))
    (for value more (set sum (+ sum value)))
    (for value (array (f32) 1 2) (set sum (+ sum value)))
    (for value (many (f32 4) 1 2) (set sum (+ sum value)))
    (while true (break))
    (return (vec4 sum)))`);
  assert.match(wgsl, /while \(/); assert.match(wgsl, /for \(/);
  assert.match(wgsl, /continue;/); assert.match(wgsl, /break;/);
  assert.match(wgsl, /trunc\(/); assert.match(wgsl, /select\(-1f, 1f/);
  assert.match(wgsl, /let loop\d+n = bitcast<f32>/);
  assert.doesNotThrow(() => shader('(sh (a:f32 b:i32) (let sum 0) (for i a..b (set sum (+ sum i))) (return (vec4 sum)))'));
  assert.doesNotThrow(() => shader('(sh () (let f (fn () (for i 2 (if (not (bool (- i 1))) (return i))) (return 0))) (return (vec4 (f))))'));
  assert.doesNotThrow(() => shader('(sh () (let sum 0) (for item (array (bool) true false) (if item (set sum (+ sum 1)))) (return (vec4 sum)))'));
  assert.doesNotThrow(() => compile('(struct Point x:f32) (sh (points:array<Point>) (let sum 0) (for point points (set sum (+ sum point.x))) (return (vec4 sum)))', bindings, forms));
  assert.doesNotThrow(() => shader('(sh () (let sum 0) (for row (array (array<f32,2>) (array (f32) 1 2)) (for value row (set sum (+ sum value)))) (return (vec4 sum)))'));
  for (const body of ['(break)', '(continue)', '(for i 1.5)', '(for i -1)', '(for i 16777218)', '(for i (vec2))', '(for item (vec2))', '(for i 2 (let i 2))', '(for i 2 (let f (fn () (break) (return 0))) (let a (f)))']) {
    assert.throws(() => shader(`(sh () ${body} (return (vec4 1)))`), SyntaxError, body);
  }
});
