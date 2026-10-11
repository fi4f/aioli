import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Bindings } from "../bindings.js";
import { Forms } from "../forms.js";

test('comparison tokens coexist with nested collection type annotations', () => {
  assert.deepEqual(Compiler.read('< > <= >=').map(node => node.name), ['<','>','<=','>=']);
  assert.equal(Compiler.read('array<array<f32,2>,3>')[0].name, 'array<array<f32,2>,3>');
});

test('regular comparisons return booleans, validate operands and evaluate once in order', () => {
  for (const trace of [true, false]) {
    const evaluate = (source, extra = {}) => Compiler.run(Compiler.compile(source, { ...Bindings, ...extra }, Forms, { trace }));
    for (const op of ['<','>','<=','>=']) for (const [a,b] of [[1,2],[2,1],[1,1],[-3,0],[0,-0]]) {
      assert.equal(evaluate(`(${op} ${a} ${b})`), Bindings[op](a,b));
    }
    assert.throws(() => evaluate('(<= -Infinity Infinity)'), SyntaxError);
    for (const op of ['<','>','<=','>=']) assert.throws(() => evaluate(`(${op} NaN 1)`), SyntaxError);
    const events = [];
    assert.equal(evaluate('(< (next 1) (next 2))', { next: n => { events.push(n); return n; } }), true);
    assert.deepEqual(events, [1,2]);
    assert.equal(evaluate('(let compare <) (compare 1 2)'), true);
    assert.equal(evaluate('(let n 0) (while (< n 3) (set n (+ n 1))) n'), 3);
    for (const source of ['(<)', '(> 1)', '(<= 1 2 3)', '(>= "1" 2)', '(< true 2)', '(> nil 2)', '(< (vec2) (vec2))', '(< (mat2) 2)']) assert.throws(() => evaluate(source), TypeError);
  }
});

test('shader comparisons accept matching scalar families and compose with loops and conditions', () => {
  const shader = source => Compiler.compile(source, Bindings, Forms).shaders[0].wgsl;
  const wgsl = shader('(sh (a:f32 b:f32) (let n 0) (while (< n 3) (set n (+ n 1))) (until (>= n 4) (set n (+ n 1))) (if (and (> a b) (<= b n)) (return (vec4 n)) else (return (vec4 0))))');
  for (const op of ['<','>','<=','>=']) assert.ok(wgsl.includes(` ${op} `));
  for (const type of ['i32','u32']) assert.doesNotThrow(() => shader(`(sh (a:${type} b:${type}) (if (< a b) (return (vec4 1)) else (return (vec4 0))))`));
  for (const expression of ['(<)', '(> 1)', '(<= 1 2 3)', '(>= true 2)', '(< (vec2) (vec2))', '(< (i32 1) 2)', '(> (u32 1) (i32 2))']) assert.throws(() => shader(`(sh () (if ${expression} (return (vec4 1)) else (return (vec4 0))))`), SyntaxError);
});
