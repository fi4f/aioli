import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer({ basePath: '/project/' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/project/`);
  await page.waitForFunction(() => window.aioli?.running);
  const region = (id) =>
    page.evaluate((id) => window.aioli.regions.find((item) => item.id === id), id);
  const frame = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  async function click(id) {
    const r = await region(id);
    assert.ok(r, id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await frame();
  }
  async function drag(id, x, y) {
    const r = await region(id);
    assert.ok(r, id);
    await page.mouse.move(r.origin[0] + 20, r.origin[1] + 10);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await frame();
    if (await page.evaluate(() => !!window.aioli.dockPreview))
      await page.waitForFunction(() => window.aioli.dockPreview?.ready);
    await page.mouse.up();
    await frame();
  }
  const source = await page.locator('#text-input').inputValue();
  const initialGameState = await page.evaluate(() => window.aioli.applicationState);
  await click('collapse-game');
  assert.equal(await page.evaluate(() => window.aioli.state['game-collapsed']), true);
  assert.equal(await region('world'), undefined);
  assert.equal((await region('pane-code')).size[0], 1200);
  await click('collapse-game');
  assert.ok(await region('world'));
  await drag('dock-move-game', 1210, 180);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].game.dock), 'floating');
  const gamePlacement = await page.evaluate(() => window.aioli.state['ui-docks'].game);
  assert.equal(await region('hide-game'), undefined);
  await click('view');
  await click('game-view');
  assert.equal(await region('pane-game'), undefined);
  assert.equal(await region('world'), undefined);
  assert.equal((await region('pane-code')).size[0], 1200);
  assert.equal(
    await page.evaluate(() => window.aioli.applicationState['active-scene']),
    initialGameState['active-scene'],
  );
  await page.keyboard.press('F4');
  await frame();
  assert.ok(await region('world'));
  assert.equal(await page.evaluate(() => window.aioli.state['show-game']), false);
  await page.keyboard.press('Escape');
  await frame();
  assert.equal(await region('world'), undefined);
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('aioli.project')).state['show-game'] === false,
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(await page.evaluate(() => window.aioli.state['show-game']), false);
  await click('view');
  await click('game-view');
  assert.deepEqual(await page.evaluate(() => window.aioli.state['ui-docks'].game), gamePlacement);
  assert.ok(await region('world'));
  await drag('dock-move-game', 1190, 300);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].game.dock), 'right');
  await click('view');
  await click('reset-pane-layout');
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].game), undefined);
  await drag('dock-move-code', 1210, 180);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'floating');
  assert.equal(await page.locator('#text-input').inputValue(), source);
  const before = await page.evaluate(() => window.aioli.state['ui-docks'].code);
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id.startsWith('dock-cycle-'))),
    false,
  );
  await page.locator('[data-region="collapse-code"]').focus();
  await page.keyboard.press('Enter');
  await frame();
  assert.equal((await region('pane-code')).size[1], 34);
  assert.equal((await region('collapse-code')).label, 'Expand Code editor');
  assert.equal(await region('dock-move-code'), undefined);
  assert.equal((await region('pane-code')).origin[1], 836);
  assert.equal(await region('dock-resize-code'), undefined);
  await mkdir('artifacts', { recursive: true });
  assert.deepEqual(await page.evaluate(() => window.aioli.state['ui-docks'].code), before);
  await frame();
  await page.screenshot({ path: 'artifacts/floating-pane-collapsed.png' });
  await click('collapse-code');
  assert.equal((await region('pane-code')).size[1], before.height);
  assert.equal((await region('collapse-code')).label, 'Collapse Code editor');
  const grip = await region('dock-resize-code');
  await page.mouse.move(grip.origin[0] + 6, grip.origin[1] + 6);
  await page.mouse.down();
  await page.mouse.move(grip.origin[0] + 60, grip.origin[1] + 40, { steps: 5 });
  await page.mouse.up();
  await frame();
  assert.ok(
    await page.evaluate((width) => window.aioli.state['ui-docks'].code.width > width, before.width),
  );
  const saved = await page.evaluate(() => window.aioli.state['ui-docks']);
  const header = await region('dock-move-code');
  await page.mouse.move(header.origin[0] + 20, header.origin[1] + 10);
  await page.mouse.down();
  await page.mouse.move(800, 300, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await frame();
  assert.deepEqual(await page.evaluate(() => window.aioli.state['ui-docks']), saved);
  await drag('dock-move-code', 1190, 300);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'right');
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('aioli.project')).state['ui-docks']?.code?.dock === 'right',
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'right');
  await drag('dock-move-code', 600, 860);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'bottom');
  await click('collapse-code');
  assert.equal(await page.evaluate(() => window.aioli.state['code-collapsed']), true);
  await click('collapse-code');
  assert.equal(await page.evaluate(() => window.aioli.state['code-collapsed']), false);
  await click('view');
  await click('files');
  await drag('dock-move-files', 10, 200);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].files.dock), 'left');
  await click('project');
  await click('canvas-settings');
  await click('canvas-square');
  await click('canvas-apply');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['canvas-width'] === 512,
  );
  await click('about');
  await click('about-aioli');
  await click('close-window');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/components-docking.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await frame();
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  await page.setViewportSize({ width: 1200, height: 900 });
  await frame();
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'bottom');
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Component dialogs, floating minimization/restore, resizing/canceling, edge docking, saved layout and narrow viewport passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
