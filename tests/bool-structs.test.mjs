import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler/compiler.js';
import { forms } from '../engine/compiler/forms.js';
import { bindings } from '../engine/language/bindings.js';
import { get, put, copy, reCopy, equal, insert, remove } from '../engine/language/data.js';
import { collectionInfo, structInfo } from '../engine/language/structures.js';
const evaluate = (source, trace = true) => compile(source, bindings, forms, { trace }).run();

test('bool fields preserve primitive booleans through nested mutation, copies, and packed storage', () => {
  for (const trace of [true, false]) {
    const s = evaluate(`(struct Flag "is enabled":bool)
      (struct Item flag:Flag visible:bool color:vec3f)
      (let items (array (Item 2) (Item flag (Flag "is enabled" true) visible false color (vec3f 1))))
      (set items.0.visible true)
      (set items.0.flag."is enabled" false) items`, trace);
    assert.equal(get(get(s, 0), 'visible'), true);
    assert.equal(get(get(get(s, 0), 'flag'), 'is enabled'), false);
    assert.equal(get(get(s, 1), 'visible'), false);
    const duplicate = copy(s);
    put(get(s, 0), 'visible', false);
    assert.equal(get(get(duplicate, 0), 'visible'), true);
    assert.equal(equal(s, reCopy(s)), true);
    const before = [...collectionInfo(s).storage];
    for (const invalid of [0, 1, null, '', 'true']) assert.throws(() => put(get(s, 0), 'visible', invalid), /bool/);
    assert.deepEqual([...collectionInfo(s).storage], before);
    assert.equal(evaluate('(struct S flag:bool) S.flag', trace), 'bool');
    assert.equal(evaluate('(true : bool)', trace), true);
  }
});

test('bool arrays and many store zero or one and validate insertion and replacement strictly', () => {
  for (const trace of [true, false]) {
    const array = evaluate('(array (bool 4) true false)', trace);
    assert.deepEqual([...collectionInfo(array).storage], [1, 0, 0, 0]);
    assert.equal(get(array, 2), false);
    put(array, 2, true);
    assert.equal(get(array, 2), true);
    const many = evaluate('(many (bool) false)', trace);
    insert(many, true); insert(many, false, 0); remove(many, 1);
    assert.deepEqual([get(many, 0), get(many, 1)], [false, true]);
    assert.throws(() => insert(many, 1), /bool/);
    assert.equal(bindings.len(many), 2);
    const value = evaluate(`(struct S flags:array<bool,3> choices:many<bool,3>)
      (S flags (array (bool) true) choices (many (bool) false true))`, trace);
    assert.equal(get(get(value, 'flags'), 0), true);
    assert.equal(get(get(value, 'flags'), 2), false);
    assert.equal(get(get(value, 'choices'), 1), true);
    assert.equal(structInfo(value).definition.fields[0].info.element.type, 'bool');
  }
});

test('shader bool fields and collection elements lower to encoded f32 storage with logical bool reads', () => {
  const program = compile(`(struct S enabled:bool flags:array<bool,3> choices:many<bool,3>)
    (sh (items:array<S> flags:array<bool> toggle:bool)
      (let s items.0)
      (set s.enabled toggle)
      (set s.flags.1 (not flags.0))
      (insert s.choices true)
      (let local (S enabled true flags (array (bool 3) true) choices (many (bool 3) false)))
      (return (vec4f (f32 s.enabled) (f32 s.flags.1) (f32 local.enabled) 1)))`, bindings, forms).shaders[0];
  assert.match(program.wgsl, /f0: f32/);
  assert.match(program.wgsl, /array<f32, 3>/);
  assert.match(program.wgsl, /resource1: array<f32>/);
  assert.match(program.wgsl, /select\(0f, 1f,/);
  assert.doesNotMatch(program.wgsl, /f\d+: bool/);
  assert.match(program.wgsl, /fn readStorage\d+\(index: f32\) -> bool/);
});
