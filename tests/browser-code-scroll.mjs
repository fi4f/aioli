import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createStaticServer } from '../server.js';

const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer({ basePath: '/project/' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1500 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/project/`);
  await page.waitForFunction(() => window.aioli?.running);
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  const text = Array.from({ length: 400 }, (_, row) =>
    row < 70 ? `; row ${row}` : `(defn row-${row} [] (+ ${'1 '.repeat(100)}))`,
  ).join('\n');
  project.files['large.lisp'] = text;
  project.state = {
    'show-code': true,
    'open-tabs': ['main', 'game', 'large.lisp'],
    tab: 'large.lisp',
  };
  await page.locator('#file-input').setInputFiles({
    name: 'large.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state.tab === 'large.lisp',
  );
  await page.waitForFunction(() =>
    document.querySelector('#text-input').value.startsWith('; row 0'),
  );
  const source = await page.evaluate(() =>
    window.aioli.regions.find((region) => region.id === 'source'),
  );
  await page.mouse.move(source.origin[0] + 50, source.origin[1] + 50);
  for (let i = 0; i < 35; i++) {
    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(
      await page.evaluate(() => window.aioli.running),
      true,
      await page.evaluate(() => window.aioli.status),
    );
  }
  await page.mouse.click(source.origin[0] + 40, source.origin[1] + 2);
  const selection = await page.locator('#text-input').evaluate((input) => input.selectionStart);
  assert.ok(selection > text.indexOf('(defn row-70'), 'wheel scroll reaches the dense source');
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log('Large source wheel scrolling, dense highlighting and pointer selection passed');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
