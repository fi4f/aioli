import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1.25,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(r.origin[0] + 12, r.origin[1] + 12);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  async function editMain(text) {
    await click('tab-game');
    await click('source');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
  }
  async function instruction(text) {
    await page.keyboard.press('Escape');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.keyboard.press('Control+Shift+p');
    await page.waitForFunction(
      () =>
        document.activeElement.id === 'text-input' &&
        document.querySelector('#text-input').value === '',
    );
    await page.keyboard.insertText(text);
    await page.keyboard.press('Control+Enter');
  }
  assert.equal(
    await page.evaluate(() => window.aioli.state['active-scene']),
    'examples/garden.scene.lisp',
  );
  const gardenShader = await page.evaluate(() => window.aioli.shader);
  // Test the exact reported trigger through native source input and live evaluation.
  await editMain('(start-scene "examples/bloom.scene.lisp")');
  await page.waitForFunction(
    () =>
      window.aioli.state['active-scene'] === 'examples/bloom.scene.lisp' && !window.aioli.pending,
  );
  assert.notEqual(await page.evaluate(() => window.aioli.shader), gardenShader);
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('aioli.project.v3')).files['game.lisp'] ===
      '(start-scene "examples/bloom.scene.lisp")',
  );
  // Failed requests keep the last working scene and renderer.
  await editMain('(start-scene "scenes/missing.scene.lisp")');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.equal(
    await page.evaluate(() => window.aioli.state['active-scene']),
    'examples/bloom.scene.lisp',
  );
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  await editMain('(start-scene "examples/bloom.scene.lisp")');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !window.aioli.error && !window.aioli.pending);
  // An explicit runtime transition survives reevaluation of unchanged entry requests.
  await instruction('(start-scene "examples/garden.scene.lisp")');
  await page.waitForFunction(
    () =>
      window.aioli.state['active-scene'] === 'examples/garden.scene.lisp' && !window.aioli.pending,
  );
  await page.keyboard.press('Escape');
  await editMain('; An unrelated edit\n(start-scene "examples/bloom.scene.lisp")');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !window.aioli.pending);
  assert.equal(
    await page.evaluate(() => window.aioli.state['active-scene']),
    'examples/garden.scene.lisp',
  );
  // Saved runtime transitions survive startup when the entry request is unchanged.
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('aioli.project.v3')).files['game.lisp'].startsWith(
      '; An unrelated edit',
    ),
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(
    await page.evaluate(() => window.aioli.state['active-scene']),
    'examples/garden.scene.lisp',
  );
  // A changed startup request still takes precedence over stale saved scene state.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('aioli.project.v3'));
    saved.applicationState['entry-scene-request'] = 'examples/garden.scene.lisp';
    localStorage.setItem('aioli.project.v3', JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(
    await page.evaluate(() => window.aioli.state['active-scene']),
    'examples/bloom.scene.lisp',
  );
  assert.deepEqual(errors, []);
  console.log(
    'game.lisp live scene requests, shader changes, failure rollback, runtime transitions and startup selection passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
