import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Data } from "../data.js";
import { Structures } from "../structures.js";
const evaluate = (source, trace = true) => Compiler.run(Compiler.compile(source, Bindings, Forms, { trace }));

test('bool fields preserve primitive booleans through nested mutation, copies, and packed storage', () => {
  for (const trace of [true, false]) {
    const s = evaluate(`(struct Flag "is enabled":bool)
      (struct Item flag:Flag visible:bool color:vec3f)
      (let items (array (Item 2) (Item flag (Flag "is enabled" true) visible false color (vec3f 1))))
      (set items.0.visible true)
      (set items.0.flag."is enabled" false) items`, trace);
    assert.equal(Data.get(Data.get(s, 0), 'visible'), true);
    assert.equal(Data.get(Data.get(Data.get(s, 0), 'flag'), 'is enabled'), false);
    assert.equal(Data.get(Data.get(s, 1), 'visible'), false);
    const duplicate = Data.copy(s);
    Data.put(Data.get(s, 0), 'visible', false);
    assert.equal(Data.get(Data.get(duplicate, 0), 'visible'), true);
    assert.equal(Data.equal(s, Data.reCopy(s)), true);
    const before = [...Structures.collectionInfo(s).storage];
    for (const invalid of [0, 1, null, '', 'true']) assert.throws(() => Data.put(Data.get(s, 0), 'visible', invalid), /bool/);
    assert.deepEqual([...Structures.collectionInfo(s).storage], before);
    assert.equal(evaluate('(struct S flag:bool) S.flag', trace), 'bool');
    assert.equal(evaluate('(true : bool)', trace), true);
  }
});

test('bool arrays and many store zero or one and validate insertion and replacement strictly', () => {
  for (const trace of [true, false]) {
    const array = evaluate('(array (bool 4) true false)', trace);
    assert.deepEqual([...Structures.collectionInfo(array).storage], [1, 0, 0, 0]);
    assert.equal(Data.get(array, 2), false);
    Data.put(array, 2, true);
    assert.equal(Data.get(array, 2), true);
    const many = evaluate('(many (bool) false)', trace);
    Data.insert(many, true); Data.insert(many, false, 0); Data.remove(many, 1);
    assert.deepEqual([Data.get(many, 0), Data.get(many, 1)], [false, true]);
    assert.throws(() => Data.insert(many, 1), /bool/);
    assert.equal(Bindings.len(many), 2);
    const value = evaluate(`(struct S flags:array<bool,3> choices:many<bool,3>)
      (S flags (array (bool) true) choices (many (bool) false true))`, trace);
    assert.equal(Data.get(Data.get(value, 'flags'), 0), true);
    assert.equal(Data.get(Data.get(value, 'flags'), 2), false);
    assert.equal(Data.get(Data.get(value, 'choices'), 1), true);
    assert.equal(Structures.structInfo(value).definition.fields[0].info.element.type, 'bool');
  }
});

test('shader local bool fields and collection elements use native WGSL booleans', () => {
  const program = Compiler.compile(`(struct S enabled:bool flags:array<bool,3> choices:many<bool,3>)
    (sh (input:f32)
      (let toggle (bool input))
      (let flags (array (bool 2) true false))
      (let s (S enabled false flags (array (bool 3) false) choices (many (bool 3) false)))
      (set s.enabled toggle)
      (set s.flags.1 (not flags.0))
      (insert s.choices true)
      (let local (S enabled true flags (array (bool 3) true) choices (many (bool 3) false)))
      (return (vec4f (f32 s.enabled) (f32 s.flags.1) (f32 local.enabled) 1)))`, Bindings, Forms).shaders[0];
  assert.match(program.wgsl, /f0: bool/);
  assert.match(program.wgsl, /array<bool, 3>/);
  assert.doesNotMatch(program.wgsl, /var<storage/);
  assert.match(program.wgsl, /select\(0f, 1f,/);
  assert.match(program.wgsl, /fn readArray\d+\(value: array<bool, \d+>, index: f32\) -> bool/);
});
