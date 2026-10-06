import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRuntime, parse } from '../lisp.js';
import { engineServices } from '../engine-services.js';
import { stageGenerators } from '../generator-inspector.js';
import { textOutput } from '../text-generator.js';

const path = 'examples/generators/moon-dash.generator.lisp';
const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const scene = readFileSync(new URL('../examples/moon-dash.scene.lisp', import.meta.url), 'utf8');
function generator() {
  return stageGenerators({ [path]: source }, createRuntime({}), () => createRuntime({}))[0];
}
function chart(program) {
  const output = textOutput(program);
  assert.equal(output.error, '');
  const runtime = createRuntime({});
  runtime.load(parse(`(defn chart [] ${output.text})`));
  return runtime.call('chart');
}

test('Moon Dash text recipe emits deterministic, editable Lisp charts without mutating state', () => {
  const program = generator();
  assert.equal(program.output, 'text');
  assert.equal(program.filename, 'levels/moon-dash-chart.lisp');
  const before = structuredClone(program.runtime.state);
  const original = textOutput(program).text;
  assert.equal(textOutput(program, true).text, original);
  assert.deepEqual(program.runtime.state, before);
  program.runtime.state['chart-seed']++;
  assert.notEqual(textOutput(program).text, original);
  for (const difficulty of ['gentle', 'spooky', 'spicy']) {
    Object.assign(program.runtime.state, {
      'chart-difficulty': difficulty,
      'chart-spacing': 2,
      'chart-density': 100,
    });
    const obstacles = chart(program);
    assert.equal(obstacles.length, 17);
    assert.equal(obstacles[0][0], 4);
    assert.equal(obstacles.at(-1)[0], 36);
    const allowed =
      difficulty === 'gentle'
        ? ['spike', 'block']
        : difficulty === 'spooky'
          ? ['spike', 'block', 'gap']
          : ['spike', 'block', 'gap', 'double'];
    assert.ok(obstacles.every(([beat, kind]) => Number.isInteger(beat) && allowed.includes(kind)));
  }
  program.runtime.state['chart-density'] = 25;
  assert.ok(chart(program).length < 17);
  assert.equal(chart(program)[0][0], 4);
});

test('generated dense and sparse charts can be completed with real jumps at all supported tempos', () => {
  const program = generator();
  for (const seed of [1, 13, 999999]) {
    for (const spacing of [2, 6]) {
      Object.assign(program.runtime.state, {
        'chart-seed': seed,
        'chart-spacing': spacing,
        'chart-density': 100,
        'chart-difficulty': 'spicy',
      });
      const obstacles = chart(program);
      for (const bpm of [80, 120, 160]) {
        const keys = new Set([' ']);
        const runtime = engineServices({ key: (key) => keys.has(key) }).create({});
        runtime.load(parse(scene));
        runtime.call('enter');
        Object.assign(runtime.state, { 'dash-level': obstacles, 'dash-bpm': bpm });
        runtime.call('update', 1 / 60);
        keys.clear();
        for (
          let frame = 0;
          frame < 2200 && !runtime.state['dash-won'] && !runtime.state['dash-dead'];
          frame++
        ) {
          const x = runtime.state['dash-distance'] + 64;
          const ahead = obstacles.find(([beat]) => beat * 72 > x + 2);
          if (runtime.state['dash-grounded'] && ahead && ahead[0] * 72 - x < 44) keys.add(' ');
          else keys.delete(' ');
          runtime.call('update', 1 / 60);
        }
        assert.equal(
          runtime.state['dash-won'],
          true,
          `${seed}/${spacing}/${bpm} stopped at ${runtime.state['dash-distance']}`,
        );
      }
    }
  }
});
