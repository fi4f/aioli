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
  let diskBytes = await readFile('editor/icon/code.png');
  let missing = false;
  let reads = 0;
  await page.route('**/editor/icon/code.png', (route) => {
    reads++;
    return route.fulfill({
      status: missing ? 404 : 200,
      contentType: 'image/png',
      body: missing ? Buffer.alloc(0) : diskBytes,
    });
  });
  const initial = await page.evaluate(() => window.aioli.resources);
  assert.equal(Object.keys(initial).filter((p) => p.startsWith('editor/icon/')).length, 16);
  await click('view');
  await click('files');
  await click('folder-editor');
  await click('folder-editor/icon');
  await click('file-editor/icon/code.png');
  await page.waitForFunction(() => window.aioli.preview.ready);
  assert.equal(await page.evaluate(() => window.aioli.preview.width), 64);
  assert.equal(await page.evaluate(() => window.aioli.state.window), 'image-asset');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/editor-icon-resource.png' });
  await click('close-window');
  // Simulate editing disk files without changing the user's PNGs.
  diskBytes = await readFile('editor/icon/play.png');
  const changedData = 'data:image/png;base64,' + diskBytes.toString('base64');
  await page.waitForFunction(
    (data) => window.aioli.resources['editor/icon/code.png'].data === data,
    changedData,
  );
  assert.ok(reads > 0);
  await click('file-editor/icon/code.png');
  await page.waitForFunction(() => window.aioli.preview.ready);
  assert.equal(await page.evaluate(() => window.aioli.preview.status), '');
  missing = true;
  await page.waitForFunction(() => window.aioli.resources['editor/icon/code.png'].sourceMissing);
  await page.waitForFunction(() => !window.aioli.preview.ready);
  missing = false;
  await page.waitForFunction(() => !window.aioli.resources['editor/icon/code.png'].sourceMissing);
  await page.waitForFunction(() => window.aioli.preview.ready);
  await click('close-window');
  await click('folder-editor');
  await page.route('**/editor/icon/main.png', (route) => route.fulfill({ status: 404, body: '' }));
  await page.waitForFunction(() => window.aioli.resources['editor/icon/main.png'].sourceMissing);
  await page.waitForFunction(() => {
    const row = window.aioli.regions.find((r) => r.id === 'file-main.lisp');
    return (
      row &&
      window.aioli.commands.some(
        (c) =>
          c.meta[0] === 3 &&
          c.bounds[0] === row.origin[0] + 18 &&
          c.bounds[1] === row.origin[1] + 5 &&
          c.detail[0] === 120 &&
          c.detail[1] === 18,
      )
    );
  });
  // New Project must fetch now, independently of the polling timer or saved copies.
  diskBytes = await readFile('editor/icon/scene.png');
  const newData = 'data:image/png;base64,' + diskBytes.toString('base64');
  await page
    .locator('#open-file-input')
    .setInputFiles({ name: 'custom.png', mimeType: 'image/png', buffer: diskBytes });
  await page.waitForFunction(() => !window.aioli.pending && window.aioli.resources['custom.png']);
  await click('close-window');
  await click('file');
  await click('new-project');
  await page.waitForFunction(
    (data) =>
      !window.aioli.pending &&
      window.aioli.resources['editor/icon/code.png'].data === data &&
      !window.aioli.resources['custom.png'],
    newData,
  );
  assert.equal(
    await page.evaluate(() => window.aioli.applicationState['active-scene']),
    'examples/garden.scene.lisp',
  );
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')).version),
    17,
  );
  assert.deepEqual(errors, []);
  console.log('Disk icon edits, missing/recovered assets and clean New Project assets passed');
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
