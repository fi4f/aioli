import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../lisp.js';
import { stageGenerators } from '../generator-inspector.js';
import { textOutput, textMime } from '../text-generator.js';
import { readProject, projectSnapshot } from '../project.js';
import { newFileCode } from '../file-templates.js';

test('text generators isolate output hooks, preserve UTF-8 and regenerate when parameters change', () => {
  const state = {};
  const application = createRuntime(state);
  application.global['generate-text'] = () => 'editor';
  const programs = stageGenerators(
    {
      'level.generator.lisp':
        '(generator :text "Level" "levels/data.json") (init! :width 16 ["Width" 1 64 1]) (defn generate-text [] (str "é 🌱 " (get :width)))',
      'other.generator.lisp': '(generator :text "Other") (defn generate-text [] "other")',
    },
    application,
    () => createRuntime(state),
  );
  const level = programs.find((p) => p.title === 'Level');
  assert.equal(level.filename, 'levels/data.json');
  assert.equal(textOutput(level).text, 'é 🌱 16');
  const cached = textOutput(level);
  assert.equal(textOutput(level), cached);
  state.width = 24;
  assert.equal(textOutput(level).text, 'é 🌱 24');
  assert.notEqual(textOutput(level, true), cached);
  assert.equal(textOutput(programs.find((p) => p.title === 'Other')).text, 'other');
  assert.equal(application.call('generate-text'), 'editor');
  assert.equal(textMime('levels/data.json'), 'application/json;charset=utf-8');
  assert.equal(textMime('file.custom'), 'text/plain;charset=utf-8');
});

test('text output failures are bounded, cached, and recover after a field edit', () => {
  const application = createRuntime({});
  const state = {};
  const [program] = stageGenerators(
    {
      'bad.generator.lisp':
        '(generator :text) (init! :valid false) (defn generate-text [] (if (get :valid) "" 42))',
    },
    application,
    () => createRuntime(state),
  );
  const failed = textOutput(program);
  assert.match(failed.error, /return a string/);
  assert.equal(textOutput(program), failed);
  state.valid = true;
  assert.equal(textOutput(program).error, '');
  assert.equal(textOutput(program).text, '');
  assert.throws(
    () =>
      stageGenerators({ 'missing.generator.lisp': '(generator :text)' }, application, () =>
        createRuntime({}),
      ),
    /missing.*generate-text/,
  );
  const [starter] = stageGenerators(
    { 'starter.generator.lisp': newFileCode('generator', 'text') },
    application,
    () => createRuntime({}),
  );
  assert.equal(textOutput(starter).text, 'Hello world\n');
});

test('UTF-8 text resources survive project save/load with their charset metadata', () => {
  const resource = {
    mime: 'text/plain;charset=utf-8',
    data: 'data:text/plain;charset=utf-8;base64,w6k=',
  };
  const snapshot = projectSnapshot({ main: '', game: '' }, {}, { 'generated.txt': resource });
  assert.deepEqual(readProject(snapshot, {}).resources['generated.txt'], resource);
});

test('the output limit counts UTF-8 bytes rather than JavaScript characters', () => {
  const program = {
    output: 'text',
    fields: [],
    runtime: { state: {}, call: () => 'é'.repeat(3000001) },
  };
  assert.match(textOutput(program).error, /exceeds 6MB/);
});
