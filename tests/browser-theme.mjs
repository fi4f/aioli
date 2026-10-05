import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1.25,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  }
  const old = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')));
  old.version = 18;
  delete old.files['editor/theme.lisp'];
  old.state['ui-bg'] = '#101613';
  old.state['ui-accent'] = '#bbd6a6';
  await page.locator('#file-input').setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['ui-accent'] === '#66d9ef',
  );
  assert.equal(await page.evaluate(() => window.aioli.applicationState['ui-accent']), undefined);
  await click('view');
  await click('files');
  await click('folder-editor');
  await click('file-editor/theme.lisp');
  await page.waitForFunction(() => window.aioli.state.tab === 'editor/theme.lisp');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/monokai-theme.png' });
  const customized = await page.evaluate(() =>
    window.aioli.sources['editor/theme.lisp']
      .replace('#66d9ef', '#fd971f')
      .replace(':ui-code-line-height 21', ':ui-code-line-height 28')
      .replace(':ui-code-gutter 40', ':ui-code-gutter 48')
      .replace(':ui-files-width 280', ':ui-files-width 300'),
  );
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(customized);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['ui-accent'] === '#fd971f',
  );
  assert.equal(await page.evaluate(() => window.aioli.state['ui-code-line-height']), 28);
  const region = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'source'));
  assert.equal(region.origin[0], 316);
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    'rgb(30, 31, 28)',
  );
  await page.keyboard.press('F2');
  await page.waitForFunction(() => window.aioli.state.tab === 'main');
  assert.equal(
    await page.evaluate(() => window.aioli.state['ui-accent']),
    '#fd971f',
    'recovery construction preserves theme',
  );
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('aioli.project.v3')).files['editor/theme.lisp'].includes(
      '#fd971f',
    ),
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-accent']), '#fd971f');
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Theme migration, editor/game isolation, live palette and spacing, recovery and reload passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
