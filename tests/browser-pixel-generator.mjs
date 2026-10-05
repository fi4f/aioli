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
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  const generatorPath = 'examples/generators/image.generator.lisp';
  project.files[generatorPath] = `(generator :image "Mixed drawing")
(defdraw render []
  (background "#ff0000")
  (scope (clip [0 0] [16 16]) (pixels [p time] (rgb 0 0 1)))
  (fill "#ffffff") (circle [160 120] 20))`;
  project.state['active-generator'] = generatorPath;
  project.state['image-generator-path'] = generatorPath;
  await page.locator('#file-input').setInputFiles({
    name: 'generator.aioli.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.sources['examples/generators/image.generator.lisp'].includes('Mixed drawing'),
  );
  await click('view');
  await click('generators');
  await page.waitForFunction(() => window.aioli.editorState.window === 'generator');
  await mkdir('artifacts', { recursive: true });
  const pngPromise = page.waitForEvent('download');
  await click('generator-export');
  const png = await pngPromise;
  const file = path.resolve('artifacts/pixel-generator.png');
  await png.saveAs(file);
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(file);
  const sample = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return [
      [0, 0],
      [160, 120],
      [300, 220],
    ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, Array.from(bytes));
  assert.deepEqual(sample, [
    [0, 0, 255, 255],
    [255, 255, 255, 255],
    [255, 0, 0, 255],
  ]);
  await page.screenshot({ path: 'artifacts/pixel-generator-editor.png' });
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Unified image generator preview and PNG export contain both CPU shapes and nested GPU pixels.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
