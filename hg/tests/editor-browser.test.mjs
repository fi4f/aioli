import { Data } from '../data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

test('large text-proxy documents preserve global edits, selections, history, and old snapshots', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/index.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.evaluate(async () => {
      for (const [name, file] of [['Data', 'data'], ['Compiler', 'compiler'], ['Graphics', 'graphics'], ['Input', 'input'], ['InnerCanvas', 'inner-canvas'], ['Trace', 'trace'], ['TextProxy', 'text-proxy']]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    await page.evaluate(async () => {
      const { TextProxy } = await import('/hg/text-proxy.js');
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      window.originalLargeSource = Array.from({ length: 10000 }, (_, i) => `row ${i} abcdef 👋`).join('\n');
      window.largeEdits = [];
      window.largeProxy = TextProxy.new(canvas, () => {}, { onEdit: edit => largeEdits.push(edit) });
      TextProxy.sync(largeProxy, originalLargeSource); TextProxy.focus(largeProxy);
      window.oldLargeSnapshot = Data.values(TextProxy.snapshot(largeProxy));
      TextProxy.select(largeProxy, 5000, 4);
    });
    const native = page.locator('[data-hg-text-proxy]');
    assert.ok((await native.inputValue()).length <= 8192);
    await page.keyboard.type('INSERT');
    assert.deepEqual(await page.evaluate(() => {
      const current = Data.values(TextProxy.snapshot(largeProxy));
      return [Data.values(Data.values(current.lines)[5000]).text, Data.values(Data.values(oldLargeSnapshot.lines)[5000]).text,
        current.content === largeEdits.at(-1).source, current.head - Data.values(Data.values(current.lines)[5000]).start];
    }), ['row INSERT5000 abcdef 👋', 'row 5000 abcdef 👋', true, 10]);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).head), await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).content.length));
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).head), 0);
    await page.keyboard.press('Control+a');
    assert.deepEqual(await page.evaluate(() => {
      const selected = Data.values(TextProxy.snapshot(largeProxy));
      const data = new DataTransfer();
      document.querySelector('[data-hg-text-proxy]').dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, cancelable: true }));
      return [selected.anchor, selected.head === selected.content.length, data.getData('text/plain') === selected.content];
    }), [0, true, true]);
    await page.keyboard.type('replacement');
    assert.equal(await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).content), 'replacement');
    // Each inserted character is undoable, including the replacement of the
    // document-wide selection that extends beyond the invisible native window.
    for (let i = 0; i < 'replacement'.length; i++) await page.keyboard.press('Control+z');
    assert.match(await page.evaluate(() => Data.values(Data.values(Data.values(TextProxy.snapshot(largeProxy)).lines)[5000]).text), /INSERT/);
    for (let i = 0; i < 'replacement'.length; i++) await page.keyboard.press('Control+y');
    assert.equal(await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).content), 'replacement');
    await page.evaluate(() => { TextProxy.sync(largeProxy, originalLargeSource); TextProxy.select(largeProxy, 9998, 4); });
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => {
      const current = Data.values(TextProxy.snapshot(largeProxy));
      return current.head - Data.values(Data.values(current.lines)[9999]).start;
    }), 4);
    await page.keyboard.press('Control+a');
    assert.deepEqual(await page.evaluate(() => {
      const data = new DataTransfer();
      document.querySelector('[data-hg-text-proxy]').dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, cancelable: true }));
      return [Data.values(TextProxy.snapshot(largeProxy)).content, data.getData('text/plain') === originalLargeSource];
    }), ['', true]);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).content === originalLargeSource), true);
    await page.evaluate(() => { TextProxy.sync(largeProxy, originalLargeSource); TextProxy.select(largeProxy, 10, 4); TextProxy.select(largeProxy, 9000, 5, true); });
    await page.keyboard.type('X');
    assert.equal(await page.evaluate(() => {
      const start = Data.values(Data.values(oldLargeSnapshot.lines)[10]).start + 4;
      const end = Data.values(Data.values(oldLargeSnapshot.lines)[9000]).start + 5;
      return Data.values(TextProxy.snapshot(largeProxy)).content === originalLargeSource.slice(0, start) + 'X' + originalLargeSource.slice(end);
    }), true);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).content === originalLargeSource), true);
    // Growing a small document into a windowed one must preserve the edit that
    // crossed the threshold, not start undo history after that edit.
    await page.evaluate(() => {
      TextProxy.sync(largeProxy, 'small');
      const target = document.querySelector('[data-hg-text-proxy]');
      target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', bubbles: true }));
      target.setRangeText(originalLargeSource, 0, target.value.length, 'end');
      target.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
    });
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => Data.values(TextProxy.snapshot(largeProxy)).content), 'small');
    assert.deepEqual(await page.evaluate(() => {
      TextProxy.sync(largeProxy, originalLargeSource); TextProxy.select(largeProxy, 5000, 4);
      const target = document.querySelector('[data-hg-text-proxy]');
      target.dispatchEvent(new CompositionEvent('compositionstart'));
      target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', isComposing: true }));
      target.setRangeText('界', target.selectionStart, target.selectionEnd, 'end');
      target.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }));
      const during = Data.values(TextProxy.snapshot(largeProxy));
      target.dispatchEvent(new CompositionEvent('compositionend'));
      const after = Data.values(TextProxy.snapshot(largeProxy));
      return [during.composing, after.composing, Data.values(Data.values(after.lines)[5000]).text, after.head - Data.values(Data.values(after.lines)[5000]).start];
    }), [true, false, 'row 界5000 abcdef 👋', 5]);
  } finally { await browser.close(); }
});

