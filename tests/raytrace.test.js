import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../lisp.js';
import { engineServices } from '../engine-services.js';
import { compilePixelShader } from '../shader.js';
const source = readFileSync(new URL('../examples/raytrace.scene.lisp', import.meta.url), 'utf8');

test('Neon Orbits compiles a single pixel program and its camera/pause/reset controls work', () => {
  const keys = new Set(),
    state = {};
  const runtime = engineServices({ key: (key) => keys.has(key) }).create(state);
  runtime.load(parse(source));
  const shader = runtime.drawFrame().commands[0].pixel.shader;
  assert.match(shader.pixelBody, /reflect\(/);
  keys.add('d');
  runtime.call('update', 0.1);
  keys.clear();
  assert.ok(state['orbit-angle'] > 0.35);
  keys.add('w');
  runtime.call('update', 10);
  keys.clear();
  assert.equal(state['orbit-distance'], 3.8);
  keys.add(' ');
  runtime.call('update', 0.1);
  const clock = state['orbit-clock'];
  runtime.call('update', 0.1);
  assert.equal(state['orbit-clock'], clock);
  assert.equal(state['orbit-frozen'], true);
  keys.clear();
  runtime.call('update', 0.1);
  keys.add(' ');
  runtime.call('update', 0.1);
  assert.equal(state['orbit-frozen'], false);
  keys.clear();
  keys.add('r');
  runtime.call('update', 0.1);
  assert.equal(state['orbit-angle'], 0.35);
  assert.equal(state['orbit-distance'], 6.5);
  assert.equal(runtime.drawFrame().commands[0].pixel.shader, shader);
});

test('shader vector math and components reject invalid dimensions', () => {
  assert.doesNotThrow(() =>
    compilePixelShader(parse('(let [v [1 2 3]] (rgb (dot v v) (length (cross v [0 1 0])) v.z))')),
  );
  for (const code of [
    '(dot [1 2] [1 2 3])',
    '(normalize 1)',
    '(cross [1 2] [3 4])',
    '(let [v [1 2]] v.z)',
  ])
    assert.throws(() => compilePixelShader(parse(code)), /expects|Invalid shader/);
});
