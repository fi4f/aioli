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
  const frame = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const region = (id) => page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await region(id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await frame();
  }
  assert.equal(await region('hide-game'), undefined);
  await click('view');
  await click('files');
  await click('folder-examples');
  await click('folder-examples/generators');
  await click('file-examples/generators/image.generator.lisp');
  await page.waitForFunction(() => window.aioli.state['show-generator'] && !window.aioli.pending);
  assert.equal(
    await page.evaluate(() => window.aioli.state['ui-docks'].generator.dock),
    'floating',
  );
  assert.equal(await page.evaluate(() => window.aioli.state.window), '');
  const spawned = await region('pane-generator');
  assert.equal(spawned.origin[0], (1200 - spawned.size[0]) / 2);
  assert.equal(spawned.origin[1], 51 + (819 - spawned.size[1]) / 2);
  assert.equal(
    await page.evaluate(() => window.aioli.state.tab),
    'examples/generators/image.generator.lisp',
  );
  assert.ok(await region('generator-field-image-radius'));
  const header = await region('dock-move-generator'),
    game = await region('pane-game');
  await page.mouse.move(header.origin[0] + 20, header.origin[1] + 10);
  await page.mouse.down();
  await page.mouse.move(game.origin[0] + game.size[0] / 2, game.origin[1] + game.size[1] * 0.7, {
    steps: 10,
  });
  await frame();
  await page.waitForFunction(() => window.aioli.dockPreview?.ready);
  await page.mouse.up();
  await frame();
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].generator.dock), 'split');
  const generator = await region('pane-generator'),
    gameAfter = await region('pane-game');
  assert.equal(generator.origin[1], gameAfter.origin[1] + gameAfter.size[1]);
  await click('generator-field-image-radius');
  assert.notEqual(await page.evaluate(() => window.aioli.state['image-radius']), 48);
  const placement = await page.evaluate(() => window.aioli.state['ui-docks'].generator);
  await click('generator-select');
  await page.waitForFunction(() => !window.aioli.pending);
  await page.waitForFunction(
    () => window.aioli.state.tab === window.aioli.state['active-generator'],
  );
  await frame();
  assert.deepEqual(await page.evaluate(() => window.aioli.state['ui-docks'].generator), placement);
  await click('collapse-generator');
  assert.equal(await page.evaluate(() => window.aioli.state['generator-collapsed']), true);
  await click('collapse-generator');
  assert.equal(await page.evaluate(() => window.aioli.state['generator-collapsed']), false);
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('aioli.project')).state['ui-docks']?.generator?.dock ===
        'split' &&
      JSON.parse(localStorage.getItem('aioli.project')).state.tab === window.aioli.state.tab,
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.ok(await region('pane-generator'));
  assert.equal(
    await page.evaluate(() => window.aioli.state.tab),
    await page.evaluate(() => window.aioli.state['active-generator']),
  );
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].generator.dock), 'split');
  await mkdir('artifacts', { recursive: true });
  await frame();
  await page.screenshot({ path: 'artifacts/docked-generator.png' });
  await click('close-generator');
  assert.equal(await region('pane-generator'), undefined);
  await click('view');
  await click('generators');
  await page.waitForFunction(() => window.aioli.state['show-generator'] && !window.aioli.pending);
  assert.equal(
    await page.evaluate(() => window.aioli.state['ui-docks'].generator.dock),
    'floating',
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Generator file opening, floating inspector, pane split docking, live fields, selection retention, collapse, saved placement and reopening passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
