import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

async function ready(page) {
  await page.waitForFunction(() => window.defaultsTestApp?.__reflection__?.scene &&
    !defaultsTestApp.attaching && document.querySelector('#host-loading').hidden);
  assert.equal(await page.locator('#host-error').isVisible(), false,
    await page.locator('#host-diagnostic').textContent());
}
async function inspect(page) {
  return page.evaluate(async () => {
    const { App } = await import('/hg/app.js'), app = defaultsTestApp;
    return { version: App.exec(app, 'defaults-test-version'), mode: app.state['editor-mode'],
      files: Object.keys(app.filesystem.entries), generation: app.filesystem.project.generation,
      main: await App.exec(app, '(fs-read-text "/editor/main.lisp")'),
      starter: await App.exec(app, '(fs-read-text "/project/main.lisp")') };
  });
}

test('New project, F2 recovery, and Restore fetch the current manifest and files without a page reload', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let revision = 'A', unavailable = false, manifests = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));
    await page.addInitScript(() => {
      const original = window.fetch;
      window.defaultFetches = [];
      window.fetch = (url, options) => {
        defaultFetches.push({ path: new URL(url, location.href).pathname, cache: options?.cache });
        return original(url, options);
      };
    });
    await page.route('**/index.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text())
        .replace('host.app = app;', 'host.app = app; window.defaultsTestApp = app;') });
    });
    await page.route('**/hg/vfs-seed.generated.json', async route => {
      manifests++;
      const current = revision, response = await route.fetch();
      const files = JSON.parse(await response.text());
      files.push({ path: `/editor/defaults-revision-${current}.lisp`,
        source: `../editor/defaults-revision-${current}.lisp`, text: true, mime: 'text/plain;charset=utf-8' });
      await route.fulfill({ response, body: JSON.stringify(files) });
    });
    await page.route('**/editor/defaults-revision-*.lisp', route => {
      const current = new URL(route.request().url()).pathname.includes(`-${revision}.lisp`);
      return route.fulfill({ status: current ? (unavailable ? 503 : 200) : 404,
        contentType: 'text/plain', body: `(let revision "${revision}")` });
    });
    await page.route('**/editor/main.lisp', async route => {
      const current = revision, response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}
(let defaults-test-module (await (import "./defaults-revision-${current}.lisp")))
(let defaults-test-version defaults-test-module.revision)
` });
    });
    await page.route('**/project/main.lisp', async route => {
      const current = revision, response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\n; starter ${current}\n` });
    });
    await page.goto(baseURL); await ready(page);
    assert.equal((await inspect(page)).version, 'A');
    const action = async name => {
      await page.evaluate(async name => {
        const { App } = await import('/hg/app.js');
        await App.exec(defaultsTestApp, `(${name})`);
      }, name);
      await ready(page);
    };

    let before = manifests;
    revision = 'B'; await action('new-project');
    assert.ok(manifests > before);
    const fresh = await inspect(page);
    assert.equal(fresh.version, 'B'); assert.equal(fresh.mode, 'saved');
    assert.match(fresh.starter, /; starter B/);
    assert.ok(fresh.files.includes('/editor/defaults-revision-B.lisp'));
    assert.equal(fresh.files.includes('/editor/defaults-revision-A.lisp'), false);
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      await App.exec(defaultsTestApp, '(fs-write-text "/project/keep.txt" "keep my files" nil)');
    });

    before = manifests;
    revision = 'C'; await page.keyboard.press('F2'); await ready(page);
    assert.ok(manifests > before);
    const recovery = await inspect(page);
    assert.equal(recovery.version, 'C'); assert.equal(recovery.mode, 'recovery');
    // Recovery runs fresh repository modules without replacing the working editor or starter.
    assert.equal(recovery.main, fresh.main); assert.equal(recovery.starter, fresh.starter);
    assert.equal(recovery.files.includes('/editor/defaults-revision-C.lisp'), false);

    before = manifests;
    revision = 'D'; await action('update-editor-bundle');
    assert.ok(manifests > before);
    const restored = await inspect(page);
    assert.equal(restored.version, 'D'); assert.equal(restored.mode, 'saved');
    assert.match(restored.main, /defaults-revision-D/); assert.equal(restored.starter, fresh.starter);
    assert.ok(restored.files.includes('/editor/defaults-revision-D.lisp'));
    assert.equal(restored.files.includes('/editor/defaults-revision-B.lisp'), false);
    assert.equal(await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      return App.exec(defaultsTestApp, '(fs-read-text "/project/keep.txt")');
    }), 'keep my files');

    // A failed fresh download must not silently install the cached D bundle.
    revision = 'E'; unavailable = true;
    for (const name of ['new-project', 'update-editor-bundle']) {
      before = manifests;
      const failed = await page.evaluate(async name => {
        const { App } = await import('/hg/app.js'), app = defaultsTestApp;
        return { result: await App.exec(app, `(${name})`), error: app.state.editor.error,
          reloading: app.state.editor.reloading, failed: app.failed };
      }, name);
      assert.deepEqual(failed, { result: false,
        error: 'Unable to fetch default /editor/defaults-revision-E.lisp: HTTP 503', reloading: false, failed: false });
      assert.ok(manifests > before);
      const unchanged = await inspect(page);
      assert.equal(unchanged.version, 'D'); assert.equal(unchanged.generation, restored.generation);
      assert.equal(unchanged.main, restored.main); assert.deepEqual(unchanged.files, restored.files);
    }
    // Recovery may use the last complete bundle when downloads fail, never partial E files.
    before = manifests;
    await page.keyboard.press('F2'); await ready(page);
    assert.ok(manifests > before);
    assert.equal((await inspect(page)).version, 'D');
    assert.match(await page.evaluate(() => defaultsTestApp.state.editor.error), /Using cached defaults:.*HTTP 503/);
    unavailable = false;
    await page.keyboard.press('F2'); await ready(page);
    assert.equal((await inspect(page)).version, 'E');
    assert.equal(await page.evaluate(() => defaultsTestApp.state.editor.error), '');
    const requests = await page.evaluate(() => defaultFetches.filter(request =>
      ['/hg/vfs-seed.generated.json', '/editor/main.lisp', '/hg/ui.lisp', '/project/main.lisp'].includes(request.path)));
    assert.ok(requests.length > 20);
    assert.ok(requests.every(request => request.cache === 'no-store'));
    assert.deepEqual(uncaught, []);
    assert.equal(await page.locator('#host-error').isVisible(), false);
  } finally { await browser.close(); }
});
