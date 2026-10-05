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
    viewport: { width: 1200, height: 900 },
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
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard
    .insertText(`(defn update [dt] (set! :cw (canvas-width)) (set! :ch (canvas-height)))
(defn draw [] (fill "#ff0000") (circle [(/ (canvas-width) 2) (/ (canvas-height) 2)] 12))
(defpixel render [p time] (background "#272822") (fill "#66d9ef") (rect [(- width 10) 0] [10 height]))`);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState.cw === 320,
  );
  await click('project');
  await click('canvas-settings');
  await click('canvas-wide');
  // Custom odd dimensions test texture readback row padding as well as text input.
  const inputRegion = await page.evaluate(() =>
    window.aioli.regions.filter((r) => r.id === 'source').at(-1),
  );
  await page.mouse.click(inputRegion.origin[0] + 60, inputRegion.origin[1] + 12);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('641 359');
  await click('canvas-apply');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState.cw === 641 &&
      window.aioli.state.window === '',
  );
  assert.equal(await page.evaluate(() => window.aioli.applicationState.ch), 359);
  const region = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'world'));
  assert.ok(Math.abs(region.size[0] / region.size[1] - 641 / 359) < 1e-6);
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/canvas-size.png' });
  await click('file');
  const pngPromise = page.waitForEvent('download');
  await click('png');
  const png = await pngPromise;
  const pngPath = path.resolve('artifacts/custom-canvas.png');
  await png.saveAs(pngPath);
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(pngPath);
  assert.equal(bytes.readUInt32BE(16), 641);
  assert.equal(bytes.readUInt32BE(20), 359);
  await click('file');
  const htmlPromise = page.waitForEvent('download');
  await click('export-html');
  const html = await htmlPromise;
  const htmlPath = path.resolve('artifacts/custom-canvas.html');
  await html.saveAs(htmlPath);
  const offline = await browser.newPage({ viewport: { width: 1000, height: 400 } });
  offline.on('pageerror', (e) => errors.push(e.message));
  await offline.goto(pathToFileURL(htmlPath).href);
  await offline.waitForFunction(() => window.aioliApplication?.runtime.state.cw === 641);
  assert.equal(await offline.evaluate(() => window.aioliApplication.runtime.state.ch), 359);
  for (const viewport of [
    { width: 400, height: 1000 },
    { width: 1000, height: 400 },
  ]) {
    await offline.setViewportSize(viewport);
    const size = await offline.evaluate(() => window.aioliApplication.surface.size);
    assert.ok(Math.abs(size[0] / size[1] - 641 / 359) < 1e-6);
  }
  assert.equal(await offline.locator('#error').textContent(), '');
  await page.reload();
  await page.waitForFunction(
    () => window.aioli?.running && window.aioli.applicationState.cw === 641,
  );
  await click('project');
  await click('canvas-settings');
  const invalidInput = await page.evaluate(() =>
    window.aioli.regions.filter((r) => r.id === 'source').at(-1),
  );
  await page.mouse.click(invalidInput.origin[0] + 60, invalidInput.origin[1] + 12);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('0 359');
  await click('canvas-apply');
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.equal(await page.evaluate(() => window.aioli.applicationState.cw), 641);
  assert.equal(await page.evaluate(() => window.aioli.editorState['canvas-width']), 641);
  assert.match(await page.evaluate(() => window.aioli.status), /whole numbers/);
  await click('close-window');
  await click('file');
  await click('new-project');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.editorState['canvas-width'] === 320,
  );
  assert.equal(await page.evaluate(() => window.aioli.editorState['canvas-height']), 240);
  assert.deepEqual(errors, []);
  console.log(
    'Canvas custom size, input, preview, PNG padding, offline export, aspect ratio and reload passed.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
