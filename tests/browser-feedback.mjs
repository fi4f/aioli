import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
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
  const page = await browser.newPage({ deviceScaleFactor: 1.25 });
  await page.goto(`http://127.0.0.1:${server.address().port}/docs/`);
  const result = await page.evaluate(async () => {
    const { GPUHost } = await import('/gpu.js');
    const { DrawList } = await import('/drawing.js');
    const { engineServices } = await import('/engine-services.js');
    const { parse } = await import('/lisp.js');
    const errors = [];
    const gpu = await GPUHost.create(document.createElement('canvas'), (message) =>
      errors.push(message),
    );
    function target(width, height) {
      return gpu.device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
    async function sample(texture, x = 0, y = 0) {
      const buffer = gpu.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = gpu.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture, origin: [x, y] },
        { buffer, bytesPerRow: 256 },
        [1, 1],
      );
      gpu.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const pixel = [...new Uint8Array(buffer.getMappedRange()).slice(0, 4)];
      buffer.unmap();
      buffer.destroy();
      return pixel;
    }
    const code = `(init! :mark true)
      (defdraw render []
        (pixels [p time] (let [old (previous-pixel p)] (rgba (+ old.x 0.125) old.y old.z 1)))
        (when (get :mark) (fill "#00ff00") (rect [2 2] [1 1])))`;
    const runtime = engineServices().create({});
    runtime.load(parse(code));
    const output = target(63, 17);
    await gpu.preparePixels(runtime.drawFrame(63, 17), 'rgba8unorm');
    gpu.draw(runtime.drawFrame(63, 17), 0, output);
    const first = await sample(output);
    runtime.state.mark = false;
    gpu.draw(runtime.drawFrame(63, 17), 1, output);
    const second = await sample(output);
    const cpuHistory = await sample(output, 2, 2);
    await gpu.snapshot(runtime.drawFrame(63, 17), 2);
    gpu.draw(runtime.drawFrame(63, 17), 2, output);
    const afterSnapshot = await sample(output);
    const host = new DrawList(126, 17);
    host.rasterComposite(runtime.drawFrame(63, 17), [0, 0], [63, 17]);
    host.rasterComposite(runtime.drawFrame(63, 17), [63, 0], [63, 17]);
    const hostOutput = target(126, 17);
    await gpu.preparePixels(host, 'rgba8unorm');
    gpu.draw(host, 3, hostOutput);
    const duplicate = [await sample(hostOutput), await sample(hostOutput, 63, 0)];
    gpu.draw(runtime.drawFrame(63, 17), 4, output);
    const afterDuplicate = await sample(output);
    const paused = runtime.drawFrame(63, 17);
    paused.historyAdvance = false;
    gpu.draw(paused, 5, output);
    const pausedFrame = await sample(output);
    gpu.draw(runtime.drawFrame(63, 17), 6, output);
    const resumedFrame = await sample(output);
    const a = engineServices().create({ mark: false });
    a.load(parse(code));
    const b = engineServices().create({});
    b.load(
      parse(
        '(defdraw render [] (pixels [p time] (let [old (previous-pixel p)] (rgba 0 (+ old.y 0.25) 0 1))))',
      ),
    );
    const wrap = (runtime) => {
      const list = new DrawList(63, 17);
      list.rasterComposite(runtime.drawFrame(63, 17), [0, 0], [63, 17]);
      return list;
    };
    const nestedHost = new DrawList(126, 17);
    nestedHost.rasterComposite(wrap(a), [0, 0], [63, 17]);
    nestedHost.rasterComposite(wrap(b), [63, 0], [63, 17]);
    await gpu.preparePixels(nestedHost, 'rgba8unorm');
    gpu.draw(nestedHost, 0, hostOutput);
    gpu.draw(nestedHost, 1, hostOutput);
    const nested = [await sample(hostOutput), await sample(hostOutput, 63, 0)];
    const resized = target(64, 18);
    gpu.draw(runtime.drawFrame(64, 18), 5, resized);
    const resize = await sample(resized);
    const replacement = engineServices().create({});
    replacement.load(parse(code));
    gpu.draw(replacement.drawFrame(63, 17), 6, output);
    const restarted = await sample(output);
    replacement.load(parse('(defdraw render [] (background "#0000ff"))'));
    gpu.draw(replacement.drawFrame(63, 17), 7, output);
    replacement.state.mark = false;
    replacement.load(parse(code));
    gpu.draw(replacement.drawFrame(63, 17), 8, output);
    const afterPlainFrame = await sample(output);
    // Initial alpha is zero and coordinates outside the logical canvas return zero.
    const probe = engineServices().create({});
    probe.load(
      parse(`(defdraw render [] (pixels [p time]
      (let [a (previous-pixel p) b (previous-pixel [-1 0]) c (previous-pixel [width height])]
        (rgb a.w b.w c.w))))`),
    );
    await gpu.preparePixels(probe.drawFrame(63, 17), 'rgba8unorm');
    gpu.draw(probe.drawFrame(63, 17), 0, output);
    const initialAlpha = await sample(output);
    gpu.draw(probe.drawFrame(63, 17), 1, output);
    const bounds = await sample(output);
    await gpu.device.queue.onSubmittedWorkDone();
    output.destroy();
    hostOutput.destroy();
    resized.destroy();
    return {
      first,
      second,
      cpuHistory,
      afterSnapshot,
      duplicate,
      afterDuplicate,
      resize,
      restarted,
      initialAlpha,
      bounds,
      nested,
      pausedFrame,
      resumedFrame,
      afterPlainFrame,
      errors,
    };
  });
  assert.deepEqual(result.first, [32, 0, 0, 255]);
  assert.deepEqual(result.second, [64, 0, 0, 255]);
  assert.deepEqual(result.cpuHistory, [32, 255, 0, 255]);
  assert.deepEqual(result.afterSnapshot, [96, 0, 0, 255]);
  assert.deepEqual(result.duplicate, [
    [128, 0, 0, 255],
    [128, 0, 0, 255],
  ]);
  assert.deepEqual(result.afterDuplicate, [160, 0, 0, 255]);
  assert.deepEqual(result.pausedFrame, result.resumedFrame);
  assert.deepEqual(result.nested, [
    [64, 0, 0, 255],
    [0, 128, 0, 255],
  ]);
  assert.deepEqual(result.resize, result.first);
  assert.deepEqual(result.restarted, result.first);
  assert.deepEqual(result.initialAlpha, [0, 0, 0, 255]);
  assert.deepEqual(result.bounds, [255, 0, 0, 255]);
  assert.deepEqual(result.afterPlainFrame, [32, 0, 255, 255]);
  assert.deepEqual(result.errors, []);

  await mkdir('artifacts', { recursive: true });
  const feedback = `(init! :ticks 0) (defn update [dt] (set! :ticks (+ (get :ticks) 1)))
    (defdraw render [] (pixels [p time] (let [old (previous-pixel p)] (rgba (+ old.x 0.02) 0 0 1))))`;
  const html = await exportHTML(
    {
      'game.lisp': feedback,
      'green.scene.lisp':
        '(defdraw render [] (pixels [p time] (let [old (previous-pixel p)] (rgba 0 (+ old.y 0.02) 0 1))))',
    },
    {},
    (name) => readFile(new URL('../' + name, import.meta.url), 'utf8'),
    { 'canvas-width': 64, 'canvas-height': 48 },
  );
  const filename = path.resolve('artifacts/feedback-export.html');
  await writeFile(filename, html);
  const offline = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await offline.goto(pathToFileURL(filename).href);
  await offline.waitForFunction(() => window.aioliApplication?.runtime.state.ticks > 8);
  async function center() {
    const png = [...(await offline.screenshot())];
    return offline.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data];
    }, png);
  }
  const red = await center();
  assert.ok(red[0] > 20 && red[1] === 0);
  await offline.evaluate(() =>
    window.aioliApplication.runtime.global['start-scene']('green.scene.lisp'),
  );
  await offline.waitForFunction(() => window.aioliApplication.scene?.path === 'green.scene.lisp');
  const green = await center();
  assert.ok(green[0] === 0 && green[1] > 0);
  await offline.setViewportSize({ width: 800, height: 300 });
  const afterResize = await center();
  assert.ok(afterResize[1] >= green[1]);
  assert.equal(await offline.locator('#error').textContent(), '');
  await offline.screenshot({ path: 'artifacts/feedback-export.png' });
  const editor = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await editor.goto(`http://127.0.0.1:${server.address().port}`);
  await editor.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await editor.waitForFunction(
      (id) => window.aioli.regions.some((region) => region.id === id),
      id,
    );
    const region = await editor.evaluate(
      (id) => window.aioli.regions.find((region) => region.id === id),
      id,
    );
    await editor.mouse.click(
      region.origin[0] + region.size[0] / 2,
      region.origin[1] + region.size[1] / 2,
    );
  }
  await click('view');
  await click('files');
  await click('folder-examples');
  await click('play-examples/feedback.scene.lisp');
  await editor.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/feedback.scene.lisp' &&
      window.aioli.applicationState['trail-clock'] > 0.3,
  );
  assert.equal(await editor.evaluate(() => window.aioli.error), false);
  await editor.keyboard.press('F4');
  await editor.waitForFunction(() => window.aioli.editorState['preview-focused']);
  await editor.screenshot({ path: 'artifacts/feedback-example.png' });
  console.log(
    'GPU feedback: full composition, RGBA components, bounds, private canvases, duplicate views, resize/restart reset, non-mutating PNG export and offline scenes passed.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
