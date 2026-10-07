import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Aioli } from '../aioli.js';
import { get, dict } from '../engine/language/data.js';

test('self reload exposes candidate source, preserves state, and keeps syntax failures editable', async () => {
  const runtime = new Aioli({ baseURL: 'https://example.test/editor/main.lisp' });
  runtime.graphics = { createText: value => value, createShader() { throw new Error('Unexpected shader'); }, resetScene() {}, destroy() {}, render: callback => callback(dict()) };
  runtime.stage.requestFrame = () => 1;
  runtime.stage.cancelFrame = () => {};
  try {
    const original = '(set aioli.state.seen aioli.source) (on render (context))';
    runtime.setScene(original, { sourceURL: 'https://example.test/editor/main.lisp' });
    const state = get(runtime.context, 'state');
    assert.equal(get(state, 'seen'), original);
    const first = runtime.stage.scene;
    const replacement = '(set aioli.state.seen aioli.source) (set aioli.state.count 1) (on render (context))';
    const reload = get(runtime.context, 'reload');
    const pending = reload(replacement);
    assert.equal(runtime.stage.scene, first, 'replacement waits until the caller returns');
    await pending;
    assert.equal(get(runtime.context, 'state'), state);
    assert.equal(get(state, 'seen'), replacement);
    assert.equal(get(runtime.context, 'source'), replacement);
    const installed = runtime.stage.scene;
    await assert.rejects(reload('(let broken'), /editor\/main\.lisp/);
    assert.equal(runtime.stage.scene, installed);
    assert.equal(get(state, 'count'), 1);
    assert.equal(get(runtime.context, 'source'), replacement);
  } finally { runtime.destroy(); }
});

test('self reload checks the first render and restores the working editor on computed text errors', async () => {
  const events = [];
  const runtime = new Aioli({ baseURL: 'https://example.test/editor/main.lisp', bindings: { record: value => events.push(value) } });
  runtime.graphics = { createText: value => value, createShader() { throw new Error('Unexpected shader'); }, resetScene() {}, destroy() {}, render: callback => callback(dict()) };
  runtime.stage.requestFrame = () => 1;
  runtime.stage.cancelFrame = () => {};
  try {
    const original = '(on attach () (record "old attach")) (on detach () (record "old detach")) (on render (context))';
    runtime.setScene(original);
    const previous = runtime.stage.scene;
    await assert.rejects(runtime.reload('(let value 0) (on attach () (record "new attach")) (on detach () (record "new detach")) (on render (context) (text (resolution value) "hello"))', 'https://example.test/editor/main.lisp'), /resolution expects a positive finite/);
    assert.equal(runtime.stage.scene, previous);
    assert.equal(runtime.stage.failed, false);
    assert.equal(runtime.stage.attaching, false);
    assert.equal(get(runtime.context, 'source'), original);
    assert.deepEqual(events, ['old attach', 'new attach', 'new detach', 'old detach', 'old attach']);
    events.length = 0;
    await runtime.reload('(on attach () (record "good attach")) (on render (context) (record "good render"))', 'https://example.test/editor/main.lisp');
    assert.deepEqual(events, ['good attach', 'good render', 'old detach']);
  } finally { runtime.destroy(); }
});

test('untraced self reload installs normally and allows a render failure to stop the Stage', async () => {
  const errors = [];
  let frame;
  const runtime = new Aioli({ trace: false, baseURL: 'https://example.test/editor/main.lisp', onError: error => errors.push(error) });
  runtime.graphics = { createText: value => value, createShader() { throw new Error('Unexpected shader'); }, resetScene() {}, destroy() {}, render: callback => callback(dict()) };
  runtime.stage.requestFrame = callback => { frame = callback; return 1; };
  runtime.stage.cancelFrame = () => {};
  try {
    runtime.setScene('(on render (context))');
    const previous = runtime.stage.scene;
    await runtime.reload('(let value 0) (on render (context) (text (resolution value) "hello"))', 'https://example.test/editor/main.lisp');
    assert.notEqual(runtime.stage.scene, previous);
    assert.equal(errors.length, 0);
    frame(0);
    assert.equal(runtime.stage.failed, true);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /resolution expects a positive finite/);
    assert.equal(errors[0].lisp, undefined);
  } finally { runtime.destroy(); }
});
