import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppCore } from "../app.js";
import { Scheduler } from "../scheduler.js";
import { Data } from "../data.js";

test('self reload exposes candidate source, preserves state, and keeps syntax failures editable', async () => {
  const runtime = AppCore.new({ baseURL: 'https://example.test/editor/main.lisp' });
  runtime.graphics = {};
  runtime.services.graphics = { createText: (graphics, value) => value, createShader() { throw new Error('Unexpected shader'); }, resetScene() {}, destroy() {}, render: (graphics, callback) => callback(Data.dict()) };
  runtime.requestFrame = () => 1;
  runtime.cancelFrame = () => {};
  try {
    const original = '(set app.state.seen app.source) (on render (context))';
    AppCore.setScene(runtime,original, { sourceURL: 'https://example.test/editor/main.lisp' });
    const state = runtime.state;
    assert.equal(Data.get(state, 'seen'), original);
    const first = runtime.scene;
    const replacement = '(set app.state.seen app.source) (set app.state.count 1) (on render (context))';
    const reload = (source => AppCore.reload(runtime, source, runtime.sourceURL));
    const pending = reload(replacement);
    assert.equal(runtime.scene, first, 'replacement waits until the caller returns');
    await pending;
    assert.equal(runtime.state, state);
    assert.equal(Data.get(state, 'seen'), replacement);
    assert.equal(runtime.source, replacement);
    const installed = runtime.scene;
    await assert.rejects(reload('(let broken'), /editor\/main\.lisp/);
    assert.equal(runtime.scene, installed);
    assert.equal(Data.get(state, 'count'), 1);
    assert.equal(runtime.source, replacement);
  } finally { AppCore.destroy(runtime); }
});

test('self reload checks the first render and restores the working editor on computed text errors', async () => {
  const events = [];
  const runtime = AppCore.new({ baseURL: 'https://example.test/editor/main.lisp', bindings: { record: value => events.push(value) } });
  runtime.graphics = {};
  runtime.services.graphics = { createText: (graphics, value) => value, createShader() { throw new Error('Unexpected shader'); }, resetScene() {}, destroy() {}, render: (graphics, callback) => callback(Data.dict()) };
  runtime.requestFrame = () => 1;
  runtime.cancelFrame = () => {};
  try {
    const original = '(on attach () (record "old attach")) (on detach () (record "old detach")) (on render (context))';
    AppCore.setScene(runtime,original);
    const previous = runtime.scene;
    await assert.rejects(AppCore.reload(runtime,'(let value 0) (on attach () (record "new attach")) (on detach () (record "new detach")) (on render (context) (text (resolution value) "hello"))', 'https://example.test/editor/main.lisp'), /resolution expects a positive finite/);
    assert.equal(runtime.scene, previous);
    assert.equal(runtime.failed, false);
    assert.equal(runtime.attaching, false);
    assert.equal(runtime.source, original);
    assert.deepEqual(events, ['old attach', 'new attach', 'new detach', 'old detach', 'old attach']);
    events.length = 0;
    await AppCore.reload(runtime,'(on attach () (record "good attach")) (on render (context) (record "good render"))', 'https://example.test/editor/main.lisp');
    assert.deepEqual(events, ['good attach', 'good render', 'old detach']);
  } finally { AppCore.destroy(runtime); }
});

test('untraced self reload installs normally and allows a render failure to stop the scheduler', async () => {
  const errors = [];
  let frame;
  const runtime = AppCore.new({ trace: false, baseURL: 'https://example.test/editor/main.lisp', onError: error => errors.push(error) });
  runtime.graphics = {};
  runtime.services.graphics = { createText: (graphics, value) => value, createShader() { throw new Error('Unexpected shader'); }, resetScene() {}, destroy() {}, render: (graphics, callback) => callback(Data.dict()) };
  runtime.requestFrame = callback => { frame = callback; return 1; };
  runtime.cancelFrame = () => {};
  try {
    AppCore.setScene(runtime,'(on render (context))');
    const previous = runtime.scene;
    await AppCore.reload(runtime,'(let value 0) (on render (context) (text (resolution value) "hello"))', 'https://example.test/editor/main.lisp');
    assert.notEqual(runtime.scene, previous);
    assert.equal(errors.length, 0);
    frame(0);
    assert.equal(runtime.failed, true);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /resolution expects a positive finite/);
    assert.equal(errors[0].lisp, undefined);
  } finally { AppCore.destroy(runtime); }
});
