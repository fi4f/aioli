import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  const frame = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  async function click(id) {
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    assert.ok(r, id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await frame();
  }
  async function fill(id, text) {
    await click(id);
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
    await frame();
  }
  async function open() {
    await click('project');
    await click('project-settings');
  }
  await open();
  await fill('project-name', 'Canceled');
  await click('settings-cancel');
  assert.equal(await page.evaluate(() => window.aioli.state['project-name']), 'Untitled project');
  await open();
  await fill('project-name', 'Boo Patrol & "Friends"');
  await fill('canvas-width', '0');
  await fill('canvas-height', '64');
  await click('canvas-apply');
  assert.match(
    await page.evaluate(() => window.aioli.state['project-settings-error']),
    /Canvas dimensions/,
  );
  assert.equal(await page.evaluate(() => window.aioli.state['project-name']), 'Untitled project');
  await fill('canvas-width', '64');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/project-settings.png' });
  await click('canvas-apply');
  await page.waitForFunction(() => !window.aioli.pending && window.aioli.state.window === '');
  assert.equal(
    await page.evaluate(() => window.aioli.state['project-name']),
    'Boo Patrol & "Friends"',
  );
  assert.equal(await page.evaluate(() => window.aioli.state['canvas-width']), 64);
  assert.equal(await page.evaluate(() => window.aioli.state['canvas-height']), 64);
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(
    await page.evaluate(() => window.aioli.state['project-name']),
    'Boo Patrol & "Friends"',
  );
  await open();
  await fill('project-name', '');
  await click('canvas-apply');
  assert.match(
    await page.evaluate(() => window.aioli.state['project-settings-error']),
    /Project name/,
  );
  await click('settings-cancel');
  await click('file');
  const downloaded = page.waitForEvent('download');
  await click('export-html');
  const html = await downloaded;
  const htmlPath = path.resolve('artifacts/named-project.html');
  await html.saveAs(htmlPath);
  const offline = await browser.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  await offline.waitForFunction(() => window.aioliApplication);
  assert.equal(await offline.title(), 'Boo Patrol & "Friends"');
  assert.equal(await offline.locator('#error').textContent(), '');
  await open();
  await page.setViewportSize({ width: 390, height: 844 });
  await frame();
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  await click('canvas-height');
  assert.equal(await page.locator('#text-input').inputValue(), '64');
  assert.deepEqual(errors, []);
  console.log(
    'Project name/canvas form, atomic validation, cancel, reload, offline HTML title and narrow fields passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
