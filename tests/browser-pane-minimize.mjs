import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer();
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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  const placement = {
    _tree: {
      axis: 'x',
      ratio: 0.23,
      first: 'files',
      second: { axis: 'y', ratio: 0.6, first: 'game', second: 'code' },
    },
    files: { dock: 'left', extent: 276 },
    code: { dock: 'split', target: 'game' },
    inspector: { dock: 'floating', x: 700, y: 130, width: 350, height: 320, z: 1 },
  };
  Object.assign(project.state, { 'show-files': true, 'show-tools': true, 'ui-docks': placement });
  await page.locator('#file-input').setInputFiles({
    name: 'minimize.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(() => !window.aioli.pending && window.aioli.state['show-files']);
  const region = (id) => page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
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
  const initial = await region('pane-code');
  await click('collapse-code');
  assert.equal((await region('pane-code')).origin[1], 836);
  assert.equal((await region('pane-code')).size[1], 34);
  assert.equal(await region('dock-move-code'), undefined);
  await click('collapse-files');
  assert.equal((await region('pane-files')).origin[1], 836);
  assert.equal((await region('pane-game')).size[0], 1200);
  await click('collapse-inspector');
  assert.equal((await region('pane-inspector')).size[1], 34);
  assert.equal((await region('pane-inspector')).origin[1], 836);
  assert.equal(await region('dock-move-inspector'), undefined);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/minimized-panes.png' });
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('aioli.project')).state['files-collapsed'] &&
      JSON.parse(localStorage.getItem('aioli.project')).state['code-collapsed'],
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal((await region('pane-code')).origin[1], 836);
  await click('restore-files');
  await click('collapse-code');
  await click('restore-inspector');
  const restored = await region('pane-code');
  assert.deepEqual([restored.origin, restored.size], [initial.origin, initial.size]);
  assert.deepEqual(await page.evaluate(() => window.aioli.state['ui-docks']), placement);
  await click('close-code');
  assert.equal(await region('pane-code'), undefined);
  await click('view');
  await click('code');
  assert.ok(await region('pane-code'));
  await click('collapse-code');
  await click('close-code');
  assert.equal(await region('pane-code'), undefined);
  assert.equal(await region('restore-code'), undefined);
  await click('close-inspector');
  assert.equal(await region('pane-inspector'), undefined);
  await click('close-files');
  await click('close-game');
  assert.equal(await region('pane-files'), undefined);
  assert.equal(await region('pane-game'), undefined);
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Nested dock minimization, bottom tabs, floating minimization, saved restoration, and closing docked/floating/minimized panes passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
