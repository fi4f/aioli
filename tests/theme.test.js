import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRuntime, parse } from '../lisp.js';
import { resolveModules, cpuForms } from '../module-loader.js';
import { readProject, projectSnapshot } from '../project.js';
import { editorSourcePaths } from '../editor-sources.js';
const path = 'editor/theme.lisp';
const theme = readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('theme constants replace saved colors, live edits reapply, and every editor color comes from the theme', () => {
  const state = { 'ui-bg': '#101613', 'ui-accent': '#bbd6a6', paused: true };
  const r = createRuntime(state);
  r.load(parse(theme));
  assert.equal(state['ui-bg'], '#1e1f1c');
  assert.equal(state['ui-accent'], '#66d9ef');
  assert.equal(state.paused, true);
  r.load(parse(theme.replace('#66d9ef', '#ff7799')));
  assert.equal(state['ui-accent'], '#ff7799');
  for (const file of editorSourcePaths.filter((file) => file !== path)) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /"#[0-9a-f]{3,8}"/i, file);
    for (const match of source.matchAll(/\(get :(ui-[a-z-]+)\)/g))
      assert.ok(match[1] in state, match[1]);
  }
});

test('theme migration adds the file before stock imports, retains custom themes and respects later deletion', () => {
  const defaults = { main: '', game: '', [path]: theme };
  const old = { version: 18, files: { 'main.lisp': '', 'game.lisp': '' }, state: { paused: true } };
  const migrated = readProject(old, defaults);
  assert.ok(migrated.sources[path].includes('ui-accent'));
  const custom = readProject(
    { ...old, files: { ...old.files, [path]: '(set! :ui-accent "#ff7799")' } },
    defaults,
  );
  assert.equal(custom.sources[path], '(set! :ui-accent "#ff7799")');
  delete migrated.sources[path];
  assert.equal(
    path in readProject(projectSnapshot(migrated.sources, migrated.state), defaults).sources,
    false,
  );
});

test('the workspace loads its theme even when a customized legacy state module does not import it', () => {
  const sources = Object.fromEntries(
    editorSourcePaths.map((file) => [
      file,
      readFileSync(new URL('../' + file, import.meta.url), 'utf8'),
    ]),
  );
  sources['editor/state.lisp'] = sources['editor/state.lisp'].replace(
    '(import "./theme.lisp")',
    '(init! :ui-bg "#101613") (init! :custom-editor-setting 7)',
  );
  const state = {},
    runtime = createRuntime(state);
  for (const module of resolveModules(sources, ['editor/workspace.lisp']))
    runtime.load(cpuForms(module.forms));
  assert.equal(state['ui-bg'], '#1e1f1c');
  assert.equal(state['ui-accent'], '#66d9ef');
  assert.equal(state['custom-editor-setting'], 7);
});
