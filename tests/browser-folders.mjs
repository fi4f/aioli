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
  async function right(id, blank = false) {
    const row = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(row.origin[0] + 20, row.origin[1] + (blank ? row.size[1] - 10 : 12), {
      button: 'right',
    });
    await page.waitForFunction(() => window.aioli.state['file-context']);
  }
  async function pathAction(path) {
    await page.waitForFunction(() => window.aioli.state.window === 'file-path');
    const edit = await page.evaluate(() =>
      window.aioli.regions.filter((r) => r.id === 'source').at(-1),
    );
    await page.mouse.click(edit.origin[0] + 12, edit.origin[1] + 12);
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(path);
    await click('folder-apply');
  }
  await click('view');
  await click('files');
  await right('files-tree', true);
  await click('context-new-folder');
  await pathAction('packs');
  await page.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'folder-packs'));
  await right('folder-packs');
  await click('context-new-folder');
  await pathAction('packs/empty');
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('aioli.project')).state['project-folders']?.includes(
      'packs/empty',
    ),
  );
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.files['game.lisp'] =
    '(import "./packs/helper.lisp") (start-scene "packs/sub/level.scene.lisp")';
  project.files['packs/helper.lisp'] = '(defn helper [] 7)';
  project.files['packs/sub/level.scene.lisp'] =
    '(import "../helper.lisp")\n(defdraw render [] (pixels [p time] (background "#000000")))';
  project.resources['packs/asset.png'] = {
    mime: 'image/png',
    data: project.resources['editor/icon/code.png'].data,
  };
  project.state.tab = 'packs/helper.lisp';
  project.state['selected-file'] = 'packs/helper.lisp';
  project.applicationState = {};
  await page.locator('#file-input').setInputFiles({
    name: 'folders.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'packs/sub/level.scene.lisp',
  );
  await right('folder-packs');
  await click('context-folder-rename');
  await pathAction('renamed');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.sources['renamed/helper.lisp'],
  );
  assert.equal(await page.evaluate(() => window.aioli.state.tab), 'renamed/helper.lisp');
  assert.equal(
    await page.evaluate(() => window.aioli.applicationState['active-scene']),
    'renamed/sub/level.scene.lisp',
  );
  assert.ok(
    await page.evaluate(() => window.aioli.sources.game.includes('renamed/sub/level.scene.lisp')),
  );
  assert.ok(await page.evaluate(() => window.aioli.resources['renamed/asset.png']));
  await right('folder-renamed');
  await click('context-folder-move');
  await pathAction('examples/renamed');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.sources['examples/renamed/helper.lisp'],
  );
  const from = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'folder-examples/renamed'),
  );
  const to = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'collapse-files'));
  await page.mouse.move(from.origin[0] + 100, from.origin[1] + 12);
  await page.mouse.down();
  await page.mouse.move(to.origin[0] + to.size[0] / 2, to.origin[1] + 12, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.sources['renamed/helper.lisp'] &&
      !window.aioli.sources['examples/renamed/helper.lisp'],
  );
  await right('folder-renamed');
  await click('context-folder-move');
  await pathAction('examples');
  await page.waitForFunction(() => window.aioli.error);
  assert.ok(await page.evaluate(() => window.aioli.sources['renamed/helper.lisp']));
  await click('close-window');
  await right('folder-renamed/empty');
  await click('context-folder-delete');
  await page.waitForFunction(
    () => !window.aioli.pending && !window.aioli.state['project-folders'].includes('renamed/empty'),
  );
  await right('folder-renamed');
  await click('context-folder-delete');
  await page.waitForFunction(() => !window.aioli.pending && window.aioli.error);
  assert.ok(await page.evaluate(() => window.aioli.sources['renamed/helper.lisp']));
  assert.match(await page.evaluate(() => window.aioli.status), /still in use/);
  await click('file-game.lisp');
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('(start-scene "examples/garden.scene.lisp")');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/garden.scene.lisp',
  );
  await right('folder-renamed');
  await click('context-folder-delete');
  await page.waitForFunction(
    () => !window.aioli.pending && !window.aioli.sources['renamed/helper.lisp'],
  );
  assert.equal(await page.evaluate(() => window.aioli.resources['renamed/asset.png']), undefined);
  assert.equal(
    await page.evaluate(() => window.aioli.state['open-tabs'].includes('renamed/')),
    false,
  );
  await right('files-tree', true);
  await click('context-new-folder');
  await pathAction('keep/empty');
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('aioli.project')).state['project-folders']?.includes(
      'keep/empty',
    ),
  );
  await page.reload();
  await page.waitForFunction(
    () => window.aioli?.running && window.aioli.regions.some((r) => r.id === 'folder-keep/empty'),
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Empty folder creation/persistence, recursive rename/move/drag, references/tabs, collision rejection and recursive deletion passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
