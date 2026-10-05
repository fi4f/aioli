import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1.25,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  await click('play-examples/doom.scene.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/doom.scene.lisp',
  );
  await click('world');
  await page.keyboard.press('F4');
  const initial = await page.evaluate(() => window.aioli.applicationState['doom-x']);
  await page.keyboard.down('w');
  await page.waitForFunction((x) => window.aioli.applicationState['doom-x'] > x + 0.4, initial);
  await page.keyboard.up('w');
  const walked = await page.evaluate(() => window.aioli.applicationState['doom-x']);
  await page.keyboard.down('s');
  await page.waitForFunction((x) => window.aioli.applicationState['doom-x'] < x - 0.1, walked);
  await page.keyboard.up('s');
  await page.keyboard.down('q');
  await page.waitForFunction(() => window.aioli.applicationState['doom-angle'] < -0.1);
  await page.keyboard.up('q');
  await page.keyboard.down('r');
  await page.waitForFunction(() => Math.abs(window.aioli.applicationState['doom-angle']) < 0.001);
  await page.keyboard.up('r');
  await page.keyboard.down(' ');
  await page.waitForFunction(() => window.aioli.applicationState['doom-enemy-0-hp'] === 0);
  await page.keyboard.up(' ');
  assert.equal(await page.evaluate(() => window.aioli.applicationState['doom-kills']), 1);
  await page.keyboard.down('r');
  await page.waitForFunction(() => window.aioli.applicationState['doom-kills'] === 0);
  await page.keyboard.up('r');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/tiny-crypt.png' });
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  await page.keyboard.press('F4');
  // Use the actual project export with this scene as the application entry.
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')));
  project.files['game.lisp'] = '(start-scene "examples/doom.scene.lisp")';
  await page.locator('#file-input').setInputFiles({
    name: 'crypt.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/doom.scene.lisp',
  );
  await click('file');
  const downloaded = page.waitForEvent('download');
  await click('export-html');
  const file = path.resolve('artifacts/tiny-crypt.html');
  await (await downloaded).saveAs(file);
  const offline = await browser.newPage({ viewport: { width: 960, height: 720 } });
  offline.on('pageerror', (e) => errors.push(e.message));
  await offline.goto(pathToFileURL(file).href);
  await offline.waitForFunction(() => window.aioliApplication?.scene);
  assert.equal(
    await offline.evaluate(() => window.aioliApplication.runtime.state['active-scene']),
    'examples/doom.scene.lisp',
  );
  await offline.keyboard.down('w');
  await offline.waitForFunction(() => window.aioliApplication.runtime.state['doom-x'] > 1.9);
  await offline.keyboard.up('w');
  await offline.screenshot({ path: 'artifacts/tiny-crypt-export.png' });
  assert.equal(await offline.locator('#error').textContent(), '');
  assert.deepEqual(errors, []);
  console.log('Tiny Crypt editor play, movement, shooting, restart and offline HTML export passed');
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
