import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.state['canvas-width'] = 64;
  project.state['canvas-height'] = 64;
  project.files['game.lisp'] = `(defdraw render []
    (pixels [p time] (let [ray (mix (mix [1 0] [-1 0] (step 16 p.x)) (mix [0 1] [0 -1] (step 48 p.x)) (step 32 p.x))
      hit (grid-ray [1.5 1.5] ray ["1111" "1021" "1001" "1111"])]
      (rgb (/ hit.x 2) hit.y (/ hit.z 2))))
    (scope (clip [0 32] [64 32])
      (pixels [p time] (let [hit (grid-ray [1.5 1.5] [1 0] ["1111" "1001" "1001" "1111"])]
        (rgb (/ hit.x 2) hit.y (/ hit.z 2))))))`;
  project.applicationState = {};
  await page.locator('#file-input').setInputFiles({
    name: 'grid-rays.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending && (window.aioli.error || window.aioli.state['canvas-width'] === 64),
  );
  assert.equal(
    await page.evaluate(() => window.aioli.error),
    false,
    await page.evaluate(() => window.aioli.status),
  );
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  }
  await click('file');
  const downloading = page.waitForEvent('download');
  await click('png');
  const downloaded = await downloading;
  const bytes = await readFile(await downloaded.path());
  const samples = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return [
      [8, 8],
      [24, 8],
      [40, 8],
      [56, 8],
      [8, 48],
    ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, Array.from(bytes));
  const expected = [
    [64, 0, 255, 255],
    [64, 0, 128, 255],
    [191, 255, 128, 255],
    [64, 255, 128, 255],
    [191, 0, 128, 255],
  ];
  samples.forEach((sample, i) =>
    sample.forEach((value, c) =>
      assert.ok(Math.abs(value - expected[i][c]) <= 1, `ray ${i} channel ${c}: ${value}`),
    ),
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  console.log(
    'GPU ray distances, horizontal/vertical sides, material IDs and distinct grid helpers verified by PNG readback',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
