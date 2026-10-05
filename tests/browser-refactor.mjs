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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
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
  project.files['game.lisp'] =
    '(init! :player (map :x 10 :y 20) ["Player"]) (defdraw render [] (background "#272822") (fill "#66d9ef") (circle [(lookup (get :player) :x) 20] 4))';
  project.files['special.lisp'] = '; Custom command classification';
  project.files['editor/policy/files.lisp'] +=
    '\n(defn editor-source-role [path] (if (= path "special.lisp") "command" (if (= path "main.lisp") "app" (if (ends-with? path ".scene.lisp") "scene" (if (ends-with? path ".generator.lisp") "generator" (if (ends-with? path ".command.lisp") "command" "module"))))))';
  project.files['editor/templates/scene.lisp'] =
    '; CUSTOM TEMPLATE\n(defdraw render [] (background "#272822"))';
  project.applicationState = {};
  project.state = { 'show-tools': true, 'show-files': true, tab: 'game', 'open-folders': [] };
  await page.locator('#file-input').setInputFiles({
    name: 'refactor.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState.player?.x === 10,
  );
  await page.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'scene-field-player'));
  const row = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'file-special.lisp'),
  );
  assert.equal(
    row.assetKind,
    'command',
    'editable Lisp policy determines actual file classification',
  );
  await click('scene-field-player');
  const edit = await page.evaluate(() =>
    window.aioli.regions.filter((r) => r.id === 'source').at(-1),
  );
  await page.mouse.click(edit.origin[0] + 12, edit.origin[1] + 12);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('{"x":48,"y":32}');
  await click('scene-inspector-apply');
  await page.waitForFunction(() => window.aioli.applicationState.player.x === 48);
  assert.equal(await page.evaluate(() => window.aioli.editorState.player), undefined);
  await click('file');
  await click('new-file');
  await click('file-type-scene');
  const input = await page.evaluate(() =>
    window.aioli.regions.filter((r) => r.id === 'source').at(-1),
  );
  await page.mouse.click(input.origin[0] + 12, input.origin[1] + 12);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('custom');
  await click('file-create');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.sources['custom.scene.lisp']?.includes('CUSTOM TEMPLATE'),
  );
  assert.ok(Array.isArray(await page.evaluate(() => window.aioli.editorState['open-tabs'])));
  await page.reload();
  await page.waitForFunction(
    () => window.aioli?.running && window.aioli.applicationState.player?.x === 48,
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/lisp-editor-policy.png' });
  console.log(
    'Live Lisp file roles, editable templates, structured JSON inspector, private game state, collection persistence and reload passed.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
