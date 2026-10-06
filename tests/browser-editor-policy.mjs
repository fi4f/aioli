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
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  async function open(project) {
    await page.locator('#file-input').setInputFiles({
      name: 'policy.aioli.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.waitForFunction(
      (source) =>
        !window.aioli.pending && window.aioli.sources['editor/policy/shortcuts.lisp'] === source,
      project.files['editor/policy/shortcuts.lisp'],
    );
    assert.equal(await page.evaluate(() => window.aioli.error), false);
  }
  const custom = structuredClone(original);
  custom.files['editor/policy/shortcuts.lisp'] = custom.files[
    'editor/policy/shortcuts.lisp'
  ].replace('(= key "F4")', '(= key "F6")');
  await open(custom);
  const panes = await page.evaluate(() =>
    ['show-code', 'show-files', 'show-tools', 'show-generator', 'ui-docks', 'open-tabs'].map(
      (key) => window.aioli.editorState[key],
    ),
  );
  await page.keyboard.press('F6');
  await page.waitForFunction(() => window.aioli.editorState['preview-focused']);
  await page.keyboard.press('F4');
  assert.equal(await page.evaluate(() => window.aioli.editorState['preview-focused']), true);
  await page.keyboard.press('F6');
  await page.waitForFunction(() => !window.aioli.editorState['preview-focused']);
  assert.deepEqual(
    await page.evaluate(() =>
      ['show-code', 'show-files', 'show-tools', 'show-generator', 'ui-docks', 'open-tabs'].map(
        (key) => window.aioli.editorState[key],
      ),
    ),
    panes,
  );
  const broken = structuredClone(custom);
  broken.files['editor/policy/shortcuts.lisp'] +=
    '\n(defn editor-shortcut [workspace event focus dragging] (error "Broken shortcut"))';
  await open(broken);
  await page.keyboard.press('F6');
  await page.waitForFunction(() => window.aioli.status === 'Broken shortcut');
  await page.keyboard.press('F2');
  await page.waitForFunction(
    () => window.aioli.recovery && window.aioli.editorState.tab === 'main',
  );
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !window.aioli.pending && !window.aioli.error);
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  assert.equal(
    await page.evaluate(() => window.aioli.sources['editor/policy/shortcuts.lisp']),
    broken.files['editor/policy/shortcuts.lisp'],
  );
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/editor-policy-recovery.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Live Lisp shortcuts, focus restoration and native recovery from broken policy passed.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
