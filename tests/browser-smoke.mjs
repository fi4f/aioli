import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';

const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer({ basePath: '/aioli/' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  page.on('pageerror', (error) => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/aioli/`;
  await page.goto(url);
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.equal(await page.evaluate(() => document.querySelector('canvas').width), 1600);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((region) => region.id === id), id);
    const region = await page.evaluate(
      (id) => window.aioli.regions.find((region) => region.id === id),
      id,
    );
    await page.mouse.click(region.origin[0] + 12, region.origin[1] + 12);
  }
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(
    '(init! :smoke-value 7) (defdraw render [] (background "#a6e22e"))',
  );
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['smoke-value'] === 7,
  );
  await page.reload();
  await page.waitForFunction(
    () => window.aioli?.running && window.aioli.applicationState['smoke-value'] === 7,
  );
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/fullscreen-editor.png' });
  await click('about');
  const popup = page.waitForEvent('popup');
  await click('docs');
  const docs = await popup;
  await docs.waitForLoadState();
  assert.equal(new URL(docs.url()).pathname, '/aioli/docs/');
  await docs.getByRole('link', { name: 'Architecture', exact: true }).click();
  assert.equal(new URL(docs.url()).pathname, '/aioli/docs/architecture.html');
  await docs.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('canvas').width === 488);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/fullscreen-mobile.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Fractional DPI, live evaluation, persistence, nested hosting, docs navigation and narrow layout passed.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
