import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

test('Bindings scrolls on canvas with wheel, keyboard, and scrollbar dragging', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1.25 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/index.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('host.app = app;', 'host.app = app; window.scrollTestApp = app;') });
    });
    await page.goto(new URL('/index.html', baseURL).href);
    await page.waitForFunction(() => window.scrollTestApp?.scene && !scrollTestApp.attaching);
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const app = scrollTestApp;
      const path = App.exec(app, '(ui-path desktop.root inspector)');
      const component = App.exec(app, 'ui-scroll-component');
      const node = path.find(node => node.component === component);
      const desktop = App.read(app, App.inspect(app).desktop);
      const inspector = App.read(app, App.inspect(app).inspector);
      const name = 'long-binding-name-'.repeat(12);
      window.bindingsScroll = { node, desktop, inspector, name, sourceRow: app.state.editor.scroll };
      App.exec(app, `(let ${name} 1)`);
    });
    await page.waitForFunction(() => bindingsScroll.inspector.props.value.includes(bindingsScroll.name) &&
      bindingsScroll.node.state['max-offset'].y > 0 && bindingsScroll.node.state['max-offset'].x > 0);
    const point = await page.evaluate(() => {
      const canvas = scrollTestApp.outerCanvas, bounds = canvas.getBoundingClientRect();
      const viewport = bindingsScroll.node.state.viewport;
      return { x: bounds.left + (viewport.x + viewport.z / 2) * bindingsScroll.desktop.scale * bounds.width / canvas.width,
        y: bounds.top + (viewport.y + viewport.w / 2) * bindingsScroll.desktop.scale * bounds.height / canvas.height };
    });
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const rasterizations = await page.evaluate(() => scrollTestApp.graphics.stats.textRasterizations);
    const before = await page.locator('#canvas').screenshot();
    await page.mouse.wheel(0, 80);
    await page.waitForFunction(() => bindingsScroll.node.state.offset.y > 0);
    assert.equal(await page.evaluate(() => scrollTestApp.state.editor.scroll), await page.evaluate(() => bindingsScroll.sourceRow));
    assert.equal(await page.evaluate(() => scrollTestApp.graphics.stats.textRasterizations), rasterizations);
    assert.notDeepEqual(await page.locator('#canvas').screenshot(), before);
    await page.mouse.wheel(35, 0);
    await page.waitForFunction(() => bindingsScroll.node.state.offset.x > 0);
    const track = await page.evaluate(() => {
      const canvas = scrollTestApp.outerCanvas, bounds = canvas.getBoundingClientRect();
      const thumb = bindingsScroll.node.state['thumb-y'], viewport = bindingsScroll.node.state.viewport;
      const scale = bindingsScroll.desktop.scale * bounds.height / canvas.height;
      return { x: bounds.left + (thumb.x + thumb.z / 2) * scale,
        y: bounds.top + (thumb.y + thumb.w / 2) * scale,
        bottom: bounds.top + (viewport.y + viewport.w + 100) * scale };
    });
    await page.mouse.move(track.x, track.y);
    await page.mouse.down();
    await page.mouse.move(track.x, track.bottom, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => bindingsScroll.node.state.offset.y === bindingsScroll.node.state['max-offset'].y);
    await page.keyboard.press('Home');
    await page.waitForFunction(() => bindingsScroll.node.state.offset.y === 0);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => bindingsScroll.node.state.offset.y > 0);
    assert.equal(await page.evaluate(() => scrollTestApp.failed), false);
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
