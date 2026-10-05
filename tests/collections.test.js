import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, parse } from '../lisp.js';
import { validateValue } from '../state-values.js';
import { sourceMetadata } from '../metadata.js';
import { engineServices } from '../engine-services.js';
import { inspectorFields } from '../inspector-fields.js';
import { fieldValue } from '../generator-inspector.js';
import { policy } from '../editor-policy.js';
import { DrawList } from '../drawing.js';
import { projectTree } from '../file-tree.js';
const runtime = (source, state = {}) => {
  const r = createRuntime(state);
  r.load(parse(source), 'sample.lisp');
  return r;
};

test('collections persist as JSON data and updates preserve previous values', () => {
  const r = runtime(
    '(init! :player (map :x 10 :items ["key"])) (init! :old (get :player)) (set! :player (assoc (get :player) :x 20)) (init! :items [1 2]) (set! :items (conj (get :items) 3)) (init! :empty nil)',
  );
  assert.equal(r.state.player.x, 20);
  assert.equal(r.state.old.x, 10);
  assert.deepEqual(r.state.items, [1, 2, 3]);
  assert.deepEqual(JSON.parse(JSON.stringify(r.state)).player, { x: 20, items: ['key'] });
  assert.equal(r.state.empty, null);
});
test('anonymous functions capture lexical values and collection callbacks share the execution budget', () => {
  const r = runtime(
    '(defn scaled [factor] (let [apply (fn [x] (* x factor))] (mapv apply [1 2 3]))) (defn total [] (reduce (fn [sum value] (+ sum value)) 0 (filter (fn [x] (> x 2)) [1 2 3 4])))',
  );
  assert.deepEqual(r.call('scaled', 3), [3, 6, 9]);
  assert.equal(r.call('total'), 7);
  r.load(parse('(defn too-much [] (mapv (fn [x] (+ x 1)) (range 10000)))'));
  assert.throws(() => r.call('too-much'), /budget/);
});
test('unsafe, cyclic, non-finite and excessively nested state values are rejected', () => {
  for (const value of [Infinity, NaN, () => {}, JSON.parse('{"__proto__":1}')])
    assert.throws(() => validateValue(value));
  const cycle = [];
  cycle.push(cycle);
  assert.throws(() => validateValue(cycle), /limits/);
  let nested = 1;
  for (let i = 0; i < 34; i++) nested = [nested];
  assert.throws(() => validateValue(nested), /limits/);
  const r = runtime('');
  assert.throws(() => r.load(parse('(set! :constructor 1)')), /key/);
});
test('definition and state metadata expose source positions and uninterpreted annotations', () => {
  const source =
    '; comment\n(init! :radius 20 ["Radius" 1 40])\n(defdraw paint [x] ["Paint" [10] [0 0]] (circle [x 0] 2))';
  const r = runtime(source),
    defs = r.global.definitions(),
    fields = r.global['state-metadata']();
  assert.equal(defs[0].path, 'sample.lisp');
  assert.equal(defs[0].line, 3);
  assert.deepEqual(
    defs[0].annotation,
    ['Paint', [10], [0, 0]],
    'core does not interpret preview canvas limits',
  );
  assert.deepEqual(fields[0].annotation, ['Radius', 1, 40]);
  assert.equal(fields[0].line, 2);
  assert.equal(sourceMetadata(parse(source), 'other.lisp').fields[0].path, 'other.lisp');
});
test('state declarations inside imported functions retain their defining source', () => {
  const r = runtime('');
  r.load(parse('(defn setup [] (init! :library-value 7))'), 'lib/settings.lisp');
  r.load(parse('(setup)'), 'main.lisp');
  assert.equal(r.global['state-metadata']()[0].path, 'lib/settings.lisp');
});
test('structured inspector fields are editable JSON while numeric controls remain bounded', () => {
  const fields = inspectorFields(
    'scene.lisp',
    parse('(init! :items [1 2] ["Items"]) (init! :player nil ["Player"])'),
  );
  assert.deepEqual(
    fields.map((field) => field.kind),
    ['data', 'data'],
  );
  assert.deepEqual(fieldValue(fields[0], '[3,4]'), [3, 4]);
  assert.equal(fieldValue(fields[1], 'null'), null);
  assert.throws(() => fieldValue(fields[0], '{"constructor":1}'), /key/);
});
test('live editor definitions override bundled policy without changing JavaScript', () => {
  const editor = runtime('(defn editor-source-role [path] "custom")');
  assert.equal(policy('editor-source-role', ['file.lisp'], editor), 'custom');
  assert.equal(policy('editor-source-role', ['file.lisp']), 'module');
});
test('file tree queries reuse the native index and invalidate it when paths or expansion change', () => {
  const files = Array.from({ length: 256 }, (_, i) => [
    'folder/' + i + '.lisp',
    'lisp',
    i + '.lisp',
  ]);
  const first = projectTree(files, ['folder']);
  assert.equal(projectTree(files, ['folder']), first);
  assert.notEqual(projectTree(files, []), first);
  assert.equal(first.length, 257);
});

test('drawing bindings are allocated once per command list and still observe scoped state changes', () => {
  const draw = new DrawList(64, 48),
    api = draw.primitives();
  assert.equal(draw.primitives(), api);
  api.fill('#ff0000');
  draw.scope();
  api.translate([10, 0]);
  api.rect([0, 0], [2, 2]);
  draw.restore();
  api.rect([0, 0], [2, 2]);
  assert.deepEqual(
    draw.commands.map((command) => command.bounds[0]),
    [10, 0],
  );
});

test('collection equality compares values rather than allocation identity', () => {
  const r = runtime(
    '(init! :same (= (map :x [1 2] :y nil) (map :y nil :x [1 2]))) (init! :different (= [1 2] [2 1])) (init! :member (contains? [[1 2] [3 4]] [1 2]))',
  );
  assert.equal(r.state.same, true);
  assert.equal(r.state.different, false);
  assert.equal(r.state.member, true);
});

test('computed structured defaults expose their evaluated value without reevaluating initialization', () => {
  const r = runtime(
    '(init! :calls 0) (defn initial [] (set! :calls (+ (get :calls) 1)) (map :x 10)) (init! :player (initial) ["Player"])',
  );
  const field = r.global['state-metadata']().find((info) => info.key === 'player');
  assert.equal(field.value.x, 10);
  assert.equal(field.computed, true);
  assert.equal(policy('editor-inspector-fields', [[field]])[0].kind, 'data');
  r.load(parse('(init! :player (initial) ["Player"])'));
  assert.equal(r.state.calls, 1);
});

test('shared application helpers consume the caller budget and attribute state reads to the active scene', () => {
  const state = {};
  const root = runtime('(init! :shared 7 ["Shared" 0 10]) (defn helper [] (get :shared))', state);
  const scene = createRuntime(state, { budget: 50 });
  scene.global.helper = root.global.helper;
  scene.load(parse('(defn update [] (helper))'));
  for (let i = 0; i < 1000; i++) assert.equal(scene.call('update'), 7);
  assert.equal(scene.stateKeys.has('shared'), true);
  assert.equal(scene.metadata.fields.get('shared').annotation[0], 'Shared');
  scene.load(parse('(defn excessive [] (repeat 64 i (helper)))'));
  assert.throws(() => scene.call('excessive'), /budget/);
});
