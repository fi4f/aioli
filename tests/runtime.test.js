import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, print, createRuntime } from '../lisp.js';
import { compilePixelShader } from '../shader.js';
import { defaults } from './fixtures.js';
import { validateVoice, synthesize, wav } from '../audio.js';

function boot(keys = new Set(), existing = {}) {
  const state = { ...existing },
    voices = [];
  const r = createRuntime(state, {
    key: (k) => keys.has(k),
    voice: (...a) => voices.push(validateVoice(...a)),
  });
  r.load(parse(defaults['examples/garden.scene.lisp']));
  return { r, state, voices };
}
test('reader round-trips strings, vectors, numbers, and comments', () => {
  const source = '; comment\n(defn f [x] (label "hi; \\"friend\\""))';
  assert.deepEqual(parse(print(parse(source)[0])), parse(source));
  assert.throws(() => parse('(a [1 2)'), /unexpected/);
  assert.throws(() => parse('(a'), /missing/);
});
test('gameplay moves, clamps, jumps, and lands using Lisp code', () => {
  const keys = new Set(['ArrowRight']),
    { r, state } = boot(keys);
  r.call('update', 0.1);
  assert.equal(state.x, 167.5);
  for (let i = 0; i < 100; i++) r.call('update', 0.1);
  assert.equal(state.x, 314);
  keys.clear();
  keys.add(' ');
  r.call('update', 0.01);
  assert.ok(state.y < 190);
  assert.ok(state.vy < 0);
  keys.clear();
  for (let i = 0; i < 100; i++) r.call('update', 0.01);
  assert.equal(state.y, 190);
  assert.equal(state.vy, 0);
});
test('live reload preserves shared state and function replacement', () => {
  const { r, state } = boot(new Set(), { x: 90, moon: 31 });
  r.load(parse(defaults['examples/garden.scene.lisp']));
  assert.equal(state.x, 90);
  assert.equal(state.moon, 31);
  r.load(parse('(defn center [] (set! :x 160))'));
  r.call('center');
  assert.equal(state.x, 160);
  r.load(parse('(defn center [] (set! :x 80))'));
  r.call('center');
  assert.equal(state.x, 80);
});
test('runtime bounds recursive evaluations and rejects non-finite arithmetic', () => {
  const r = createRuntime({});
  r.load(parse('(defn loop [] (loop))'));
  assert.throws(() => r.call('loop'), /budget|stack/i);
  assert.throws(() => r.evaluate(parse('(/ 1 0)')[0]), /non-finite/);
});
test('shader state scopes preserve accumulated color; expansion and types are checked', () => {
  const s = compilePixelShader(parse('(scope (fill "#ffffff") (circle [0 0] 2))'));
  assert.match(s.code, /d.p = saved0.p/);
  assert.doesNotMatch(s.code, /d.color = saved0.color/);
  assert.throws(() => compilePixelShader(parse('(repeat 65 i (circle [0 0] 2))')), /0–64/);
  assert.throws(() => compilePixelShader(parse('(circle 3 2)')), /vec2f/);
  assert.throws(
    () => compilePixelShader(parse('(fill (param :absent))'), {}),
    /Unknown shader parameter/,
  );
});
test('audio recipes mix deterministic finite samples and export valid PCM WAV', () => {
  const { r, voices } = boot();
  r.call('sound');
  assert.equal(voices.length, 2);
  const samples = synthesize(voices);
  assert.ok(samples.some((x) => x !== 0));
  assert.ok(samples.every(Number.isFinite));
  assert.deepEqual(samples, synthesize(voices));
  const file = wav(samples),
    view = new DataView(file);
  assert.equal(new TextDecoder().decode(file.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 44100);
  assert.throws(() => validateVoice('sine', 440, 880, 100, 0.5), /duration/);
});
