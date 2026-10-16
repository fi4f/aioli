import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = new URL('/index.html', process.env.AIOLI_URL || 'http://localhost:3000').href;

test('loading status paints before the host module arrives and leaves a rendered editor', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/index.js', async route => {
      await pending;
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('host.app = app;', 'host.app = app; window.startupTestApp = app;') });
    });
    await page.goto(url, { waitUntil: 'commit' });
    await page.locator('#host-loading').waitFor({ state: 'visible' });
    await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
    assert.match(await page.locator('#host-loading').textContent(), /Loading editor/);
    assert.equal(await page.locator('#canvas').getAttribute('aria-busy'), 'true');
    assert.equal(await page.evaluate(() => window.startupTestApp), undefined);
    release();
    await page.locator('#host-loading').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#canvas').getAttribute('aria-busy'), 'false');
    assert.deepEqual(await page.evaluate(() => [!!startupTestApp.scene, startupTestApp.failed,
      startupTestApp.outerCanvas.getContext('2d').getImageData(10, 10, 1, 1).data[3]]), [true, false, 255]);
    assert.deepEqual(errors, []);
  } finally { release(); await browser.close(); }
});

test('startup reuses downloaded defaults and cached recovery survives unavailable editor files', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const requests = [], errors = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#host-loading').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#host-error').isVisible(), false);
    for (const file of ['vfs', 'project'])
      assert.equal(requests.filter(path => path === `/editor/${file}.lisp`).length, 1);
    assert.equal(requests.filter(path => path === '/editor/bootstrap.lisp').length, 0);
    assert.equal(requests.filter(path => path === '/hg/vfs.js').length, 0);
    await page.route('**/editor/**', route => route.abort());
    await page.keyboard.press('F2');
    await page.waitForURL(/recovery=1/);
    await page.locator('#host-loading').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.equal(await page.locator('#canvas').getAttribute('aria-busy'), 'false');
    // Cache records written before source URLs were included still support an offline restart.
    await page.evaluate(async () => {
      const { Storage } = await import('/hg/storage.js');
      const store = await Storage.new('mercury-project');
      try {
        const records = await Storage.records(store);
        const defaults = records.defaults.map(({ source, ...file }) => file);
        await Storage.commit(store, store.version, [{ kind: 'put', key: 'defaults', value: defaults }]);
      } finally { Storage.close(store); }
    });
    await page.route('**/hg/vfs-seed.generated.json', route => route.abort());
    await page.reload();
    await page.locator('#host-loading').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.equal(await page.locator('#canvas').getAttribute('aria-busy'), 'false');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('fatal initialization errors replace the loading status with recovery diagnostics', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await page.goto(url);
    await page.locator('#host-error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#host-loading').isVisible(), false);
    assert.equal(await page.locator('#canvas').getAttribute('aria-busy'), 'false');
    assert.match(await page.locator('#host-diagnostic').textContent(), /WebGPU is required/);
    assert.equal(await page.locator('#host-recover').isEnabled(), true);
  } finally { await browser.close(); }
});
