import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, AppCore } from "../app.js";
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

test('untraced self reload rejects a bad first render and keeps the working editor scheduled', async () => {
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
    await assert.rejects(AppCore.reload(runtime,'(let value 0) (on render (context) (text (resolution value) "hello"))', 'https://example.test/editor/main.lisp'), /resolution expects a positive finite/);
    assert.equal(runtime.scene, previous);
    assert.equal(runtime.attaching, false);
    assert.equal(errors.length, 0);
    frame(0);
    assert.equal(runtime.failed, false);
    assert.equal(errors.length, 0);
    assert.notEqual(runtime.frameId, null);
  } finally { AppCore.destroy(runtime); }
});

for (const trace of [true, false]) {
  test(`failed patch preserves live binding references and can be corrected (trace=${trace})`, async () => {
    const runtime = AppCore.new({ trace });
    const frames = new Map();
    let nextFrame = 0;
    runtime.graphics = {};
    runtime.services.graphics = { resetScene() {}, destroy() {}, render: (graphics, callback) => callback(Data.dict()) };
    runtime.requestFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    runtime.cancelFrame = id => frames.delete(id);
    try {
      await App.loadSource(runtime, '(let count 7) (on render (context))');
      const previous = runtime.scene;
      const reference = App.inspect(runtime).count;
      await assert.rejects(App.patchSource(runtime, '(let count 99) (let value 0) (on render (context) (/ count value))'), /finite number/);
      assert.equal(runtime.scene, previous);
      assert.equal(App.read(runtime, reference), 7);
      assert.equal(runtime.failed, false);
      assert.equal(runtime.attaching, false);
      assert.equal(frames.size, 1);
      await App.patchSource(runtime, '(let count 99) (on render (context))');
      assert.notEqual(runtime.scene, previous);
      assert.equal(App.inspect(runtime).count, reference);
      assert.equal(App.read(runtime, reference), 7);
      assert.equal(frames.size, 1);
    } finally { AppCore.destroy(runtime); }
  });

  test(`failed module reload restores imports as well as the working scene (trace=${trace})`, async () => {
    let broken = false;
    const runtime = AppCore.new({ trace, baseURL: 'https://example.test/main.lisp', fetch: async url => ({
      ok: true, status: 200, text: async () => url.endsWith('/module.lisp')
        ? `(let value ${broken ? 0 : 2})`
        : '(let module (await (import "./module.lisp"))) (on render (context) (/ 1 module.value))',
    }) });
    runtime.graphics = {};
    runtime.services.graphics = { resetScene() {}, destroy() {}, render: (graphics, callback) => callback(Data.dict()) };
    runtime.requestFrame = () => 1;
    runtime.cancelFrame = () => {};
    try {
      await App.load(runtime, './main.lisp');
      const previous = runtime.scene, cache = runtime.modules.cache;
      broken = true;
      await assert.rejects(App.reloadModules(runtime), /finite number/);
      assert.equal(runtime.scene, previous);
      assert.equal(runtime.modules.cache, cache);
      assert.equal(runtime.failed, false);
      broken = false;
      await App.reloadModules(runtime);
      assert.notEqual(runtime.scene, previous);
      assert.notEqual(runtime.modules.cache, cache);
    } finally { AppCore.destroy(runtime); }
  });
}
