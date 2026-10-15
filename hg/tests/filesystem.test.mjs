import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import hg from '../../hg.js';
import { App, AppCore } from '../app.js';
import { Modules } from '../modules.js';
import { Data } from '../data.js';
import { Resources } from '../resources.js';

const sources = Object.fromEntries(['vfs', 'project'].map(name =>
  [`/editor/${name}.lisp`, readFileSync(new URL(`../../editor/${name}.lisp`, import.meta.url), 'utf8')]));
const file = (path, source) => ({ path, text: true, resource: Resources.fromText(source) });
const defaults = () => [file('/editor/main.lisp', '(on render (c))'),
  file('/project/main.lisp', '(on render (c))')];

async function harness(t, trace, fetchResource = Resources.fetch) {
  const records = new Map(), store = { version: 0 };
  let commits = 0;
  const app = AppCore.new({ trace, baseURL: 'https://repository.test/', fetch: async url => {
    const source = sources[new URL(url).pathname];
    return { ok: source !== undefined, status: source === undefined ? 404 : 200, text: async () => source };
  } });
  app.bindings.Storage = Data.registerHostData({
    async records() { return structuredClone(Object.fromEntries(records)); },
    async commit(target, version, operations) {
      assert.equal(target, store);
      if (version !== store.version) throw new Error('Stored project changed in another page');
      const next = new Map(records);
      for (const operation of operations) {
        if (operation.kind === 'put') next.set(operation.key, structuredClone(operation.value));
        else next.delete(operation.key);
      }
      records.clear(); for (const [key, value] of next) records.set(key, value);
      commits++; return ++store.version;
    },
  });
  app.bindings.Resources = Data.registerHostData({ ...Resources, fetch: fetchResource });
  app.graphics = {};
  app.services.graphics = { resetScene() {}, destroy() {}, render: (graphics, callback) => callback(Data.dict()) };
  app.requestFrame = () => 1; app.cancelFrame = () => {};
  const fsModule = await Modules.import(app.modules, './editor/vfs.lisp');
  const projectModule = await Modules.import(app.modules, './editor/project.lisp');
  const api = Data.get(fsModule, 'FileSystem'), project = Data.get(projectModule, 'Project');
  const fs = await Data.get(api, 'new')(store, 'https://assets.test/', 'vfs://test/');
  const call = (name, ...args) => Data.get(api, name)(fs, ...args);
  const path = (name, ...args) => Data.get(api, name)(...args);
  const operation = (name, ...args) => Data.get(project, name)(fs, ...args);
  t.after(() => AppCore.destroy(app));
  return { app, api, project, fs, store, records, call, path, operation, commits: () => commits };
}

test('the public runtime has one explicit filesystem attachment path', () => {
  assert.equal(Object.hasOwn(hg, 'Vfs'), false);
  assert.throws(() => App.new({ filesystem: {} }), /Unknown App option: filesystem/);
});

