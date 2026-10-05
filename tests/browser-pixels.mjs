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
  const source = `(init! :red 0.2 ["Red" 0 1 0.1])
(defdraw glow [red] ["Glow" [0.25] [96 64]]
  (pixels [p time] (rgba red 0 0 0.5)))
(defdraw halo []
  (pixels [p time] (fill (rgba 0.2 0 0 0.5)) (rect [0 0] [width height])))
(defdraw stripe []
  (pixels [p time] (rgb 0 (/ p.y height) 0)))
(defdraw render []
  (background "#000000")
  (scope (clip [0 0] [48 64]) (glow (get :red)))
  (scope (clip [48 0] [48 64]) (glow 0.8))
  (fill "#000000") (rect [0 40] [96 8])
  (scope (clip [0 40] [96 8]) (halo))
  (scope (clip [0 56] [96 8]) (stripe))
  (fill "#0000ff") (rect [10 10] [8 8]))`;
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.files['game.lisp'] = source;
  project.state['canvas-width'] = 96;
  project.state['canvas-height'] = 64;
  project.applicationState = {};
  await page.locator('#file-input').setInputFiles({
    name: 'pixels.aioli.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState.red === 0.2,
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(
    await page.evaluate(() =>
      window.aioli.commands.filter((c) => c.meta[0] === 8).map((c) => c.pixel.values),
    ),
    [{ capture0: 0.2 }, { capture0: 0.8 }, {}, {}],
  );
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/nested-pixels.png' });
  await click('file');
  const pngPromise = page.waitForEvent('download');
  await click('png');
  const png = await pngPromise;
  const pngPath = path.resolve('artifacts/nested-pixels.png.export.png');
  await png.saveAs(pngPath);
  const { readFile } = await import('node:fs/promises');
  const pngBytes = await readFile(pngPath);
  const samples = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return {
      width: image.width,
      height: image.height,
      colors: [
        [30, 30],
        [60, 30],
        [12, 12],
        [30, 60],
        [30, 44],
      ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)),
    };
  }, Array.from(pngBytes));
  assert.equal(samples.width, 96);
  assert.equal(samples.height, 64);
  assert.ok(Math.abs(samples.colors[0][0] - 26) <= 1);
  assert.ok(Math.abs(samples.colors[1][0] - 102) <= 1);
  assert.deepEqual(samples.colors[2], [0, 0, 255, 255]);
  assert.equal(samples.colors[3][0], 0);
  assert.ok(Math.abs(samples.colors[3][1] - 239) <= 2);
  assert.ok(
    Math.abs(samples.colors[4][0] - 26) <= 1,
    'pixel drawing commands preserve straight alpha',
  );
  await click('inspect-hook-glow');
  await page.waitForFunction(() => window.aioli.hookPreview?.name === 'glow');
  assert.equal(
    await page.evaluate(() => window.aioli.hookPreview.commands[0].pixel.values.capture0),
    0.25,
  );
  assert.deepEqual(
    await page.evaluate(() => window.aioli.hookPreview.commands[0].detail.slice(0, 2)),
    [96, 64],
  );
  await click('close-window');
  // A rejected CPU side effect leaves the previous running composition intact.
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source.replace('(rgba red 0 0 0.5)', '(set! :red 999)'));
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.match(await page.evaluate(() => window.aioli.status), /CPU operation/);
  assert.equal(await page.evaluate(() => window.aioli.applicationState.red), 0.2);
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !window.aioli.pending && !window.aioli.error);
  await click('file');
  const htmlPromise = page.waitForEvent('download');
  await click('export-html');
  const html = await htmlPromise;
  const htmlPath = path.resolve('artifacts/nested-pixels.html');
  await html.saveAs(htmlPath);
  const offline = await browser.newPage({ viewport: { width: 800, height: 600 } });
  offline.on('pageerror', (e) => errors.push(e.message));
  await offline.goto(pathToFileURL(htmlPath).href);
  await offline.waitForFunction(() => window.aioliApplication?.runtime.state.red === 0.2);
  assert.equal(await offline.locator('#error').textContent(), '');
  // Verify actual exported canvas pixels, rather than only its state.
  await offline.screenshot({ path: 'artifacts/nested-pixels-offline.png' });
  const { PNG } = require(
    `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs`,
  );
  const screenshot = PNG.sync.read(await offline.screenshot());
  const surface = await offline.evaluate(() => window.aioliApplication.surface);
  const pixel = (x, y) => {
    const sx = Math.floor(surface.origin[0] + x * surface.scale),
      sy = Math.floor(surface.origin[1] + y * surface.scale);
    return Array.from(
      screenshot.data.slice((sy * screenshot.width + sx) * 4, (sy * screenshot.width + sx) * 4 + 4),
    );
  };
  assert.ok(Math.abs(pixel(30, 30)[0] - 26) <= 1);
  assert.ok(Math.abs(pixel(60, 30)[0] - 102) <= 1);
  assert.deepEqual(pixel(12, 12), [0, 0, 255, 255]);
  await page.reload();
  await page.waitForFunction(
    () => window.aioli?.running && window.aioli.applicationState.red === 0.2,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Nested GPU pixels: independent uniforms, painter order, alpha, clipping, preview, rejected side effects, PNG composition, offline export and reload passed.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
