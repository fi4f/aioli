import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

async function openEditor(page) {
  await page.route('**/index.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('host.app = app;', 'host.app = app; window.recoveryTestApp = app;') });
  });
  await page.goto(new URL('/', baseURL).href);
  await page.waitForFunction(() => window.recoveryTestApp?.scene && !recoveryTestApp.attaching);
}

test('native edit and key callbacks contain synchronous and asynchronous failures', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));
    await page.route('**/callback-test.html', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
    await page.goto(new URL('/callback-test.html', baseURL).href);
    const results = await page.evaluate(async () => {
      const { TextProxy } = await import('/hg/text-proxy.js');
      const results = [];
      for (const key of [false, true]) for (const asynchronous of [false, true]) {
        const errors = [];
        let calls = 0;
        const callback = () => {
          calls++;
          if (asynchronous) return Promise.reject(new Error('callback failed'));
          throw new Error('callback failed');
        };
        const proxy = TextProxy.new(document.querySelector('canvas'), key ? () => {} : callback, {
          onError: error => errors.push(error.message),
        });
        if (key) TextProxy.listenKeys(proxy, callback);
        const send = () => {
          if (key) proxy.target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', cancelable: true }));
          else {
            proxy.target.value += 'a';
            proxy.target.dispatchEvent(new Event('input'));
          }
        };
        send();
        await Promise.resolve();
        send();
        await Promise.resolve();
        results.push({ calls, errors, readOnly: proxy.target.readOnly });
        TextProxy.dispose(proxy);
      }
      // A disposed editor's pending callback cannot report into its successor.
      const errors = [];
      let reject;
      const pending = new Promise((resolve, fail) => { reject = fail; });
      const proxy = TextProxy.new(document.querySelector('canvas'), () => pending, { onError: error => errors.push(error.message) });
      proxy.target.value = 'draft';
      proxy.target.dispatchEvent(new Event('input'));
      TextProxy.dispose(proxy);
      reject(new Error('obsolete callback'));
      await Promise.resolve();
      return { results, errors };
    });
    assert.deepEqual(results.results, Array.from({ length: 4 }, () => ({ calls: 1, errors: ['callback failed'], readOnly: true })));
    assert.deepEqual(results.errors, []);
    assert.deepEqual(uncaught, []);
  } finally { await browser.close(); }
});

test('untraced editor rejects a bad first render and remains editable', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));
    await openEditor(page);
    const result = await page.evaluate(async () => {
      const app = recoveryTestApp;
      const { App } = await import('/hg/app.js');
      const { TextProxy } = await import('/hg/text-proxy.js');
      const previous = app.scene, source = app.source, proxies = app.textProxies.size;
      let error;
      try {
        await App.loadSource(app, source.replace('(on render (context)', '(on render (context) (let invalid-resolution 0) (text (resolution invalid-resolution) "bad")'));
      } catch (failure) { error = failure.message; }
      const proxy = [...app.textProxies].find(proxy => proxy.content === app.state.editor.source);
      TextProxy.focus(proxy);
      TextProxy.select(proxy, proxy.content.length, proxy.content.length);
      return { trace: app.trace, error, sameScene: app.scene === previous, sameSource: app.source === source, sameProxyCount: app.textProxies.size === proxies, failed: app.failed };
    });
    assert.match(result.error, /resolution expects a positive finite/);
    assert.deepEqual({ ...result, error: undefined }, { trace: false, error: undefined, sameScene: true, sameSource: true, sameProxyCount: true, failed: false });
    await page.keyboard.type('\n; still editable');
    assert.equal(await page.evaluate(() => recoveryTestApp.state.editor.source.endsWith('; still editable')), true);
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.deepEqual(uncaught, []);
  } finally { await browser.close(); }
});

test('a stopped editor shows native diagnostics and F2 recovers its unsaved buffer', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));
    await openEditor(page);
    await page.evaluate(async () => {
      const app = recoveryTestApp;
      app.state.editor.source = '; unsaved recovery draft';
      app.state.editor.dirty = true;
      app.state.editor.pending = false;
      window.failedTestApp = app;
      app.scene.render = () => { throw new Error('regression render failure'); };
      const { Scheduler } = await import('/hg/scheduler.js');
      Scheduler.requestRender(app);
    });
    await page.locator('#host-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#host-diagnostic').textContent(), /regression render failure/);
    assert.equal(await page.evaluate(() => recoveryTestApp.failed), true);
    assert.equal(await page.evaluate(() => recoveryTestApp.textProxies.size), 0);
    await page.keyboard.press('F2');
    await page.waitForFunction(() => recoveryTestApp !== failedTestApp && recoveryTestApp.scene && !recoveryTestApp.attaching);
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => [recoveryTestApp.failed, recoveryTestApp.state['editor-mode'], recoveryTestApp.state.editor.source]),
      [false, 'recovery', '; unsaved recovery draft']);
    // An asynchronous native input route also reaches the host panel, and the
    // recovery button works independently of the stopped Lisp editor.
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const app = recoveryTestApp;
      app.state.editor.pending = false;
      window.failedInputApp = app;
      App.listenInput(app, () => Promise.reject(new Error('regression input rejection')));
      app.outerCanvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
    });
    await page.locator('#host-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#host-diagnostic').textContent(), /regression input rejection/);
    assert.equal(await page.evaluate(() => recoveryTestApp.failed), true);
    await page.locator('#host-recover').click();
    await page.waitForFunction(() => recoveryTestApp !== failedInputApp && recoveryTestApp.scene && !recoveryTestApp.attaching);
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.deepEqual(uncaught, []);
  } finally { await browser.close(); }
});