test('Mayo renders its own editor on canvas and reloads itself after Lisp debounce', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(new URL('/editor.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.evaluate(async () => {
      for (const [name, file] of [['Data', 'data'], ['Compiler', 'compiler'], ['Graphics', 'graphics'], ['Input', 'input'], ['InnerCanvas', 'inner-canvas'], ['Trace', 'trace'], ['TextProxy', 'text-proxy']]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    await page.waitForSelector('[data-hg-text-proxy]', { state: 'attached' });
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
    const proxy = page.locator('[data-hg-text-proxy]');
    const original = await proxy.inputValue();
    assert.match(original, /\(let title "Mayo"\)/);
    assert.equal(await page.locator('body > canvas').count(), 1);
    assert.equal(await page.locator('body textarea:not([data-hg-text-proxy])').count(), 0);
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
      for (const [name, file] of [['Data', 'data'], ['Compiler', 'compiler'], ['Graphics', 'graphics'], ['Input', 'input'], ['InnerCanvas', 'inner-canvas'], ['Trace', 'trace'], ['TextProxy', 'text-proxy']]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    await page.evaluate(async () => {
      const { AppCore } = await import('/hg/app.js');
      const { Scheduler } = await import('/hg/scheduler.js'); Object.assign(window, { AppCore, Scheduler });
      const canvas = document.createElement('canvas');
      canvas.id = 'scroll-test';
      canvas.width = 640; canvas.height = 480;
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px';
      document.body.append(canvas);
      const runtime = AppCore.new({ onError: error => { throw error; } });
      await AppCore.attach(runtime,canvas);
      const createText = runtime.services.graphics.createText;
      const batches = [];
      runtime.services.graphics = { ...runtime.services.graphics, createText: (graphics, snapshot) => {
        if (snapshot.wrap === false && snapshot.runs.some(run => run.text === '; Welcome to Mayo. This is the source of the editor you are using right now.')) {
          batches.push(snapshot.runs.map(run => ({ text: run.text, fill: run.fill })));
        }
        return createText(graphics, snapshot);
      } };
      let passes = 0;
      const begin = GPUCommandEncoder.prototype.beginRenderPass;
      GPUCommandEncoder.prototype.beginRenderPass = function(...args) { passes++; return begin.apply(this, args); };
      await runtime.bindings.App.load(runtime,'/editor/main.lisp');
      Scheduler.stop(runtime);
      passes = 0;
      Scheduler.frame(runtime,0);
      const dirtyPasses = passes;
      passes = 0;
      Scheduler.frame(runtime,16);
      const idlePasses = passes;
      Scheduler.schedule(runtime);
      window.scrollTest = { canvas, runtime, state: Data.values(runtime.state), dirtyPasses, idlePasses, batches };
    });
    assert.equal(await page.evaluate(() => scrollTest.dirtyPasses), 7);
    assert.equal(await page.evaluate(() => scrollTest.idlePasses), 0);
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
      const proxy = document.querySelector('[data-hg-text-proxy]');
      const before = scrollTest.state.scroll;
      proxy.dispatchEvent(new Event('compositionstart'));
      proxy.dispatchEvent(new Event('compositionend'));
      return [before, scrollTest.state.scroll];
    });
    assert.equal(preserved[0], preserved[1]);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => scrollTest.state.scroll), 0);
    assert.equal(await scroll(-10000), 0);
    await page.evaluate(() => AppCore.destroy(scrollTest.runtime));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('text-proxy suppresses redundant notifications and keeps grapheme selections intact', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/index.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.evaluate(async () => {
      for (const [name, file] of [['Data', 'data'], ['Compiler', 'compiler'], ['Graphics', 'graphics'], ['Input', 'input'], ['InnerCanvas', 'inner-canvas'], ['Trace', 'trace'], ['TextProxy', 'text-proxy']]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    const result = await page.evaluate(async () => {
      const { TextProxy } = await import('/hg/text-proxy.js');
      const snapshots = [];
      const proxy = TextProxy.new(document.getElementById('canvas'), value => snapshots.push(Data.values(value)));
      TextProxy.sync(proxy, 'a👩‍👩‍👧‍👦b\nsecond', 4, 4);
      TextProxy.focus(proxy);
      const target = document.querySelector('[data-hg-text-proxy]');
      target.dispatchEvent(new Event('input'));
      for (let i = 0; i < 20; i++) target.dispatchEvent(new Event('keyup'));
      const unchanged = snapshots.length;
      const anchor = snapshots[0].anchor;
      target.dispatchEvent(new Event('compositionstart'));
      target.dispatchEvent(new Event('keyup'));
      target.dispatchEvent(new Event('compositionend'));
      const composition = snapshots.map(snapshot => snapshot.composing);
      TextProxy.select(proxy, 1, 3);
      const selection = Data.values(TextProxy.snapshot(proxy));
      TextProxy.dispose(proxy);
      TextProxy.dispose(proxy);
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

test('cached highlighted text matches uncached pixels across edits', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/index.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.evaluate(async () => {
      for (const [name, file] of [['Data', 'data'], ['Compiler', 'compiler'], ['Graphics', 'graphics'], ['Input', 'input'], ['InnerCanvas', 'inner-canvas'], ['Trace', 'trace'], ['TextProxy', 'text-proxy']]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    const result = await page.evaluate(async () => {
      const { Text } = await import('/hg/text.js');
      const cache = { measure: new Map(), paint: new Map() };
      let difference = 0;
      for (const first of ['(let value 1)', '(let value 12)', '(let value 123)']) {
        const builder = Text.createTextBuilder();
        Text.textOperation(builder, 'font', 'monospace'); Text.textOperation(builder, 'size', 14);
        Text.textOperation(builder, 'width', 240); Text.textOperation(builder, 'height', 100);
        Text.textOperation(builder, 'line-height', 20); Text.textOperation(builder, 'wrap', false);
        Text.textOperation(builder, 'span', first + '\n');
        Text.textOperation(builder, 'fill', 0.5, 0.7, 0.9); Text.textOperation(builder, 'span', 'same shaped line\n');
        Text.textOperation(builder, 'fill', 0.8, 0.6, 0.5); Text.textOperation(builder, 'span', 'fi emoji 👋\n');
        const snapshot = Text.finishTextBuilder(builder);
        const a = Text.rasterizeText(snapshot).canvas.getContext('2d').getImageData(0, 0, 240, 100).data;
        const b = Text.rasterizeText(snapshot, { cache }).canvas.getContext('2d').getImageData(0, 0, 240, 100).data;
        for (let i = 0; i < a.length; i++) difference = Math.max(difference, Math.abs(a[i] - b[i]));
      }
      return { difference, cachedLines: cache.paint.size };
    });
    assert.ok(result.difference <= 1, `cached pixel difference ${result.difference}`);
    assert.equal(result.cachedLines, 5);
  } finally { await browser.close(); }
});
