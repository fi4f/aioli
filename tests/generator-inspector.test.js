import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, createRuntime } from '../lisp.js';
import { generatorDescriptor, stageGenerators, fieldValue } from '../generator-inspector.js';
import { rolePath, readProject, projectSnapshot, resolveModules, sourceKey } from '../project.js';
import { sourceRole } from '../source-roles.js';
import { isCommandFile, assetKind } from '../file-tree.js';

test('editor entry names are conventional; component suffixes work in any directory', () => {
  assert.equal(sourceRole('tools/reset.command.lisp'), 'command');
  assert.equal(isCommandFile('reset.command.lisp'), true);
  assert.equal(isCommandFile('commands/helper.lisp'), false);
  assert.equal(assetKind('assets/shape.generator.lisp', 'lisp'), 'generator');
  const sources = { main: '', editor: '', game: '', 'startup/game.app.lisp': '' };
  assert.equal(rolePath(sources, 'app', true), 'main.lisp');
  assert.equal(sourceRole('editor.lisp'), 'module');
  assert.equal(sourceRole('shell/ui.editor.lisp'), 'module');
  assert.throws(() => rolePath({}, 'app', true), /Missing/);
});

test('inspector infers controls and validates annotated ranges and choices', () => {
  const descriptor = generatorDescriptor(
    'shape.generator.lisp',
    parse(`
    (generator :image "Shape")
    (init! :radius 48 ["Radius" 1 120 1])
    (init! :enabled true ["Enabled"])
    (init! :color "#aabbcc")
    (init! :name "Hello")
    (init! :wave "sine" ["Wave" ["sine" "triangle"]])`),
  );
  assert.equal(descriptor.title, 'Shape');
  assert.deepEqual(
    descriptor.fields.map((field) => field.kind),
    ['number', 'boolean', 'color', 'text', 'choice'],
  );
  assert.equal(fieldValue(descriptor.fields[0], 48.6), 49);
  assert.equal(fieldValue(descriptor.fields[0], 999), 120);
  assert.throws(() => fieldValue(descriptor.fields[0], NaN), /finite/);
  assert.throws(() => fieldValue(descriptor.fields[4], 'noise'), /choice/);
  for (const source of [
    '(init! :x 1 ["X" 4 2])',
    '(init! :x 1 ["X" 0 2 0])',
    '(init! :x "a" ["X" ["b"]])',
    '(generator :video "Wrong")',
    '(init! :x true ["X" 0 1])',
    '(init! :x "a" ["X" []])',
  ])
    assert.throws(() => generatorDescriptor('bad.generator.lisp', parse(source)));
});

test('generator runtimes isolate hooks, import helpers, and preserve live state', () => {
  const state = { pitch: 880 };
  const application = createRuntime(state);
  application.load(parse('(defn update [dt] nil) (defn helper [] 7)'));
  const sources = {
    'lib/math.lisp': '(defn doubled [x] (* x 2))',
    'one.generator.lisp':
      '(generator :audio "One") (import "./lib/math.lisp") (init! :pitch 440 ["Pitch" 40 1600]) (defn generate-sound [] (doubled (get :pitch)))',
    'elsewhere/two.generator.lisp':
      '(generator :audio "Two") (init! :other 5) (defn generate-sound [] (helper))',
  };
  const programs = stageGenerators(sources, application, () => createRuntime(state));
  assert.equal(programs.find((p) => p.title === 'One').runtime.call('generate-sound'), 1760);
  assert.equal(programs.find((p) => p.title === 'Two').runtime.call('generate-sound'), 7);
  assert.equal(application.global['generate-sound'], undefined);
  assert.equal(programs[0].runtime.global.update, undefined);
  assert.equal(state.pitch, 880);
  assert.throws(
    () =>
      stageGenerators({ 'bad.generator.lisp': '(generator :audio)' }, application, () =>
        createRuntime(state),
      ),
    /missing/,
  );
  assert.throws(
    () =>
      stageGenerators({ 'bad.generator.lisp': '(generator :image)' }, application, () =>
        createRuntime(state),
      ),
    /defdraw render/,
  );
});
