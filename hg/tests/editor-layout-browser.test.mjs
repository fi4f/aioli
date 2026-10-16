import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

async function capture(page) {
  await page.waitForFunction(() => window.layoutTestApp?.__reflection__?.scene && !layoutTestApp.attaching);
  await page.evaluate(async () => {
    const { App } = await import('/hg/app.js');
    const app = layoutTestApp, workspace = App.exec(app, 'workspace'), desktop = App.exec(app, 'desktop');
    window.layoutTest = { App, app, workspace, desktop,
      panes: Object.fromEntries(workspace.state.panes.map(pane => [pane.props.id, pane])) };
  });
  await page.waitForFunction(() => layoutTest.workspace.bounds.z > 0);
}

async function click(page, text) {
  const point = await page.evaluate(text => {
    const { desktop } = layoutTest;
    const hasText = node => node.props?.value === text || node.children?.some(hasText);
    const find = node => {
      if (!node || node.props?.visible === false) return;
      if (node.handlers?.click?.length && hasText(node)) return node;
      for (const child of node.children ?? []) { const found = find(child); if (found) return found; }
    };
    const node = find(desktop.popup?.node ?? desktop.root);
    if (!node) throw new Error(`Missing button: ${text}`);
    const left = Math.max(node.bounds.x, node.clip.x), top = Math.max(node.bounds.y, node.clip.y);
    const right = Math.min(node.bounds.x + node.bounds.z, node.clip.x + node.clip.z);
    const bottom = Math.min(node.bounds.y + node.bounds.w, node.clip.y + node.clip.w);
    if (right <= left || bottom <= top) throw new Error(`Button clipped: ${text}`);
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }, text);
  await page.mouse.click(point.x, point.y);
}
async function menu(page) {
  await page.waitForFunction(() => !layoutTest.desktop.popup);
  await click(page, 'View');
  await page.waitForFunction(() => layoutTest.desktop.popup?.node.bounds.z > 0);
}
async function checks(page) {
  return page.evaluate(() => Object.fromEntries(layoutTest.desktop.popup.node.children
    .filter(node => node.props['pane-toggle'])
    .map(node => [node.props['pane-toggle'], node.children[0].props.value === '✓'])));
}
async function toggle(page, title) {
  const wasVisible = await page.evaluate(title => layoutTest.panes[title].props.visible !== false, title);
  await menu(page);
  await click(page, title);
  await page.waitForFunction(({ title, wasVisible }) =>
    !layoutTest.desktop.popup && layoutTest.panes[title].props.visible === !wasVisible, { title, wasVisible });
}
async function defaultLayout(page) {
  const actual = await page.evaluate(() => {
    const { panes, workspace } = layoutTest;
    return { visible: Object.values(panes).filter(pane => pane.props.visible !== false).map(pane => pane.props.id),
      workspace: workspace.bounds, panes: Object.fromEntries(Object.entries(panes).map(([name, pane]) => [name, pane.bounds])) };
  });
  assert.deepEqual(actual.visible, ['Files', 'Source', 'Game', 'Diagnostics']);
  const { Files: f, Source: s, Game: g, Diagnostics: d } = actual.panes, w = actual.workspace;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1, `${actual} != ${expected}`);
  near(f.x, w.x); near(f.y, w.y); near(f.z, w.z / 5); near(f.w, w.w);
  near(s.x, f.x + f.z); near(s.y, f.y); near(s.z, w.z * 0.4); near(s.w, w.w * 0.8);
  near(g.x, s.x + s.z); near(g.z, s.z); near(g.y, f.y); near(g.w, s.w);
  near(d.x, s.x); near(d.y, s.y + s.w); near(d.z, s.z + g.z); near(d.w, w.w / 5);
}

for (const trace of [true, false]) {
  test(`default pane proportions, View toggles, saved layout, and reset (trace=${trace})`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: trace ? 1 : 2 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.route('**/index.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text())
          .replace('host.app = app;', 'host.app = app; window.layoutTestApp = app;') });
      });
      await page.goto(new URL(trace ? '/?trace=1' : '/', baseURL).href);
      await capture(page);
      await defaultLayout(page);
      assert.equal(await page.evaluate(() => layoutTest.workspace.children.includes(layoutTest.panes.Bindings)), false);
      await menu(page);
      assert.deepEqual(await checks(page), { Files: true, Source: true, Game: true, Bindings: false, Diagnostics: true });
      await page.keyboard.press('Escape');

      for (const title of ['Files', 'Source', 'Game', 'Bindings', 'Diagnostics']) {
        const initiallyVisible = title !== 'Bindings';
        await toggle(page, title);
        assert.deepEqual(await page.evaluate(title => {
          const pane = layoutTest.panes[title];
          return [pane.state.closed, pane.state.minimized, pane.state.mounted,
            layoutTest.workspace.children.includes(pane)];
        }, title), [initiallyVisible, false, !initiallyVisible, !initiallyVisible]);
        await menu(page);
        assert.equal((await checks(page))[title], !initiallyVisible);
        await page.keyboard.press('Escape');
        await toggle(page, title);
        if (title === 'Game') await page.waitForFunction(() => layoutTestApp.__children__.size === 1);
      }

      // The menu also reflects closes/minimization initiated outside the menu.
      await page.evaluate(() => layoutTest.App.exec(layoutTest.app, '(ui-pane-minimize desktop source-pane)'));
      await menu(page);
      assert.equal((await checks(page)).Source, false);
      await click(page, 'Source');
      await page.waitForFunction(() => !layoutTest.panes.Source.state.minimized && layoutTest.panes.Source.props.visible);
      await page.evaluate(() => layoutTest.App.exec(layoutTest.app, '(ui-pane-close desktop game-pane)'));
      await menu(page);
      assert.equal((await checks(page)).Game, false);
      await page.keyboard.press('Escape');
      await toggle(page, 'Bindings');
      await page.evaluate(() => {
        const { App, app, workspace } = layoutTest;
        if (workspace.state.tree?.kind === 'split') workspace.state.tree.ratio = 0.6;
        App.exec(app, 'ui-dock-save')(workspace);
        window.savedPaneLayout = JSON.stringify(app.state.layout);
      });
      const saved = await page.evaluate(() => savedPaneLayout);
      await page.reload();
      await capture(page);
      assert.equal(await page.evaluate(() => JSON.stringify(layoutTest.app.state.layout)), saved);
      await menu(page);
      assert.deepEqual(await checks(page), { Files: true, Source: true, Game: false, Bindings: true, Diagnostics: true });
      await page.evaluate(() => { window.beforeLayoutReset = layoutTest.workspace; });
      await click(page, 'Reset layout');
      await page.waitForFunction(() => layoutTest.App.exec(layoutTestApp, 'workspace') !== beforeLayoutReset);
      await capture(page);
      await defaultLayout(page);
      assert.equal(await page.locator('#host-error').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
