import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

async function expose(page) {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    window.legacyOpens = 0;
    indexedDB.open = (name, ...args) => {
      if (name === 'hg-vfs:mercury') legacyOpens++;
      return open(name, ...args);
    };
  });
  await page.route('**/index.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('host.app = app;', 'host.app = app; window.filesystemTestApp = app;') });
  });
}
async function ready(page) {
  await page.locator('#host-loading').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#host-error').isVisible(), false, await page.locator('#host-diagnostic').textContent());
  await page.waitForFunction(() => window.filesystemTestApp?.scene && !filesystemTestApp.attaching);
}

test('fresh startup creates only the current store and uses atomic Lisp transactions', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await expose(page); await page.goto(baseURL); await ready(page);
    assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'hg-vfs:mercury')), false);
    const result = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js'), { Data } = await import('/hg/data.js');
      const app = filesystemTestApp, refs = App.inspect(app), fs = app.filesystem;
      const Project = App.read(app, refs.Project), api = app.__filesystemApi__;
      const invoke = (namespace, name, ...args) => Data.get(namespace, name)(...args);
      const saved = await invoke(Project, 'snapshot', fs, app.state);
      const invalid = JSON.parse(saved); delete invalid.files['/editor/main.lisp'];
      const version = fs.version;
      let invalidError;
      try { await invoke(Project, 'open', fs, JSON.stringify(invalid)); } catch (error) { invalidError = error.message; }
      const invalidVersion = fs.version;
      const stale = await invoke(api, 'new', fs.storage, fs.localURL, fs.baseURL);
      await invoke(api, 'writeText', fs, '/project/current.txt', 'current', 0);
      let conflict;
      try { await invoke(api, 'writeText', stale, '/project/stale.txt', 'stale', 0); } catch (error) { conflict = error.message; }
      const absent = invoke(api, 'stat', stale, '/project/stale.txt') === null;
      await invoke(api, 'refresh', stale);
      const current = await invoke(api, 'readText', stale, '/project/current.txt');
      const beforeOpen = fs.version;
      await invoke(Project, 'open', fs, saved);
      const records = await app.bindings.Storage.records(fs.storage);
      return { invalidError, unchanged: version === invalidVersion, conflict, absent, current,
        commits: fs.version - beforeOpen, removed: invoke(api, 'stat', fs, '/project/current.txt') === null,
        history: Object.keys(records).some(key => key.startsWith('history:') && records[key].contents['/project/current.txt']) };
    });
    assert.match(result.invalidError, /requires editor/);
    assert.match(result.conflict, /another page/);
    assert.deepEqual({ ...result, invalidError: undefined, conflict: undefined },
      { invalidError: undefined, conflict: undefined, unchanged: true, absent: true, current: 'current', commits: 1, removed: true, history: true });
  } finally { await browser.close(); }
});

test('the read-only legacy importer preserves binary files, customized editors, empty folders, and the original database', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await expose(page);
    await page.goto(new URL('/hg/tests/browser.html', baseURL).href);
    const original = await page.evaluate(async () => {
      const main = (await (await fetch('/editor/main.lisp')).text()) + '\n; saved custom editor';
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('hg-vfs:mercury', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('entries', { keyPath: 'path' });
          request.result.createObjectStore('contents'); request.result.createObjectStore('meta');
        };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = database.transaction(['entries', 'contents', 'meta'], 'readwrite');
          const entries = tx.objectStore('entries'), contents = tx.objectStore('contents');
          for (const path of ['/', '/editor', '/project', '/empty', '/editor-backups'])
            entries.put({ path, name: path.split('/').at(-1), kind: 'directory', revision: 1, modified: 1, size: 0 });
          for (const [path, value, text] of [['/editor/main.lisp', main, true], ['/notes.txt', 'café notes', true],
            ['/project/pixels.bin', new Uint8Array([0, 128, 255]), false], ['/editor-backups/old.lisp', '; backup', true]]) {
            const mime = text ? 'text/plain;charset=utf-8' : 'application/octet-stream';
            const blob = new Blob([value], { type: mime }); contents.put(blob, path);
            entries.put({ path, name: path.split('/').at(-1), kind: 'file', revision: 3, modified: 123, size: blob.size, text, mime });
          }
          tx.objectStore('meta').put('untouched', 'sentinel');
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
      } finally { database.close(); }
      return main;
    });
    await page.goto(baseURL); await ready(page);
    assert.deepEqual(await page.evaluate(async () => {
      const { Data } = await import('/hg/data.js');
      const app = filesystemTestApp, fs = app.filesystem, api = app.__filesystemApi__;
      return { source: await Data.get(api, 'readText')(fs, '/editor/main.lisp'),
        notes: await Data.get(api, 'readText')(fs, '/project/legacy/notes.txt'),
        bytes: await Data.get(api, 'readBytes')(fs, '/project/pixels.bin'),
        backup: await Data.get(api, 'readText')(fs, '/editor/backups/old.lisp'),
        empty: Data.get(api, 'stat')(fs, '/project/legacy/empty').kind };
    }), { source: original.replaceAll('"../hg/ui.lisp"', '"./ui.lisp"'), notes: 'café notes',
      bytes: [0, 128, 255], backup: '; backup', empty: 'directory' });
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => legacyOpens), 0);
    const legacy = await page.evaluate(async () => {
      const database = await new Promise(resolve => { const request = indexedDB.open('hg-vfs:mercury'); request.onsuccess = () => resolve(request.result); });
      try {
        const values = await new Promise((resolve, reject) => {
          const tx = database.transaction(['entries', 'contents', 'meta']);
          const entry = tx.objectStore('entries').get('/editor/main.lisp'), main = tx.objectStore('contents').get('/editor/main.lisp');
          const sentinel = tx.objectStore('meta').get('sentinel'), empty = tx.objectStore('entries').get('/empty');
          tx.oncomplete = () => resolve({ entry: entry.result, main: main.result, sentinel: sentinel.result, empty: empty.result });
          tx.onabort = () => reject(tx.error);
        });
        return { revision: values.entry.revision, modified: values.entry.modified,
          source: await values.main.text(), sentinel: values.sentinel, empty: values.empty.path };
      } finally { database.close(); }
    });
    assert.deepEqual(legacy, { revision: 3, modified: 123, source: original, sentinel: 'untouched', empty: '/empty' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
