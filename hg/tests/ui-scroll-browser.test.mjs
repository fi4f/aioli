import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

for (const trace of [true, false]) {
  test(`editor bars scroll with mouse wheels and diagonal trackpad gestures (trace=${trace})`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: trace ? 1.25 : 2 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.route('**/index.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text())
          .replace('host.app = app;', 'host.app = app; window.barTestApp = app;') });
      });
      await page.goto(new URL(trace ? '/?trace=1' : '/', baseURL).href);
      await page.locator('#host-loading').waitFor({ state: 'hidden' });
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        const app = barTestApp, desktop = App.exec(app, 'desktop');
        const component = App.exec(app, 'ui-strip-component');
        const find = node => node.component === component ? node : node.children.map(find).find(Boolean);
        window.barTest = { App, app, desktop, wheels: [], bars: {
          menu: desktop.root.children[0], files: find(App.exec(app, 'files-pane')),
          taskbar: desktop.root.children[2],
        } };
        app.outerCanvas.addEventListener('wheel', event => barTest.wheels.push({
          dx: event.deltaX, dy: event.deltaY, prevented: event.defaultPrevented,
        }));
      });
      const exercise = async name => {
        await page.waitForFunction(name => barTest.bars[name].state['max-scroll'] > 0, name);
        for (const [dx, dy] of [[0, 20], [-0.5, 40], [40, -0.5], [0.5, -30], [0, 0.25], [0, 10000], [-10000, 0.1]]) {
          const before = await page.evaluate(name => {
            const { app, desktop, bars, wheels } = barTest, bar = bars[name];
            const button = bar.children.find(node => node.handlers?.click?.length && node.clip.z > 0);
            const visible = button ? button.clip : bar.state.viewport;
            const canvas = app.outerCanvas.getBoundingClientRect();
            return { scroll: bar.state.scroll, max: bar.state['max-scroll'], first: bar.children[0].bounds.x,
              count: wheels.length,
              x: canvas.left + (visible.x + visible.z / 2) * desktop.scale * canvas.width / app.outerCanvas.width,
              y: canvas.top + (visible.y + visible.w / 2) * desktop.scale * canvas.height / app.outerCanvas.height };
          }, name);
          await page.mouse.move(before.x, before.y);
          await page.mouse.wheel(dx, dy);
          await page.waitForFunction(count => barTest.wheels.length > count, before.count);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const after = await page.evaluate(name => ({ scroll: barTest.bars[name].state.scroll,
            first: barTest.bars[name].children[0].bounds.x, wheel: barTest.wheels.at(-1) }), name);
          const delta = Math.abs(after.wheel.dy) > Math.abs(after.wheel.dx) ? after.wheel.dy : after.wheel.dx;
          const expected = Math.max(0, Math.min(before.max, before.scroll + delta));
          assert.ok(Math.abs(after.scroll - expected) < 0.001, `${name}: expected ${expected}, got ${after.scroll}`);
          assert.ok(Math.abs(after.first - (before.first - (after.scroll - before.scroll))) < 0.001,
            `${name}: scrolled content must move on screen`);
          assert.equal(after.wheel.prevented, true);
        }
      };
      await exercise('files');
      await exercise('menu');
      await page.evaluate(() => {
        const { App, app, desktop } = barTest;
        App.exec(app, '(ui-pane-open desktop bindings-pane)');
        for (const pane of App.exec(app, 'workspace').state.panes)
          if (!pane.state.closed) App.exec(app, 'ui-pane-minimize')(desktop, pane);
      });
      await page.setViewportSize({ width: 480, height: 700 });
      await exercise('taskbar');
      assert.equal(await page.locator('#host-error').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

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
      App.exec(app, '(ui-pane-open desktop bindings-pane)');
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
