import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';

const shader = source => compile(source, {}, forms).shaders[0];

test('shader branch bodies can mix unbraced statements and multi-statement blocks', () => {
  shader(`(sh (flag:bool)
    (let color (vec4f 0))
    (if flag (set color.x 0.5) elif false { (set color.y 0.25) (set color.z 0.75) }
      else (set color.z 1))
    (if false (return (vec4f 1)))
    (return color))`);
  const result = shader(`(sh (flag:bool)
    (if flag (return (vec4f 1)) elif false (return (vec4f 0.5)) else (return (vec4f 0))))`);
  assert.match(result.wgsl, /else if \(false\)/);
  assert.throws(() => shader('(sh () (if true (let value 1)) (return (vec4f value)))'), /Unknown shader symbol/);
});

test('shader branch chains support optional else, scoped declarations, and outer mutation', () => {
  const result = shader(`(sh (enabled:bool)
    (let color (vec4f 0))
    (if enabled { (let value 0.2) (set color (vec4f value)) }
      elif 0 { (let value 0.4) (set color (vec4f value)) }
      elif (not enabled) { (let value 0.6) (set color (vec4f value)) }
      else { (set color (vec4f 1)) })
    (if false { (set color.x 0) })
    (return color))`);
  assert.match(result.wgsl, /else if/);
  assert.match(result.wgsl, /else \{/);
  assert.match(result.wgsl, /bool1\(0f\)/);
  assert.match(result.wgsl, /if \(false\)/);
  assert.throws(() => shader('(sh () (if true { (let value 1) }) (return (vec4f value)))'), /Unknown shader symbol/);
  assert.throws(() => shader('(sh () (if true { (set value 1) (let value 0) }) (return (vec4f 1)))'), /before initialization/);
});

test('complete conditional returns satisfy fragment and helper return requirements', () => {
  shader('(sh (flag:bool) (if flag { (return (vec4f 1)) } else { (return (vec4f 0)) }))');
  shader(`(sh (flag:bool)
    (let choose (fn (a:bool)
      (if a { (return 0.25) } elif false { (return 0.5) } else { (return 0.75) })))
    (return (vec4f (choose flag))))`);
  shader(`(sh (a:bool b:bool)
    (if a { (if b { (return (vec4f 1)) } else { (return (vec4f 0)) }) }
      else { (return (vec4f 0.5)) }))`);
  shader('(sh (flag:bool) (if flag (return (vec4f 1)) (return (vec4f 0))))');
});

test('partial returns merge their types with fallthrough and require a final return', () => {
  shader('(sh (flag:bool) (if flag { (return (vec4f 1)) }) (return (vec4f 0)))');
  shader(`(sh (flag:bool)
    (let choose (fn (a:bool) (if a { (return 0.5) }) { (return 0.25) }))
    (return (vec4f (choose flag))))`);
  for (const source of [
    '(sh (flag:bool) (if flag { (return (vec4f 1)) }))',
    '(sh () (let choose (fn (a:bool) (if a { (return 1) }))) (return (vec4f 1)))',
    '(sh () (let choose (fn (a:bool) (if a { (return 1) } else { (return (vec2f 1)) }))) (return (vec4f 1)))',
    '(sh () (let choose (fn (a:bool) (if a { (return (vec2f 1)) }) (return 1))) (return (vec4f 1)))',
    '(sh () (let choose (fn (a:bool) { (if a { (return (vec2f 1)) }) } (return 1))) (return (vec4f 1)))',
  ]) assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), source);
});

test('unreachable code is rejected after exhaustive return branches', () => {
  assert.throws(() => shader(`(sh (flag:bool)
    (if flag { (return (vec4f 1)) } else { (return (vec4f 0)) })
    (return (vec4f 0.5)))`), /Unreachable/);
  assert.throws(() => shader('(sh () (if true { (return (vec4f 1)) (let value 0) }) (return (vec4f 0)))'), /Unreachable/);
});

test('malformed shader chains and expression-position conditionals report source traces', () => {
  for (const conditional of [
    '(if)', '(if true)', '(if true {} elif)', '(if true {} elif false)',
    '(if true {} elif false else {})', '(if true {} else)', '(if true {} else elif true {})',
    '(if true {} else {} elif true {})', '(if true {} else {} else {})',
    '(if true {} unknown {})',
  ]) {
    const source = `(sh () ${conditional} (return (vec4f 1)))`;
    assert.throws(() => shader(source), error => error instanceof SyntaxError && Boolean(error.lisp), conditional);
  }
  assert.throws(() => shader('(sh () (return (vec4f (if true 1 0))))'), /statement position/);
});
