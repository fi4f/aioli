import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
  const initial = await page.evaluate(() => window.aioli.resources);
  assert.equal(Object.keys(initial).filter((p) => p.startsWith('assets/editor-icons/')).length, 9);
  await click('view');
  await click('files');
  await click('folder-assets');
  await click('folder-assets/editor-icons');
  await page.waitForFunction(() => {
    const row = window.aioli.regions.find((r) => r.id === 'file-assets/editor-icons/image.png');
    return (
      row &&
      window.aioli.commands.some(
        (c) =>
          c.meta[0] === 7 &&
          c.bounds[0] === row.origin[0] + 42 &&
          c.bounds[1] === row.origin[1] + 5,
      )
    );
  });
  await click('file-assets/editor-icons/code.png');
  await page.waitForFunction(() => window.aioli.preview.ready);
  assert.equal(await page.evaluate(() => window.aioli.preview.width), 64);
  assert.equal(await page.evaluate(() => window.aioli.state.window), 'image-asset');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/editor-icon-resource.png' });
  await click('close-window');
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('aioli.project.v3')).state['open-folders']?.includes(
      'assets/editor-icons',
    ),
  );
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')));
  assert.equal(project.version, 12);
  project.resources['assets/editor-icons/code.png'] = initial['assets/editor-icons/play.png'];
  delete project.resources['assets/editor-icons/folder.png'];
  await page.locator('#file-input').setInputFiles({
    name: 'changed-icons.aioli.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    (data) =>
      !window.aioli.pending && window.aioli.resources['assets/editor-icons/code.png'].data === data,
    initial['assets/editor-icons/play.png'].data,
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(
    await page.evaluate(() => window.aioli.resources['assets/editor-icons/folder.png']),
    undefined,
  );
  assert.equal(
    await page.evaluate(() => window.aioli.resources['assets/editor-icons/code.png'].data),
    initial['assets/editor-icons/play.png'].data,
  );
  await click('file-assets/editor-icons/code.png');
  await page.waitForFunction(() => window.aioli.preview.ready);
  await page.screenshot({ path: 'artifacts/editor-icon-resource-replaced.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Editor icons appear as ordinary assets; image preview, replacement, save/reload and persistent deletion passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
