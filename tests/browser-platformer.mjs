import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  }
  await click('view');
  await click('files');
  await click('folder-examples');
  await click('play-examples/platformer.scene.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/platformer.scene.lisp',
  );
  await click('world');
  await page.keyboard.press('F4');
  await page.keyboard.down('d');
  await page.waitForFunction(() => window.aioli.applicationState['peak-x'] > 65);
  await page.keyboard.up('d');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.aioli.applicationState['peak-vy'] < -50);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.aioli.applicationState['peak-grounded']);
  await page.keyboard.down('d');
  await page.keyboard.down('x');
  await page.waitForFunction(() => window.aioli.applicationState['peak-camera'] > 25);
  await page.keyboard.up('d');
  await page.keyboard.up('x');
  assert.equal(
    await page.evaluate(() => window.aioli.error),
    false,
    await page.evaluate(() => window.aioli.status),
  );
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/pocket-peaks.png' });
  await page.keyboard.down('r');
  await page.waitForFunction(() => window.aioli.applicationState['peak-x'] === 32);
  await page.keyboard.up('r');
  await page.keyboard.press('F4');
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.files['game.lisp'] = '(start-scene "examples/platformer.scene.lisp")';
  project.state['project-name'] = 'Pocket Peaks';
  await page.locator('#file-input').setInputFiles({
    name: 'pocket-peaks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['project-name'] === 'Pocket Peaks',
  );
  await click('file');
  const download = page.waitForEvent('download');
  await click('export-html');
  const file = path.resolve('artifacts/pocket-peaks.html');
  await (await download).saveAs(file);
  const offline = await browser.newPage({ viewport: { width: 960, height: 720 } });
  offline.on('pageerror', (error) => errors.push(error.message));
  await offline.goto(pathToFileURL(file).href);
  await offline.waitForFunction(() => window.aioliApplication?.scene);
  assert.equal(await offline.title(), 'Pocket Peaks');
  await offline.keyboard.down('d');
  await offline.waitForFunction(() => window.aioliApplication.runtime.state['peak-x'] > 60);
  await offline.keyboard.up('d');
  assert.equal(await offline.locator('#error').textContent(), '');
  await offline.screenshot({ path: 'artifacts/pocket-peaks-offline.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Pocket Peaks gallery play, movement, jumping, camera scrolling, restart and offline HTML export passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
