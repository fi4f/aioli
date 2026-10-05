import test from 'node:test';
import assert from 'node:assert/strict';
import { openTabs, openTab, closeTab, renameTab, tabLayout } from '../code-tabs.js';

test('opening sources deduplicates tabs; closing preserves files and the neighboring tab', () => {
  const sources = { scene: 'scene', 'lib/helper.lisp': 'helper' },
    state = { tab: 'scene' };
  openTab(state, sources, 'lib/helper.lisp');
  openTab(state, sources, 'lib/helper.lisp');
  assert.deepEqual(openTabs(state, sources), ['scene', 'lib/helper.lisp']);
  closeTab(state, sources, 'lib/helper.lisp');
  assert.equal(state.tab, 'scene');
  assert.equal(sources['lib/helper.lisp'], 'helper');
  closeTab(state, sources, 'scene');
  assert.equal(state.tab, '');
  assert.deepEqual(openTabs(state, sources), []);
});

test('renaming an open file keeps its position; stale and malformed saved tabs are pruned', () => {
  const sources = { scene: '', 'new.lisp': '' };
  const state = { tab: 'old.lisp', 'open-tabs': ['scene', 'old.lisp'] };
  renameTab(state, sources, 'old.lisp', 'new.lisp');
  assert.deepEqual(openTabs(state, sources), ['scene', 'new.lisp']);
  assert.equal(state.tab, 'new.lisp');
  state['open-tabs'] = [null, 12, 'missing.lisp', 'scene', 'scene'];
  state.tab = 1;
  assert.deepEqual(openTabs(state, sources), ['scene']);
});

test('overflow reveals the active tab and lets the user browse earlier tabs', () => {
  const sources = { scene: '', 'lib/a-long-module.lisp': '', 'lib/another-module.lisp': '' };
  const state = { tab: 'scene' };
  openTab(state, sources, 'lib/a-long-module.lisp');
  openTab(state, sources, 'lib/another-module.lisp');
  const layout = tabLayout(state, sources, sources, 280);
  assert.ok(layout.rows.some((row) => row[0] === state.tab));
  assert.ok(layout.before);
  state['tab-offset'] = 0;
  assert.equal(tabLayout(state, sources, sources, 280).rows[0][0], 'scene');
  const restored = { ...state };
  assert.deepEqual(openTabs(restored, sources), openTabs(state, sources));
  openTab(state, sources, state.tab);
  assert.ok(tabLayout(state, sources, sources, 280).rows.some((row) => row[0] === state.tab));
  assert.ok(tabLayout(state, sources, sources, 200).rows.some((row) => row[0] === state.tab));
});
