import { Data } from '../data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = new URL('/hg/tests/browser.html', process.env.AIOLI_URL || 'http://localhost:3000').href;

test('Mercury namespaces operate on explicit app data from JS and Lisp', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url);
    await page.evaluate(async () => {
      for (const [name, file] of [['Data', 'data'], ['Compiler', 'compiler'], ['Graphics', 'graphics'], ['Input', 'input'], ['InnerCanvas', 'inner-canvas'], ['Trace', 'trace'], ['TextProxy', 'text-proxy']]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    const result = await page.evaluate(async () => {
      const { default: hg } = await import('/hg.js');
      const make = id => { const c = document.createElement('canvas'); c.id = id; c.width = 80; c.height = 60; document.body.append(c); return c; };
      const left = make('left'), right = make('right');
      const newApp = hg.App.new, load = hg.App.loadSource, dispose = hg.App.dispose;
      const a = newApp({ c: 'left', w: 16, h: 12, si: 1, ups: 30 });
      const b = newApp({ c: right.getContext('2d'), ups: 120 });
      const synchronous = !(a instanceof Promise);
      await load(a, '(set app.state.factory App.new) (set app.state.loader App.loadSource) (set app.state.identity app) (on render (c) (clear 1 0 0 1))');
      await load(b, '(set app.state.count 0) (on update (c) (set app.state.count (+ app.state.count 1))) (on render (c) (clear 0 1 0 1))');
      const scene = a.scene;
      let error;
      try { await load(a, '(let broken'); } catch (e) { error = e.message; }
      const stable = a.scene === scene;
      await new Promise(resolve => setTimeout(resolve, 100));
      const output = [synchronous, Object.getPrototypeOf(a) === Object.prototype, !Object.isFrozen(a),
        a.load === undefined, a.stage === undefined, Data.values(a.state).factory === newApp,
        Data.values(a.state).loader === load, Data.values(a.state).identity === a, stable, /SyntaxError/.test(error),
        a.display.innerCanvas.width, a.display.innerCanvas.height, a.ups, b.ups, Data.values(b.state).count > 0,
        a.modules.cache !== b.modules.cache];
      output.push([...left.getContext('2d').getImageData(40, 30, 1, 1).data]);
      output.push([...right.getContext('2d').getImageData(40, 30, 1, 1).data]);
      dispose(a); dispose(a); dispose(b);
      output.push(left.isConnected && right.isConnected, a.frameId === null && b.frameId === null);
      try { await load(a, '(on render (c))'); } catch (e) { output.push(/disposed/.test(e.message)); }
      return output;
    });
    assert.deepEqual(result, [true, true, true, true, true, true, true, true, true, true, 16, 12, 30, 120, true, true, [255, 0, 0, 255], [0, 255, 0, 255], true, true, true]);
  } finally { await browser.close(); }
});

test('default presentation uses dynamic viewport units and cleans up owned canvases', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(url);
    await page.evaluate(async () => {
      for (const [name, file] of [['Data', 'data'], ['Compiler', 'compiler'], ['Graphics', 'graphics'], ['Input', 'input'], ['InnerCanvas', 'inner-canvas'], ['Trace', 'trace'], ['TextProxy', 'text-proxy']]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    assert.deepEqual(await page.evaluate(async () => {
      const { default: hg } = await import('/hg.js');
      window.defaultApp = hg.App.new();
      await hg.App.loadSource(defaultApp, '(on render (c) (clear 0 0 1 1))');
      const c = defaultApp.outerCanvas;
      return [c.style.width, c.style.height, c.width, c.height, !!document.fullscreenElement];
    }), ['100dvw', '100dvh', 900, 700, false]);
    await page.setViewportSize({ width: 720, height: 540 });
    await page.waitForFunction(() => defaultApp.outerCanvas.width === 720 && defaultApp.outerCanvas.height === 540);
    assert.deepEqual(await page.evaluate(async () => {
      const { default: hg } = await import('/hg.js');
      const c = defaultApp.outerCanvas;
      hg.App.dispose(defaultApp);
      const pending = hg.App.new();
      const owned = pending.ownedCanvas;
      hg.App.dispose(pending);
      try { await pending.ready; } catch {}
      return [c.isConnected, owned.isConnected, pending.graphics === null];
    }), [false, false, true]);
  } finally { await browser.close(); }
});
