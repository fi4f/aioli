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
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.files['main.lisp'] =
    `(init! :editor-runs 0) (set! :editor-runs (+ (get :editor-runs) 1))
` + project.files['main.lisp'];
  project.files['game.lisp'] =
    `(init! :game-runs 0) (set! :game-runs (+ (get :game-runs) 1))
` + project.files['game.lisp'];
  project.state = { 'show-files': true, 'show-code': true, tab: 'game', paused: true };
  project.applicationState = {};
  await page.locator('#file-input').setInputFiles({
    name: 'run-main.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.editorState['editor-runs'] === 1,
  );
  await click('play-main.lisp');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.editorState['editor-runs'] === 2,
  );
  assert.equal(await page.evaluate(() => window.aioli.applicationState['game-runs']), 2);
  assert.equal(await page.evaluate(() => window.aioli.state.tab), 'game');
  assert.equal(await page.evaluate(() => window.aioli.state.paused), true);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.editorState['editor-runs'] === 3,
  );
  assert.equal(await page.evaluate(() => window.aioli.applicationState['game-runs']), 3);
  assert.equal(await page.evaluate(() => window.aioli.state.paused), true);
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  assert.deepEqual(errors, []);
  console.log(
    'main.lisp run button reevaluates both applications exactly like Ctrl+Enter, preserving tab and pause state',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
