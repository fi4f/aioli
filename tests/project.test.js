import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSnapshot, readProject, resolveModules } from '../project.js';
import { parse } from '../lisp.js';

test('project snapshots preserve files, resources, private application state and structured workspace data', () => {
  const source = {
    main: '; editor\r\n',
    game: '(init! :items [1 2])',
    'data/levels.json': '{"levels":[]}',
    __input: 'draft',
  };
  const state = { 'open-tabs': ['main', 'game'], settings: { grid: true }, empty: null };
  const application = { inventory: [{ id: 'key', quantity: 1 }] };
  const resource = {
    mime: 'image/png',
    data: 'data:image/png;base64,AA==',
    source: 'editor/icon/code.png',
  };
  const saved = projectSnapshot(
    source,
    state,
    { 'editor/icon/code.png': resource },
    true,
    application,
  );
  const loaded = readProject(JSON.parse(JSON.stringify(saved)));
  assert.equal(saved.version, 1);
  assert.equal('__input' in saved.files, false);
  assert.equal(loaded.sources.main, '; editor\n');
  assert.deepEqual(loaded.state, state);
  assert.deepEqual(loaded.applicationState, application);
  assert.equal(loaded.recovery, true);
  delete saved.resources['editor/icon/code.png'];
  assert.deepEqual(readProject(saved).resources, {});
});
test('project validation rejects unsupported formats, unsafe paths, invalid state and oversized resources', () => {
  const valid = () => projectSnapshot({ main: '', game: '' }, {}, {});
  for (const value of [NaN, Infinity, () => {}, { constructor: 1 }]) {
    const saved = valid();
    saved.state.bad = value;
    assert.throws(() => readProject(saved));
  }
  for (const path of ['../bad.lisp', '__proto__/bad.lisp', 'bad\\name.lisp']) {
    const saved = valid();
    saved.files[path] = '';
    assert.throws(() => readProject(saved));
  }
  assert.throws(() => readProject({ ...valid(), version: 21 }), /current/);
  const saved = valid();
  saved.resources['bad.png'] = { mime: 'image/png', data: 'https://example.com/icon.png' };
  assert.throws(() => readProject(saved), /Invalid resource/);
});
test('imports load explicit file paths once, reject missing imports and cycles, and preserve source positions', () => {
  const files = {
    game: '(import "./lib/a.lisp") (import "./lib/b.lisp")',
    'lib/a.lisp': '(import "./shared.lisp")',
    'lib/b.lisp': '(import "./shared.lisp")',
    'lib/shared.lisp': '(defn shared [] 1)',
  };
  assert.deepEqual(
    resolveModules(files, ['game']).map((m) => m.path),
    ['lib/shared.lisp', 'lib/a.lisp', 'lib/b.lisp', 'game.lisp'],
  );
  assert.throws(
    () => resolveModules({ game: '(import "missing.lisp")' }, ['game']),
    /Missing import/,
  );
  assert.throws(() => resolveModules({ game: '(import "game.lisp")' }, ['game']), /cycle/);
  assert.equal(parse('; comment\n(defn f [] 1)')[0].location.line, 2);
});
