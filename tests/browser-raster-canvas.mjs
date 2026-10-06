import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
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
  const page = await browser.newPage({ deviceScaleFactor: 1.25 });
  await page.goto(`http://127.0.0.1:${server.address().port}/docs/`);
  const result = await page.evaluate(async () => {
    const { GPUHost } = await import('/gpu.js');
    const { DrawList } = await import('/drawing.js');
    const { engineServices } = await import('/engine-services.js');
    const { parse } = await import('/lisp.js');
    const canvas = document.createElement('canvas');
    const errors = [];
    const gpu = await GPUHost.create(canvas, (message) => errors.push(message));
    async function pixels(blob) {
      const bitmap = await createImageBitmap(blob);
      const target = document.createElement('canvas');
      target.width = bitmap.width;
      target.height = bitmap.height;
      const context = target.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context.getImageData(0, 0, target.width, target.height).data;
    }
    const runtime = engineServices({ size: () => [64, 64] }).create({});
    runtime.load(
      parse(`(defdraw render []
      (background "#112233")
      (pixels [p time] (rgba (/ p.x 64) (/ p.y 64) 0 0.5))
      (fill "#ffffff") (circle [32 32] 20)
      (scope (clip [0 0] [32 64]) (opacity 0.5)
        (fill "#ff0000") (line [0 0] [64 64] 2))
      (text [4 2] "Hi"))`),
    );
    const game = runtime.drawFrame(64, 64);
    const reference = await pixels(await gpu.snapshot(game));
    const host = new DrawList(512, 512);
    host.rasterComposite(game, [0, 0], [512, 512]);
    const enlarged = await pixels(await gpu.snapshot(host));
    let mismatches = 0;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++)
        for (let channel = 0; channel < 4; channel++)
          if (
            enlarged[(y * 512 + x) * 4 + channel] !==
            reference[(Math.floor(y / 8) * 64 + Math.floor(x / 8)) * 4 + channel]
          )
            mismatches++;
    await gpu.preparePixels(host);
    gpu.draw(host, 0);
    await gpu.device.queue.onSubmittedWorkDone();
    return {
      mismatches,
      errors,
      size: gpu.surfaceTextures[0].size,
      physicalSize: [canvas.width, canvas.height],
      glyphAtlases: gpu.glyphAtlases.size,
    };
  });
  assert.equal(result.mismatches, 0, 'every enlarged block must match one logical pixel');
  assert.deepEqual(result.size, [64, 64, 1]);
  assert.deepEqual(result.physicalSize, [640, 640]);
  assert.equal(result.glyphAtlases, 2);
  assert.deepEqual(result.errors, []);
  console.log(
    '64x64 GPU buffer, exact nearest pixel enlargement, CPU/pixel composition and display density passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
