import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, AppCore } from '../app.js';
import { Data } from '../data.js';

function harness(t, trace) {
  const events = [], errors = [], frames = new Map();
  let nextFrame = 0;
  const entered = Promise.withResolvers(), gate = Promise.withResolvers();
  const app = AppCore.new({ trace, bindings: {
    record: value => events.push(value),
    entered: entered.resolve,
    gate: gate.promise,
  }, onError: error => errors.push(error) });
  app.graphics = {};
  app.services.graphics = {
    render: (graphics, callback) => callback(Data.dict()),
    resetScene() {}, destroy() {},
  };
  app.requestFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  app.cancelFrame = id => frames.delete(id);
  t.after(() => App.dispose(app));
  return { app, events, errors, frames, entered: entered.promise, gate };
}

const original = `(let count 7)
  (on attach () (record "old attach"))
  (on detach () (record "old detach"))
  (on render (c))`;
const pendingAttach = `(on attach (async (fn ()
  (record "candidate attach") (entered) (await gate))))
  (on detach () (record "candidate detach"))
  (on render (c) (record "candidate render"))`;

for (const trace of [true, false]) {
  for (const operation of ['loadSource', 'patchSource']) {
    test(`${operation} supersedes a pending URL patch without executing stale source (trace=${trace})`, async t => {
      const { app, events } = harness(t, trace);
      const reading = Promise.withResolvers(), response = Promise.withResolvers();
      await App.loadSource(app, original, { sourceURL: 'https://example.test/editor/main.lisp' });
      const reference = App.inspect(app).count;
      app.modules.fetch = async url => {
        assert.equal(url, 'https://example.test/editor/slow.lisp');
        reading.resolve();
        return { ok: true, text: () => response.promise };
      };
      const pending = App.patch(app, './slow.lisp');
      await reading.promise;
      await App[operation](app, '(let count 99) (on render (c))');
      const replacement = app.scene;
      const patch = operation === 'patchSource';
      assert.equal(App.read(app, App.inspect(app).count), patch ? 7 : 99);
      if (patch) assert.equal(App.inspect(app).count, reference);
      else assert.throws(() => App.read(app, reference), /no longer valid/);
      response.resolve('(record "stale source executed") (let count 0) (on render (c))');
      assert.equal(await pending, app);
      assert.equal(app.scene, replacement);
      assert.equal(app.sourceURL, 'https://example.test/editor/main.lisp');
      assert.equal(events.includes('stale source executed'), false);
    });
  }

  test(`injected code shares struct definitions and mutable bindings across patches (trace=${trace})`, async t => {
    const { app } = harness(t, trace);
    await App.loadSource(app, '(struct Point x:f32) (let count 7) (on render (c))');
    const references = App.inspect(app);
    assert.equal(Data.get(App.exec(app, '(Point x count)'), 'x'), 7);
    assert.throws(() => App.write(app, references.Point, () => null), /Cannot reassign/);
    App.write(app, references.count, 12);
    App.exec(app, '(let point (Point x count))');
    const point = App.inspect(app).point;
    assert.equal(Data.get(App.read(app, point), 'x'), 12);
    await App.patchSource(app, '(struct Point x:f32) (let count 99) (let point (Point x 0)) (on render (c))');
    assert.equal(App.inspect(app).point, point);
    assert.equal(Data.get(App.read(app, point), 'x'), 12);
    assert.equal(Data.get(App.exec(app, '(Point x count)'), 'x'), 12);
    assert.throws(() => App.exec(app, '(set Point nil)'), /Cannot reassign struct/);
  });

  test(`a newer syntax failure cancels pending attach and stale rejection cannot damage rollback (trace=${trace})`, async t => {
    const { app, events, errors, frames, entered, gate } = harness(t, trace);
    await App.loadSource(app, original);
    const previous = app.scene, reference = App.inspect(app).count;
    events.length = 0;
    const pending = App.loadSource(app, pendingAttach);
    await entered;
    assert.equal(app.scene, previous);
    assert.equal(app.attaching, true);
    assert.equal(frames.size, 0);
    await assert.rejects(App.loadSource(app, '(let broken'), { name: 'SyntaxError' });
    assert.deepEqual(events, ['candidate attach', 'candidate detach', 'old detach', 'old attach']);
    gate.reject(new Error('stale attach failure'));
    await pending;
    assert.equal(app.scene, previous);
    assert.equal(App.read(app, reference), 7);
    assert.equal(app.source, original);
    assert.equal(app.attaching, false);
    assert.equal(app.failed, false);
    assert.equal(frames.size, 1);
    assert.deepEqual(errors, []);
    assert.equal(events.filter(event => event === 'candidate detach').length, 1);
  });

  test(`failed asynchronous patch initialization uses the same rollback as attachment (trace=${trace})`, async t => {
    const { app, events, errors, frames, entered, gate } = harness(t, trace);
    await App.loadSource(app, original);
    const previous = app.scene, reference = App.inspect(app).count;
    events.length = 0;
    const pending = App.patchSource(app, '(let count 99) (entered) (await gate) (on render (c))');
    await entered;
    assert.equal(app.attaching, true);
    assert.equal(frames.size, 0);
    gate.reject(new Error('initialization failed'));
    await assert.rejects(pending, /initialization failed/);
    assert.equal(app.scene, previous);
    assert.equal(App.inspect(app).count, reference);
    assert.equal(App.read(app, reference), 7);
    assert.equal(app.source, original);
    assert.equal(app.attaching, false);
    assert.equal(app.reloadPreparation, null);
    assert.equal(frames.size, 1);
    assert.deepEqual(events, ['old detach', 'old attach']);
    assert.deepEqual(errors, []);
  });

  test(`synchronous and asynchronous attach failures restore the committed scene (trace=${trace})`, async t => {
    const { app, events, errors, frames, entered, gate } = harness(t, trace);
    app.bindings.fail = () => { throw new Error('attach failed'); };
    await App.loadSource(app, original);
    const previous = app.scene, reference = App.inspect(app).count;
    events.length = 0;
    await assert.rejects(App.loadSource(app, `(on attach () (fail))
      (on detach () (record "candidate detach")) (on render (c))`), /attach failed/);
    const pending = App.loadSource(app, pendingAttach);
    await entered;
    gate.reject(new Error('async attach failed'));
    await assert.rejects(pending, /async attach failed/);
    assert.equal(app.scene, previous);
    assert.equal(App.read(app, reference), 7);
    assert.equal(app.attaching, false);
    assert.equal(app.failed, false);
    assert.equal(frames.size, 1);
    assert.deepEqual(events, ['candidate detach', 'old detach', 'old attach',
      'candidate attach', 'candidate detach', 'old detach', 'old attach']);
    assert.deepEqual(errors, []);
  });

  test(`fresh initialization keeps the active scene running and superseded results never attach (trace=${trace})`, async t => {
    const { app, events, errors, frames, entered, gate } = harness(t, trace);
    await App.loadSource(app, original);
    events.length = 0;
    const pending = App.loadSource(app, `(entered) (await gate)
      (on attach () (record "stale attach")) (on render (c))`);
    await entered;
    assert.equal(app.attaching, false);
    assert.equal(frames.size, 1);
    await App.loadSource(app, '(on attach () (record "replacement attach")) (on render (c))');
    const replacement = app.scene;
    gate.resolve(null);
    await pending;
    assert.equal(app.scene, replacement);
    assert.deepEqual(events, ['replacement attach', 'old detach']);
    assert.equal(frames.size, 1);
    assert.deepEqual(errors, []);
  });

  for (const operation of ['dispose', 'abandon']) {
    test(`${operation} during attach releases the candidate once and prevents later callbacks (trace=${trace})`, async t => {
      const { app, events, errors, frames, entered, gate } = harness(t, trace);
      await App.loadSource(app, original);
      const reference = App.inspect(app).count;
      const pending = App.loadSource(app, pendingAttach);
      await entered;
      events.length = 0;
      App[operation](app);
      assert.deepEqual(events, operation === 'dispose' ? ['candidate detach', 'old detach'] : []);
      gate.reject(new Error('attach finished after destruction'));
      await pending;
      assert.equal(app.scene, null);
      assert.equal(frames.size, 0);
      assert.equal(app.reloadPreparation, null);
      assert.throws(() => App.read(app, reference));
      assert.deepEqual(errors, []);
      assert.deepEqual(events, operation === 'dispose' ? ['candidate detach', 'old detach'] : []);
    });
  }

  test(`prepared scene commits once and preserves explicit pause and binding lifetimes (trace=${trace})`, async t => {
    const { app, events, frames, entered, gate } = harness(t, trace);
    await App.loadSource(app, original);
    const oldReference = App.inspect(app).count;
    App.pause(app);
    const pending = App.patchSource(app, `(let count 99) ${pendingAttach}`);
    await entered;
    gate.resolve(null);
    await pending;
    assert.equal(App.inspect(app).count, oldReference);
    assert.equal(App.read(app, oldReference), 7);
    assert.equal(app.attaching, false);
    assert.equal(app.paused, true);
    assert.equal(frames.size, 0);
    assert.equal(events.filter(event => event === 'candidate attach').length, 1);
    await App.loadSource(app, '(let count 1) (on render (c))');
    assert.throws(() => App.read(app, oldReference), /no longer valid/);
    assert.notEqual(App.inspect(app).count, oldReference);
    assert.equal(App.read(app, App.inspect(app).count), 1);
    assert.equal(frames.size, 0);
    App.start(app);
    assert.equal(frames.size, 1);
  });

  test(`disposal inside the outgoing detach hook cannot install a scene afterward (trace=${trace})`, async t => {
    const { app, events, frames } = harness(t, trace);
    app.bindings.dispose = () => App.dispose(app);
    await App.loadSource(app, '(on detach () (dispose)) (on render (c))');
    await App.loadSource(app, `(on attach () (record "candidate attach"))
      (on detach () (record "candidate detach")) (on render (c))`);
    assert.equal(app.destroyed, true);
    assert.equal(app.scene, null);
    assert.equal(frames.size, 0);
    assert.deepEqual(events, ['candidate attach', 'candidate detach']);
  });
}
