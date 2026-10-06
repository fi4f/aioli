import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
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
  project.files['game.lisp'] =
    '(defn update [dt] (set! :held-w (key? "w")) (set! :held-right (key? "ArrowRight")) (set! :held-space (key? " "))) (defdraw render [] (background "#272822"))';
  project.applicationState = {};
  await page.locator('#file-input').setInputFiles({
    name: 'game-input.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['held-w'] === false,
  );
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
  for (const focused of [false, true]) {
    if (focused) {
      await page.keyboard.press('F4');
      await frame();
    }
    await click('world');
    await page.keyboard.down('w');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('Space');
    await frame();
    for (const key of ['held-w', 'held-right', 'held-space'])
      assert.equal(await page.evaluate((key) => window.aioli.applicationState[key], key), true);
    await click('world');
    await click('world');
    for (const key of ['held-w', 'held-right', 'held-space'])
      assert.equal(
        await page.evaluate((key) => window.aioli.applicationState[key], key),
        true,
        `${key} survives clicking Game`,
      );
    await page.keyboard.up('w');
    await frame();
    assert.equal(await page.evaluate(() => window.aioli.applicationState['held-w']), false);
    assert.equal(await page.evaluate(() => window.aioli.applicationState['held-right']), true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await frame();
    for (const key of ['held-w', 'held-right', 'held-space'])
      assert.equal(await page.evaluate((key) => window.aioli.applicationState[key], key), false);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Space');
  }
  await page.keyboard.press('F4');
  await frame();
  await click('world');
  await page.keyboard.down('w');
  await frame();
  await click('source');
  await frame();
  assert.equal(await page.evaluate(() => window.aioli.applicationState['held-w']), false);
  await click('world');
  assert.equal(await page.evaluate(() => window.aioli.applicationState['held-w']), false);
  await page.keyboard.up('w');
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Held letters/arrows/space survive repeated Game clicks, individual release works, and focus/blur prevent stuck keys',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
