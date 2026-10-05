import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  for (const density of [1, 1.25, 1.5, 1.75, 2]) {
    const context = await browser.newContext({
      viewport: { width: 803, height: 601 },
      deviceScaleFactor: density,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    try {
      await page.waitForFunction(() => window.aioli?.running, null, { timeout: 10000 });
    } catch (error) {
      console.log(
        await page.evaluate(() => ({
          status: window.aioli?.status,
          startup: document.querySelector('#startup').textContent,
        })),
      );
      throw error;
    }
    const size = await page.locator('#app').evaluate((canvas) => [canvas.width, canvas.height]);
    assert.deepEqual(size, [Math.round(803 * density), Math.round(601 * density)]);
    const button = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'view'));
    await page.mouse.click(
      button.origin[0] + button.size[0] / 2,
      button.origin[1] + button.size[1] / 2,
    );
    await page.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'commands'));
    const files = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'files'));
    await page.mouse.click(files.origin[0] + 12, files.origin[1] + 12);
    await page.waitForFunction(() => window.aioli.commands.some((c) => c.meta[0] === 7));
    assert.ok(
      await page.evaluate(() =>
        window.aioli.commands
          .filter((c) => c.meta[0] === 7)
          .every((c) => c.bounds[2] === 16 && c.bounds[3] === 16),
      ),
    );
    const examples = await page.evaluate(() =>
      window.aioli.regions.find((r) => r.id === 'folder-examples'),
    );
    await page.mouse.click(examples.origin[0] + 70, examples.origin[1] + 12);
    await page.waitForFunction(() =>
      ['file-game.lisp', 'file-main.lisp', 'file-examples/garden.scene.lisp'].every((id) => {
        const row = window.aioli.regions.find((r) => r.id === id);
        return (
          row &&
          window.aioli.commands.some(
            (c) =>
              c.meta[0] === 7 &&
              c.bounds[0] === row.origin[0] + 14 + (id.includes('examples/') ? 14 : 0) &&
              c.bounds[1] === row.origin[1] + 5,
          )
        );
      }),
    );
    const specialColors = await page.evaluate(() =>
      ['file-game.lisp', 'file-main.lisp'].map((id) => {
        const row = window.aioli.regions.find((r) => r.id === id);
        return window.aioli.commands.find(
          (c) =>
            c.meta[0] === 7 &&
            c.bounds[0] === row.origin[0] + 14 &&
            c.bounds[1] === row.origin[1] + 5,
        ).color;
      }),
    );
    assert.ok(
      specialColors.every((c) => c[0] === 187 / 255 && c[1] === 214 / 255 && c[2] === 166 / 255),
    );
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => window.aioli.error), false);
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: `artifacts/display-${density}.png` });
    // Exercise a density change without recreating the engine.
    await page.evaluate(() =>
      Object.defineProperty(window, 'devicePixelRatio', { value: 1.5, configurable: true }),
    );
    await page.waitForFunction(
      () => document.querySelector('#app').width === Math.round(803 * 1.5),
    );
    assert.equal(await page.evaluate(() => window.aioli.running), true);
    await context.close();
    console.log(`Display ${density}: canvas, GPU, pointer alignment and density change passed`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