for (const trace of [true, false]) {
  test(`filesystem paths, revisions, queued writes, and subtree operations stay atomic (trace=${trace})`, async t => {
    const h = await harness(t, trace), { call, path, fs } = h;
    assert.equal(path('normalize', '/project/a/.././b'), '/project/b');
    assert.equal(path('join', '/project', 'café.lisp'), '/project/café.lisp');
    assert.equal(path('contains', '/project/a', '/project/ab'), false);
    assert.equal(path('rebase', '/project/a/file', '/project/a', '/project/b'), '/project/b/file');
    for (const invalid of ['relative', '/../escape', '/a\\b', '/a\n']) assert.throws(() => path('normalize', invalid));
    for (const invalid of ['', '.', '..', 'a/b']) assert.throws(() => path('join', '/', invalid));
    await call('mkdir', '/project'); await call('mkdir', '/project/folder');
    const writes = [call('writeText', '/project/folder/a.lisp', 'one', 0),
      call('writeText', '/project/folder/a.lisp', 'two', 1)];
    assert.deepEqual((await Promise.all(writes)).map(entry => entry.revision), [1, 2]);
    const version = fs.version;
    await assert.rejects(call('writeText', '/project/folder/a.lisp', 'stale', 1), /changed since/);
    assert.equal(fs.version, version);
    assert.equal(await call('readText', '/project/folder/a.lisp'), 'two');
    await call('writeBytes', '/project/folder/data.bin', [0, 128, 255], 'application/octet-stream', 0);
    await assert.rejects(call('move', '/project/folder', '/project/folder/child'), /Invalid move/);
    await assert.rejects(call('remove', '/project/folder'), /not empty/);
    assert.deepEqual(await call('readBytes', '/project/folder/data.bin'), [0, 128, 255]);
    await call('move', '/project/folder', '/project/renamed');
    assert.equal(call('stat', '/project/folder'), null);
    assert.equal(await call('readText', '/project/renamed/a.lisp'), 'two');
    assert.deepEqual(call('list', '/project/renamed').map(entry => entry.name), ['a.lisp', 'data.bin']);
    await assert.rejects(call('removeTree', '/'), /Cannot remove/);
    await call('removeTree', '/project/renamed');
    assert.deepEqual(call('list', '/project'), []);
    await call('mkdir', '/project/empty'); await call('remove', '/project/empty');
    assert.equal(call('stat', '/project/empty'), null);
  });

  test(`project creation, round trips, and replacement validate before a single commit (trace=${trace})`, async t => {
    const h = await harness(t, trace), { call, operation, fs, records } = h;
    await operation('create', [...defaults(), file('/project/readme.txt', 'hello'),
      { path: '/project/empty/nested', kind: 'directory' }]);
    assert.equal(h.commits(), 1);
    assert.equal(call('stat', '/project/empty/nested').kind, 'directory');
    const state = { editor: {}, project: { count: 12 }, tools: { bindings: { expanded: { saved: true } } } };
    const saved = await operation('snapshot', state);
    const source = JSON.parse(saved);
    assert.equal(source.files['/project/readme.txt'].data, 'hello');
    const generation = fs.project.generation;
    const invalid = structuredClone(source); delete invalid.files['/editor/main.lisp'];
    await assert.rejects(operation('open', JSON.stringify(invalid)), /requires editor/);
    assert.equal(h.commits(), 1);
    assert.equal(await call('readText', '/project/readme.txt'), 'hello');
    await call('writeText', '/project/readme.txt', 'edited', 1);
    await operation('open', saved);
    assert.equal(h.commits(), 3);
    assert.ok(fs.project.generation > generation);
    assert.equal(await call('readText', '/project/readme.txt'), 'hello');
    assert.deepEqual((await operation('restore', fs.project.state)).project, { count: 12 });
    const histories = [...records].filter(([key]) => key.startsWith('history:'));
    assert.ok(histories.some(([, history]) => history.contents['/project/readme.txt']?.data === 'edited'));
  });

  test(`migration rebases old files, keeps empty folders, and preserves customized editor sources (trace=${trace})`, async t => {
    const h = await harness(t, trace);
    const files = [file('/editor/main.lisp', '; custom editor\n(on render (c))'),
      file('/hg/ui.lisp', '; customized UI'), file('/notes.txt', 'legacy notes'),
      file('/editor-backups/previous.lisp', 'backup'), { path: '/empty', kind: 'directory' }];
    await h.operation('migrate', files, defaults());
    assert.equal(h.commits(), 1);
    assert.equal(await h.call('readText', '/editor/main.lisp'), '; custom editor\n(on render (c))');
    assert.equal(await h.call('readText', '/editor/ui.lisp'), '; customized UI');
    assert.equal(await h.call('readText', '/editor/backups/previous.lisp'), 'backup');
    assert.equal(await h.call('readText', '/project/legacy/notes.txt'), 'legacy notes');
    assert.equal(h.call('stat', '/project/legacy/empty').kind, 'directory');
    assert.equal(files[1].path, '/hg/ui.lisp');
    assert.equal(h.call('stat', '/project/main.lisp').text, true);
  });

  test(`filesystem conflicts and failed mutations preserve state and remain recoverable (trace=${trace})`, async t => {
    const h = await harness(t, trace);
    await h.operation('create', defaults());
    const stale = await Data.get(h.api, 'new')(h.store, h.fs.assetURL, h.fs.baseURL);
    await h.call('writeText', '/project/first.txt', 'first', 0);
    await assert.rejects(Data.get(h.api, 'writeText')(stale, '/project/stale.txt', 'stale', 0), /another page/);
    assert.equal(Data.get(h.api, 'stat')(stale, '/project/stale.txt'), null);
    await Data.get(h.api, 'refresh')(stale);
    await Data.get(h.api, 'writeText')(stale, '/project/second.txt', 'second', 0);
    await h.call('refresh');
    assert.equal(await h.call('readText', '/project/second.txt'), 'second');
    await h.operation('resetEditor', [file('/editor/main.lisp', '; replacement')]);
    const backup = Object.keys(h.fs.entries).find(path => path.endsWith('/main.lisp') && path.startsWith('/editor/backups/'));
    assert.equal(await h.call('readText', backup), '(on render (c))');
    assert.equal(await h.call('readText', '/editor/main.lisp'), '; replacement');
  });

  test(`resource fallback preserves an intervening write and the runtime uses the Lisp adapter (trace=${trace})`, async t => {
    let started, release;
    const requested = new Promise(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const h = await harness(t, trace, async url => {
      assert.equal(url, 'https://assets.test/project/fallback.txt'); started();
      await pending; return Resources.fromText('downloaded');
    });
    await h.operation('create', defaults());
    const fetched = h.call('fetch', 'vfs://test/project/fallback.txt', null);
    await requested;
    await h.call('writeText', '/project/fallback.txt', 'my edit', 0);
    release();
    assert.equal(Resources.text(await fetched), 'my edit');
    await h.call('writeText', '/project/module.lisp', '(let value 7)', 0);
    await h.call('writeText', '/project/main.lisp', '(let module (await (import "./module.lisp"))) (let value module.value) (on render (c))', 1);
    App.setFilesystem(h.app, h.fs, h.api);
    await App.load(h.app, h.call('url', '/project/main.lisp'));
    assert.equal(App.read(h.app, App.inspect(h.app).value), 7);
    assert.equal(App.exec(h.app, '(fs-stat "/project/fallback.txt")').revision, 1);
    assert.equal(App.exec(h.app, '(fs-parent "/project/fallback.txt")'), '/project');
    assert.throws(() => App.exec(h.app, '(fs-ready)'), /Unknown symbol/);
  });
}
