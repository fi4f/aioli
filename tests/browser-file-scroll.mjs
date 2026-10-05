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

  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')));
  const names = Array.from(
    { length: 50 },
    (_, i) => `long-${String(i).padStart(2, '0')}-${'filename'.repeat(8)}.lisp`,
  );
  for (const name of names) project.files[name] = '; scrolling sample';
  project.state = { 'show-files': true, 'open-folders': '[]', 'show-code': true, 'file-offset': 0 };
  await page.locator('#file-input').setInputFiles({
    name: 'scroll.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending && window.aioli.regions.some((r) => r.id === 'files-horizontal-scroll'),
  );
  const tree = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'files-tree'));
  await page.mouse.move(tree.origin[0] + 50, tree.origin[1] + 50);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => window.aioli.state['file-offset'] > 0);
  const vertical = await page.evaluate(() => window.aioli.state['file-offset']);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 180);
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => window.aioli.state['file-scroll-x'] > 0);
  assert.equal(await page.evaluate(() => window.aioli.state['file-offset']), vertical);
  const horizontal = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'files-horizontal-scroll'),
  );
  await page.mouse.move(horizontal.origin[0] + 10, horizontal.origin[1] + 6);
  await page.mouse.down();
  await page.mouse.move(horizontal.origin[0] + horizontal.size[0] - 5, horizontal.origin[1] + 6, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(() => window.aioli.state['file-scroll-x'] > 250);
  const scrollbar = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'files-scroll'),
  );
  await page.mouse.click(scrollbar.origin[0] + 4, scrollbar.origin[1] + scrollbar.size[1] - 4);
  await page.waitForFunction(
    (name) => window.aioli.regions.some((r) => r.id === 'file-' + name),
    names.at(-1),
  );
  const before = await page.evaluate(() => ({
    x: window.aioli.state['file-scroll-x'],
    y: window.aioli.state['file-offset'],
  }));
  await click('collapse-files');
  await click('collapse-files');
  assert.deepEqual(
    await page.evaluate(() => ({
      x: window.aioli.state['file-scroll-x'],
      y: window.aioli.state['file-offset'],
    })),
    before,
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/file-pane-scrolling.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Files pane vertical/horizontal wheel scrolling, draggable scrollbars, final-row reachability and collapse restoration passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
