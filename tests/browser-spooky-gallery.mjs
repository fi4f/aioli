import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticServer } from '../server.js';
import { exportHTML } from '../html-export.js';
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
  await mkdir('artifacts', { recursive: true });
  const errors = [];
  const editor = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1.25,
  });
  editor.on('pageerror', (e) => errors.push(e.message));
  await editor.goto(`http://127.0.0.1:${server.address().port}`);
  await editor.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await editor.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await editor.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await editor.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  }
  await click('view');
  await click('files');
  await click('folder-examples');
  for (const name of [
    'moon-dash',
    'platformer',
    'boo-patrol',
    'raytrace',
    'feedback',
    'plasma',
    'bloom',
  ]) {
    const scene = `examples/${name}.scene.lisp`;
    await click(`play-${scene}`);
    await editor.waitForFunction(
      (scene) => !window.aioli.pending && window.aioli.applicationState['active-scene'] === scene,
      scene,
    );
    await editor.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    assert.equal(
      await editor.evaluate(() => window.aioli.error),
      false,
      await editor.evaluate(() => window.aioli.status),
    );
    const source = await readFile(scene, 'utf8');
    const html = await exportHTML(
      { 'game.lisp': `(start-scene "${scene}")`, [scene]: source },
      {},
      (p) => readFile(p, 'utf8'),
      { 'canvas-width': 320, 'canvas-height': 240 },
    );
    const file = path.resolve(`artifacts/gallery-${name}.html`);
    await writeFile(file, html);
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(
      (scene) => window.aioliApplication?.runtime.state['active-scene'] === scene,
      scene,
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    if (name === 'moon-dash') {
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.aioliApplication.runtime.state['dash-distance'] > 30);
      await page.keyboard.up('Space');
      assert.ok(await page.evaluate(() => window.aioliApplication.runtime.state['dash-y'] < 192));
    }
    assert.equal(await page.locator('#error').textContent(), '');
    await page.screenshot({ path: `artifacts/gallery-${name}.png` });
    await page.close();
    console.log(`${name}: editor play and offline GPU rendering passed`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
