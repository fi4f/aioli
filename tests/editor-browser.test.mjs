import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

test('Mayo renders its own editor on canvas and reloads itself after Lisp debounce', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(new URL('/editor.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.waitForSelector('[data-aioli-text-proxy]', { state: 'attached' });
    const dimensions = await page.locator('canvas').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return [element.width, element.height, Math.round(bounds.width), Math.round(bounds.height)];
    });
    assert.deepEqual(dimensions.slice(0, 2), dimensions.slice(2));
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(() => {
      const canvas = document.getElementById('canvas');
      return canvas.width === 1024 && canvas.height === 768;
    });
    const proxy = page.locator('[data-aioli-text-proxy]');
    const original = await proxy.inputValue();
    assert.match(original, /\(let title "Mayo"\)/);
    assert.equal(await page.locator('body > canvas').count(), 1);
    assert.equal(await page.locator('body textarea:not([data-aioli-text-proxy])').count(), 0);
    assert.equal(await proxy.evaluate(element => getComputedStyle(element).opacity), '0');
    const old = await proxy.elementHandle();
    assert.equal(await old.evaluate((element, value) => {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return element.isConnected;
    }, original.replace('(let title "Mayo")', '(let title "Mayo live")')), true);
    await page.waitForFunction(element => !element.isConnected, old);
    assert.match(await proxy.inputValue(), /Mayo live/);
    await page.waitForTimeout(200);
    const working = await page.locator('canvas').screenshot();
    const current = await proxy.elementHandle();
    await proxy.fill('(let broken');
    await page.waitForTimeout(800);
    assert.equal(await current.evaluate(element => element.isConnected), true);
    assert.notDeepEqual(await page.locator('canvas').screenshot(), working);
    await proxy.fill(original);
    await page.waitForFunction(element => !element.isConnected, current);
    assert.equal(await proxy.count(), 1);
    assert.equal(await proxy.inputValue(), original);
    // A malformed text operation inside render must fail before scene replacement.
    const editing = await proxy.elementHandle();
    const missingResolution = original.replace('(wrap false)', '(wrap false) (resolution)');
    await proxy.fill(missingResolution);
    await page.waitForTimeout(750);
    assert.equal(await editing.evaluate(element => element.isConnected), true);
    assert.equal(await proxy.inputValue(), missingResolution);
    const zeroResolution = original.replace('(wrap false)', '(wrap false) (resolution 0)');
    await proxy.fill(zeroResolution);
    await page.waitForTimeout(750);
    assert.equal(await editing.evaluate(element => element.isConnected), true);
    assert.equal(await proxy.inputValue(), zeroResolution);
    // Computed invalid values are checked by the candidate's first render.
    await proxy.fill(original.replace('(wrap false)', '(wrap false) (resolution (- 1 1))'));
    await page.waitForFunction(element => !element.isConnected, editing);
    await page.waitForTimeout(200);
    const recovered = await proxy.elementHandle();
    assert.equal(await proxy.count(), 1);
    assert.match(await proxy.inputValue(), /resolution \(- 1 1\)/);
    await proxy.fill(original.replace('(wrap false)', '(wrap false) (resolution 2)'));
    await page.waitForFunction(element => !element.isConnected, recovered);
    const validResolution = await proxy.elementHandle();
    await proxy.fill(original);
    await page.waitForFunction(element => !element.isConnected, validResolution);
    // Native typing reaches the invisible adapter and changes the Lisp draft.
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n; native input');
    assert.match(await proxy.inputValue(), /native input$/);
    const typed = await proxy.elementHandle();
    const selection = await typed.evaluate(element => element.selectionStart);
    await page.waitForFunction(element => !element.isConnected, typed);
    assert.equal(await proxy.evaluate(element => element.selectionStart), selection);
    // Composition keeps the current editor installed until the native commit.
    const composing = await proxy.elementHandle();
    await proxy.dispatchEvent('compositionstart');
    await page.keyboard.insertText(' composing');
    await page.waitForTimeout(700);
    assert.equal(await composing.evaluate(element => element.isConnected), true);
    await proxy.dispatchEvent('compositionend');
    await page.waitForFunction(element => !element.isConnected, composing);
    assert.match(await proxy.inputValue(), /native input composing$/);
    // Pointer coordinates are resolved by Lisp, then mirrored into native input.
    await page.locator('canvas').click({ position: { x: 24, y: 67 } });
    assert.equal(await proxy.evaluate(element => element.selectionStart === element.selectionEnd), true);
    assert.equal(await proxy.evaluate(element => document.activeElement === element), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('Mayo preserves small wheel deltas, clamps fast scrolling, and respects wheel units', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('/index.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.evaluate(async () => {
      const { Aioli } = await import('/aioli.js');
      const canvas = document.createElement('canvas');
      canvas.id = 'scroll-test';
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px';
      document.body.append(canvas);
      const runtime = new Aioli({ onError: error => { throw error; } });
      await runtime.attach(canvas);
      const createText = runtime.graphics.createText;
      const batches = [];
      runtime.graphics.createText = snapshot => {
        if (snapshot.wrap === false && snapshot.runs.some(run => run.text === '; Welcome to Mayo. This is the source of the editor you are using right now.')) {
          batches.push(snapshot.runs.map(run => ({ text: run.text, fill: run.fill })));
        }
        return createText(snapshot);
      };
      let passes = 0;
      const begin = GPUCommandEncoder.prototype.beginRenderPass;
      GPUCommandEncoder.prototype.beginRenderPass = function(...args) { passes++; return begin.apply(this, args); };
      await runtime.load('/editor/main.lisp');
      runtime.stage.stop();
      passes = 0;
      runtime.stage.frame(0);
      const dirtyPasses = passes;
      passes = 0;
      runtime.stage.frame(16);
      const idlePasses = passes;
      runtime.stage.schedule();
      window.scrollTest = { canvas, runtime, state: runtime.context.values.state.values, dirtyPasses, idlePasses, batches };
    });
    assert.equal(await page.evaluate(() => scrollTest.dirtyPasses), 7);
    assert.equal(await page.evaluate(() => scrollTest.idlePasses), 1);
    const firstBatch = await page.evaluate(() => scrollTest.batches[0]);
    const firstLine = firstBatch.map(run => run.text).join('').split('\n')[0];
    assert.match(firstLine, /^\s+1  ; Welcome to Mayo/);
    assert.ok(new Set(firstBatch.map(run => JSON.stringify(run.fill))).size >= 4);
    await page.waitForTimeout(150);
    const before = await page.locator('#scroll-test').screenshot();
    const rasterizations = await page.evaluate(() => scrollTest.runtime.graphics.stats.textRasterizations);
    const scroll = (dy, mode = 0, count = 1) => page.evaluate(({ dy, mode, count }) => {
      for (let i = 0; i < count; i++) scrollTest.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: mode }));
      return scrollTest.state.scroll;
    }, { dy, mode, count });
    assert.ok(Math.abs(await scroll(0.5, 0, 10) - 0.25) < 1e-8);
    const smallScrollImage = await page.locator('#scroll-test').screenshot();
    assert.notDeepEqual(smallScrollImage, before);
    assert.equal(await page.evaluate(() => scrollTest.runtime.graphics.stats.textRasterizations), rasterizations);
    assert.ok(Math.abs(await scroll(3, 1) - 3.25) < 1e-8);
    const rowsInView = (480 - 64 - 100) / 20;
    assert.ok(Math.abs(await scroll(1, 2) - (3.25 + rowsInView)) < 1e-8);
    const maximum = await page.evaluate(() => scrollTest.state.source.split('\n').length - (480 - 64 - 100) / 20);
    assert.ok(Math.abs(await scroll(100, 0, 100) - maximum) < 1e-8);
    assert.notDeepEqual(await page.locator('#scroll-test').screenshot(), smallScrollImage);
    assert.ok(Math.abs(await scroll(-0.5, 0, 10) - (maximum - 0.25)) < 1e-8);
    const preserved = await page.evaluate(() => {
      const proxy = document.querySelector('[data-aioli-text-proxy]');
      const before = scrollTest.state.scroll;
      proxy.dispatchEvent(new Event('compositionstart'));
      proxy.dispatchEvent(new Event('compositionend'));
      return [before, scrollTest.state.scroll];
    });
    assert.equal(preserved[0], preserved[1]);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => scrollTest.state.scroll), 0);
    assert.equal(await scroll(-10000), 0);
    await page.evaluate(() => scrollTest.runtime.destroy());
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('text-proxy suppresses redundant notifications and keeps grapheme selections intact', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/index.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    const result = await page.evaluate(async () => {
      const { createTextProxy } = await import('/engine/browser/text-proxy.js');
      const snapshots = [];
      const proxy = createTextProxy(document.getElementById('canvas'), value => snapshots.push(value.values));
      proxy.values.sync('a👩‍👩‍👧‍👦b\nsecond', 4, 4);
      proxy.values.focus();
      const target = document.querySelector('[data-aioli-text-proxy]');
      target.dispatchEvent(new Event('input'));
      for (let i = 0; i < 20; i++) target.dispatchEvent(new Event('keyup'));
      const unchanged = snapshots.length;
      const anchor = snapshots[0].anchor;
      target.dispatchEvent(new Event('compositionstart'));
      target.dispatchEvent(new Event('keyup'));
      target.dispatchEvent(new Event('compositionend'));
      const composition = snapshots.map(snapshot => snapshot.composing);
      proxy.values.select(1, 3);
      const selection = proxy.values.snapshot().values;
      proxy.values.dispose();
      proxy.values.dispose();
      return { unchanged, anchor, composition, head: selection.head,
        disposed: !target.isConnected };
    });
    assert.equal(result.unchanged, 1);
    assert.equal(result.anchor, 1);
    assert.deepEqual(result.composition, [false, true, false]);
    assert.equal(result.head, 17);
    assert.equal(result.disposed, true);
  } finally { await browser.close(); }
});
