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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    assert.ok(r, id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  }
  await click('view');
  await click('files');
  await click('folder-examples');
  await click('play-examples/raytrace.scene.lisp');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['orbit-clock'] > 0.3,
  );
  assert.equal(
    await page.evaluate(() => window.aioli.error),
    false,
    await page.evaluate(() => window.aioli.status),
  );
  await click('world');
  await page.keyboard.press('F4');
  const angle = await page.evaluate(() => window.aioli.applicationState['orbit-angle']);
  await page.keyboard.down('d');
  await page.waitForFunction(
    (angle) => window.aioli.applicationState['orbit-angle'] > angle + 0.1,
    angle,
  );
  await page.keyboard.up('d');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.aioli.applicationState['orbit-frozen']);
  await page.keyboard.up('Space');
  const clock = await page.evaluate(() => window.aioli.applicationState['orbit-clock']);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => window.aioli.applicationState['orbit-clock']), clock);
  await page.keyboard.down('r');
  await page.waitForFunction(() => window.aioli.applicationState['orbit-angle'] === 0.35);
  await page.keyboard.up('r');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/ghost-orbits.png' });
  await page.keyboard.press('F4');
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.files['game.lisp'] = '(start-scene "examples/raytrace.scene.lisp")';
  project.state['project-name'] = 'Ghost Orbits';
  await page.locator('#file-input').setInputFiles({
    name: 'raytrace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/raytrace.scene.lisp',
  );
  await click('file');
  const downloading = page.waitForEvent('download');
  await click('export-html');
  const html = await downloading,
    htmlPath = path.resolve('artifacts/ghost-orbits.html');
  await html.saveAs(htmlPath);
  const offline = await browser.newPage({ viewport: { width: 960, height: 720 } });
  offline.on('pageerror', (error) => errors.push(error.message));
  await offline.goto(pathToFileURL(htmlPath).href);
  await offline.waitForFunction(
    () => window.aioliApplication?.runtime.state['active-scene'] === 'examples/raytrace.scene.lisp',
  );
  assert.equal(await offline.locator('#error').textContent(), '');
  assert.equal(await offline.title(), 'Ghost Orbits');
  await offline.screenshot({ path: 'artifacts/ghost-orbits-offline.png' });
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Ghost Orbits gallery play, GPU compilation, camera, freeze/reset controls and offline export passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
