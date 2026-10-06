import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer({ basePath: '/project/' });
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
  await page.goto(`http://127.0.0.1:${server.address().port}/project/`);
  await page.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  async function replaceGame(text) {
    await click('source');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
  }
  const original = await page.evaluate(() => window.aioli.sources.game);
  await click('project');
  assert.equal(
    await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'auto-evaluate').checked),
    true,
  );
  await click('auto-evaluate');
  await page.waitForFunction(() => window.aioli.state['auto-evaluate'] === false);
  await replaceGame(original + '\n(init! :auto-probe 1)');
  await page.waitForTimeout(850);
  assert.equal(await page.evaluate(() => window.aioli.applicationState['auto-probe']), undefined);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['auto-probe'] === 1,
  );
  await replaceGame(original + '\n(init! :auto-probe 1) (set! :auto-probe 2)');
  await click('project');
  await click('auto-evaluate');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['auto-probe'] === 2,
  );
  await replaceGame(original + '\n(init! :auto-probe 1) (set! :auto-probe 3)');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['auto-probe'] === 3,
  );
  // Disable while the 500ms debounce is still pending.
  await replaceGame(original + '\n(init! :auto-probe 1) (set! :auto-probe 4)');
  await click('project');
  await click('auto-evaluate');
  await page.waitForFunction(() => window.aioli.state['auto-evaluate'] === false);
  await page.waitForTimeout(850);
  assert.equal(await page.evaluate(() => window.aioli.applicationState['auto-probe']), 3);
  await click('view');
  await click('files');
  await click('play-main.lisp');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['auto-probe'] === 4,
  );
  // Editing during a manual compile invalidates it without leaving pending stuck.
  await replaceGame(original + '\n(init! :auto-probe 1) (set! :auto-probe 5)');
  await page.evaluate(async () => {
    const { GPUHost } = await import('./gpu.js');
    const prepare = GPUHost.prototype.preparePixels;
    const gate = new Promise((resolve) => {
      window.releaseCompile = resolve;
    });
    GPUHost.prototype.preparePixels = async function (shader) {
      await gate;
      return prepare.call(this, shader);
    };
    window.restoreCompile = () => {
      GPUHost.prototype.preparePixels = prepare;
    };
  });
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.aioli.pending);
  await replaceGame(original + '\n(init! :auto-probe 1) (set! :auto-probe 6)');
  assert.equal(await page.evaluate(() => window.aioli.pending), false);
  await page.evaluate(() => {
    window.restoreCompile();
    window.releaseCompile();
  });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.aioli.applicationState['auto-probe']), 4);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['auto-probe'] === 6,
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(await page.evaluate(() => window.aioli.state['auto-evaluate']), false);
  await click('project');
  assert.equal(
    await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'auto-evaluate').checked),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Automatic evaluation default, checkbox toggle, pending debounce cancellation, manual keyboard/main execution and persistence passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
