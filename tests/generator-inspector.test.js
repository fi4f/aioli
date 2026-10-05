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
    /exactly one/,
  );
});

test('legacy projects migrate commands, generator imports and workspace references', () => {
  const project = {
    version: 5,
    files: {
      'main.lisp': '(import "./commands/helper.lisp")',
      'editor.lisp': '(import "./generators/image.lisp") (defn editor [] nil)',
      'generators/image.lisp': '(init! :radius 3) (defpixel image [p time] (background "#000000"))',
      'commands/helper.lisp': '(defn helper [] 1)',
      'commands/nested/reset.lisp': '(set! :radius 7)',
    },
    state: {
      tab: 'commands/nested/reset.lisp',
      'selected-file': 'main.lisp',
      'open-tabs': '["main","commands/nested/reset.lisp"]',
      window: 'image',
    },
  };
  const loaded = readProject(project, {});
  assert.ok(loaded.sources['examples/commands/nested/reset.command.lisp']);
  assert.ok(loaded.sources['examples/generators/image.generator.lisp']);
  assert.equal(loaded.state.tab, 'examples/commands/nested/reset.command.lisp');
  assert.equal(loaded.state['selected-file'], 'game.lisp');
  assert.equal(loaded.state.window, 'generator');
  assert.equal(loaded.state['active-generator'], 'examples/generators/image.generator.lisp');
  assert.deepEqual(JSON.parse(loaded.state['open-tabs']), [
    'game',
    'examples/commands/nested/reset.command.lisp',
  ]);
  assert.equal(
    resolveModules(loaded.sources, ['game'])[0].path,
    'examples/commands/helper.command.lisp',
  );
  assert.match(loaded.sources.main, /image.generator.lisp/);
  assert.equal(sourceKey('main.lisp'), 'main');
  assert.equal(projectSnapshot(loaded.sources, loaded.state).version, 21);
  assert.throws(
    () =>
      readProject(
        { ...project, files: { ...project.files, 'commands/helper.command.lisp': '' } },
        {},
      ),
    /conflicts/,
  );
});

test('main.lisp is canonical and version 6 saves repair earlier main.app.lisp references', () => {
  assert.equal(sourceRole('main.lisp'), 'app');
  const loaded = readProject(
    {
      version: 6,
      files: {
        'main.app.lisp': '(defpixel render [p time] (background "#000000"))',
        'editor.lisp': '(import "./main.app.lisp") (defn editor [] nil)',
        'commands/helper.lisp': '(defn helper [] 1)',
      },
      state: { 'selected-file': 'main.app.lisp', 'open-tabs': '["main.app.lisp"]' },
    },
    {},
  );
  assert.equal(rolePath(loaded.sources, 'app', true), 'main.lisp');
  assert.equal(loaded.state['selected-file'], 'game.lisp');
  assert.deepEqual(JSON.parse(loaded.state['open-tabs']), ['game']);
  assert.match(loaded.sources.main, /game.lisp/);
  assert.ok(loaded.sources['examples/commands/helper.lisp']);
  assert.ok(projectSnapshot(loaded.sources, loaded.state).files['main.lisp']);
});
