import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import hg from '../../hg.js';
import { App, AppCore } from '../app.js';
import { Modules } from '../modules.js';
import { Data } from '../data.js';
import { Resources } from '../resources.js';

const sources = Object.fromEntries(['vfs', 'project', 'buffer'].map(name =>
  [`/editor/${name}.lisp`, readFileSync(new URL(`../../editor/${name}.lisp`, import.meta.url), 'utf8')]));
const file = (path, source) => ({ path, text: true, resource: Resources.fromText(source) });
const defaults = () => [file('/editor/main.lisp', '(on render (c))'),
  file('/project/main.lisp', '(on render (c))')];

async function harness(t, trace, fetchResource = Resources.fetch) {
  const records = new Map(), sessions = new Map(), store = { version: 0 };
  let commits = 0;
  const app = AppCore.new({ trace, baseURL: 'https://repository.test/', fetch: async url => {
    const source = sources[new URL(url).pathname];
    return { ok: source !== undefined, status: source === undefined ? 404 : 200, text: async () => source };
  } });
  app.bindings.Storage = Data.registerHostData({
    readSession(target, key) { assert.equal(target, store); return sessions.get(key) ?? null; },
    writeSession(target, key, value) { assert.equal(target, store); sessions.set(key, value); },
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
  const fs = await Data.get(api, 'new')(store, 'https://repository.test/', 'vfs://test/');
  const call = (name, ...args) => Data.get(api, name)(fs, ...args);
  const path = (name, ...args) => Data.get(api, name)(...args);
  const operation = (name, ...args) => Data.get(project, name)(fs, ...args);
  t.after(() => AppCore.destroy(app));
  return { app, api, project, fs, store, records, sessions, call, path, operation, commits: () => commits };
}

test('the public runtime has one explicit filesystem attachment path', () => {
  assert.equal(Object.hasOwn(hg, 'Vfs'), false);
  assert.throws(() => App.new({ filesystem: {} }), /Unknown App option: filesystem/);
});

for (const trace of [true, false]) {
  test(`file transfers preserve root files, nested and empty folders, text, and binary data (trace=${trace})`, async t => {
    const h = await harness(t, trace);
    await h.operation('create', defaults());
    const entries = [
      { path: 'Assets', kind: 'directory' }, { path: 'Assets/empty', kind: 'directory' },
      { path: 'Assets/café #👋.txt', kind: 'file', resource: Resources.fromText('Hello 👋\n') },
      { path: 'Assets/nested/data.bin', kind: 'file', resource: Resources.fromBytes([0, 128, 255]) },
      { path: 'root.lisp', kind: 'file', resource: Resources.fromBytes([...new TextEncoder().encode('; root file')]) },
    ];
    const before = h.commits();
    assert.deepEqual(await h.call('importFiles', '/', entries), entries.map(entry => `/${entry.path}`));
    assert.equal(h.commits(), before + 1);
    assert.equal(h.call('stat', '/root.lisp').text, true);
    assert.equal(await h.call('readText', '/root.lisp'), '; root file');
    assert.equal(await h.call('readText', '/Assets/café #👋.txt'), 'Hello 👋\n');
    assert.deepEqual(await h.call('readBytes', '/Assets/nested/data.bin'), [0, 128, 255]);
    assert.equal(h.call('stat', '/Assets/empty').kind, 'directory');
    const exported = await h.call('exportFiles', '/Assets');
    assert.deepEqual(exported.map(entry => entry.path),
      ['Assets', 'Assets/café #👋.txt', 'Assets/empty', 'Assets/nested', 'Assets/nested/data.bin']);
    await h.call('importFiles', '/project', exported);
    assert.deepEqual(await h.call('readBytes', '/project/Assets/nested/data.bin'), [0, 128, 255]);
    assert.equal(h.call('stat', '/project/Assets/empty').kind, 'directory');
    assert.deepEqual((await h.call('exportFiles', '/root.lisp')).map(entry => entry.path), ['root.lisp']);
    const whole = await h.call('exportFiles', '/');
    assert.equal(whole[0].path, 'files');
    assert.ok(whole.some(entry => entry.path === 'files/Assets/empty' && entry.kind === 'directory'));
    assert.ok(whole.some(entry => entry.path === 'files/root.lisp' && entry.kind === 'file'));
    await assert.rejects(h.call('exportFiles', '/absent'), /does not exist/);
    const source = await h.operation('snapshot', { editor: {} });
    await h.operation('open', source);
    assert.equal(await h.call('readText', '/root.lisp'), '; root file');
    assert.deepEqual(await h.call('readBytes', '/Assets/nested/data.bin'), [0, 128, 255]);
    assert.equal(h.call('stat', '/Assets/empty').kind, 'directory');
  });

  test(`imports reject conflicts, invalid paths, and failed storage without partial changes (trace=${trace})`, async t => {
    const h = await harness(t, trace);
    await h.operation('create', defaults());
    const entry = path => ({ path, kind: 'file', resource: Resources.fromText('imported') });
    const before = h.fs.version;
    for (const path of ['', '/absolute.txt', '../escape', 'a/../b', 'a//b', 'a\\b', './file', 'bad\nname']) {
      await assert.rejects(h.call('importFiles', '/', [entry('first.txt'), entry(path)]));
      assert.equal(h.call('stat', '/first.txt'), null);
    }
    await assert.rejects(h.call('importFiles', '/project', [entry('first.txt'), entry('main.lisp')]), /already exists/);
    await assert.rejects(h.call('importFiles', '/', [entry('first.txt'), entry('first.txt')]), /Duplicate/);
    await assert.rejects(h.call('importFiles', '/', [{ path: 'editor/main.lisp', kind: 'directory' }]), /Not a directory/);
    await assert.rejects(h.call('importFiles', '/missing', [entry('first.txt')]), /existing folder/);
    await assert.rejects(h.call('importFiles', '/', [entry('first.txt'), {
      path: 'bad.txt', kind: 'file', resource: Resources.fromBytes([255]),
    }]));
    h.store.version++;
    await assert.rejects(h.call('importFiles', '/', [entry('first.txt')]), /another page/);
    h.store.version--;
    assert.equal(h.fs.version, before);
    assert.equal(h.call('stat', '/first.txt'), null);
    assert.equal(h.call('stat', '/project/first.txt'), null);
    assert.equal(await h.call('readText', '/project/main.lisp'), '(on render (c))');
    await h.call('importFiles', '/', [entry('first.txt')]);
    assert.equal(await h.call('readText', '/first.txt'), 'imported');
  });

  test(`app settings validate, commit atomically, round trip, and retain local fallback (trace=${trace})`, async t => {
    const requested = [];
    const h = await harness(t, trace, async url => { requested.push(url); return Resources.fromText('downloaded'); });
    await h.operation('create', [...defaults(), file('/project/other.lisp', '(on render (c))')]);
    await h.call('writeBytes', '/project/data.bin', [1], 'application/octet-stream', 0);
    const previous = structuredClone(h.fs.project), version = h.fs.version;
    for (const entry of ['/editor/main.lisp', '/project/missing.lisp', '/project', '/project/data.bin',
      '/project/../project/other.lisp', 'project/other.lisp']) {
      await assert.rejects(h.operation('configure', { entry }));
    }
    for (const app of [{ w: 0 }, { h: -1 }, { w: 1.5 }, { w: 2 ** 53 }, { h: '100' },
      { si: -1 }, { si: false }, { is: 'true' }, { ups: 0 }, { ups: 1e-320 }, { ups: null },
      { ups: Infinity }, { trace: 1 }, { unexpected: 1 }]) {
      await assert.rejects(h.operation('configure', { entry: '/project/other.lisp', app }));
    }
    assert.equal(h.fs.version, version);
    assert.deepEqual(h.fs.project, previous);
    const settings = { entry: '/project/other.lisp', app: { w: 320, h: 180, si: 0.5, is: true, ups: 30, trace: false } };
    // A storage conflict leaves both the active configuration and durable metadata intact.
    h.store.version++;
    await assert.rejects(h.operation('configure', settings), /another page/);
    assert.deepEqual(h.fs.project, previous);
    assert.deepEqual(h.records.get('project'), previous);
    h.store.version--;
    const metadata = await h.operation('configure', settings);
    assert.equal(h.fs.version, version + 1);
    assert.equal(metadata.generation, previous.generation);
    assert.equal(metadata.entry, '/project/other.lisp');
    assert.deepEqual(metadata.app, settings.app);
    assert.deepEqual(h.records.get('project'), metadata);
    await h.call('fetch', 'vfs://test/project/main.lisp', null);
    assert.deepEqual(requested, []);
    assert.equal(Resources.text(await h.call('fetch', 'vfs://test/project/image.txt', null)), 'downloaded');
    assert.deepEqual(requested, ['https://repository.test/project/image.txt']);
    await h.call('fetch', 'vfs://test/project/image.txt', null);
    assert.equal(requested.length, 1);
    await h.operation('saveState', { editor: {}, project: { count: 7 } });
    const snapshot = JSON.parse(await h.operation('snapshot', { editor: {} }));
    assert.equal(snapshot.entry, metadata.entry);
    assert.deepEqual(snapshot.app, settings.app);
    assert.equal(Object.hasOwn(snapshot, 'assetURL'), false);
    // Legacy remote URLs are ignored on import, even if malformed.
    snapshot.assetURL = 'not a usable URL';
    await h.operation('open', JSON.stringify(snapshot));
    assert.equal(h.fs.project.entry, metadata.entry);
    assert.deepEqual(h.fs.project.app, settings.app);
    assert.equal(Object.hasOwn(h.fs.project, 'assetURL'), false);
    await h.call('fetch', 'vfs://test/project/another.txt', null);
    assert.equal(requested.at(-1), 'https://repository.test/project/another.txt');
    delete snapshot.app;
    await h.operation('open', JSON.stringify(snapshot));
    assert.deepEqual(h.fs.project.app, { w: null, h: null, si: null, is: false, ups: 60, trace: null });
  });

  test(`settings preserve tab checkpoints while replacing a project invalidates them (trace=${trace})`, async t => {
    const h = await harness(t, trace);
    await h.operation('create', [...defaults(), file('/project/other.lisp', '(on render (c))')]);
    const session = Data.get(h.project, 'newSession')(h.store, h.fs);
    const checkpoint = saved => Data.get(h.project, 'checkpoint')(session, saved);
    const restore = () => Data.get(h.project, 'sessionState')(h.store, h.fs);
    const saved = { editor: { buffer: { draft: '; unsaved' } } };
    assert.equal(checkpoint(saved), true);
    const legacy = JSON.parse(h.sessions.get('editor-state'));
    legacy.identity.push(h.fs.project.entry, 'https://legacy-assets.test/');
    h.sessions.set('editor-state', JSON.stringify(legacy));
    await h.operation('configure', { entry: '/project/other.lisp', app: { w: 320 } });
    assert.deepEqual(await restore(), saved);
    saved.editor.buffer.draft = '; still saving after settings changed';
    assert.equal(checkpoint(saved), true);
    assert.deepEqual(await restore(), saved);
    await h.operation('create', defaults());
    assert.equal(checkpoint({ editor: {} }), false);
    assert.equal(await restore(), null);
  });

  test(`saving project state preserves metadata for repeated exports and restoration (trace=${trace})`, async t => {
    const h = await harness(t, trace);
    await h.operation('create', defaults());
    const state = { editor: { path: '/project/main.lisp' }, project: { count: 42 } };
    for (let save = 0; save < 2; save++) {
      const metadata = await h.operation('saveState', state);
      assert.equal(h.fs.project, metadata);
      assert.equal(metadata.entry, '/project/main.lisp');
      assert.deepEqual(h.records.get('project'), metadata);
      const snapshot = JSON.parse(await h.operation('snapshot', state));
      assert.equal(snapshot.entry, '/project/main.lisp');
      assert.deepEqual(snapshot.state.project, { count: 42 });
      await h.operation('open', JSON.stringify(snapshot));
      assert.deepEqual((await h.operation('restore', h.fs.project.state)).project, { count: 42 });
    }
    const report = await h.operation('resetEditor', [file('/editor/main.lisp', '; updated editor')]);
    assert.deepEqual(report.updated, ['/editor/main.lisp']);
    assert.match(report.backup, /^\/editor\/backups\//);
    assert.equal(await h.call('readText', `${report.backup}/main.lisp`), '(on render (c))');
  });

  test(`filesystem mutations return their committed entries and paths (trace=${trace})`, async t => {
    const h = await harness(t, trace);
    await h.operation('create', defaults());
    const folder = await h.call('mkdir', '/project/folder');
    assert.equal(folder.path, '/project/folder');
    assert.equal(folder.kind, 'directory');
    const moved = await h.call('move', '/project/folder', '/project/renamed');
    assert.equal(moved.path, '/project/renamed');
    assert.equal(await h.call('remove', '/project/renamed'), '/project/renamed');
    assert.equal(h.call('stat', '/project/renamed'), null);
  });

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
    const invalidApp = structuredClone(source); invalidApp.app = { w: 0 };
    await assert.rejects(operation('open', JSON.stringify(invalidApp)), /positive integer/);
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
    const stale = await Data.get(h.api, 'new')(h.store, h.fs.localURL, h.fs.baseURL);
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
      assert.equal(url, 'https://repository.test/project/fallback.txt'); started();
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
