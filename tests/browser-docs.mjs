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
    viewport: { width: 1280, height: 900 },
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

  const url = `http://127.0.0.1:${server.address().port}/project/docs/`;
  await mkdir('artifacts', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const file of [
      '',
      'editor.html',
      'projects.html',
      'api.html',
      'language.html',
      'contributing.html',
    ]) {
      await page.goto(url + file);
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'rgb(16, 22, 19)',
      );
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${file} overflows at ${width}`,
      );
    }
    await page.goto(url + 'projects.html#text-generators');
    await page.screenshot({ path: `artifacts/docs-text-generators-${width}.png` });
    await page.goto(url);
    await page.screenshot({ path: `artifacts/docs-index-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(
    'All documentation pages use the editor theme, fit desktop/mobile viewports, and render text generator guides',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
