import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.state['show-files'] = true;
  project.state['ui-docks'] = {
    code: { dock: 'floating', x: 160, y: 120, width: 360, height: 360 },
  };
  await page.locator('#file-input').setInputFiles({
    name: 'dwell.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['ui-docks'].code?.dock === 'floating',
  );
  const frame = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  async function moveOverTarget() {
    const header = await page.evaluate(() =>
      window.aioli.regions.find((r) => r.id === 'dock-move-code'),
    );
    await page.mouse.move(header.origin[0] + 20, header.origin[1] + 10);
    await page.mouse.down();
    await page.mouse.move(740, 700, { steps: 10 });
    await frame();
  }
  await moveOverTarget();
  assert.equal(await page.evaluate(() => window.aioli.dockPreview.ready), false);
  await page.waitForFunction(
    () => window.aioli.dockPreview?.progress > 0.25 && !window.aioli.dockPreview.ready,
  );
  await mkdir('artifacts', { recursive: true });
  await frame();
  await page.screenshot({ path: 'artifacts/docking-progress.png' });
  await page.mouse.move(760, 700);
  await frame();
  assert.ok(await page.evaluate(() => window.aioli.dockPreview.progress < 0.2));
  await page.mouse.up();
  await frame();
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'floating');
  assert.equal(await page.evaluate(() => window.aioli.dockPreview), null);
  await moveOverTarget();
  await page.waitForFunction(() => window.aioli.dockPreview?.ready);
  assert.equal(await page.evaluate(() => window.aioli.dockPreview.progress), 1);
  await frame();
  await page.screenshot({ path: 'artifacts/docking-ready.png' });
  await page.mouse.up();
  await frame();
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'split');
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Floating repositioning, stationary hover progress, movement reset, early release and ready-only split docking passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
