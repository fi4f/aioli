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
  await click('file');
  const chooser = page.waitForEvent('filechooser');
  await click('open-file');
  await (
    await chooser
  ).setFiles({
    name: 'move-me.lisp',
    mimeType: 'text/plain',
    buffer: Buffer.from('(defn moved-helper [] 42)'),
  });
  await page.waitForFunction(() => !window.aioli.pending && window.aioli.sources['move-me.lisp']);
  assert.equal(await page.evaluate(() => window.aioli.state.tab), 'move-me.lisp');
  await click('file');
  let downloaded = page.waitForEvent('download');
  await click('save-file');
  let saved = await downloaded;
  assert.equal(saved.suggestedFilename(), 'move-me.lisp');
  await mkdir('artifacts', { recursive: true });
  await saved.saveAs('artifacts/saved-individual.lisp');
  assert.equal(
    await readFile('artifacts/saved-individual.lisp', 'utf8'),
    '(defn moved-helper [] 42)',
  );
  await click('view');
  await click('files');
  await click('folder-examples');
  async function drag(from, to) {
    await page.waitForFunction(
      ([from, to]) =>
        window.aioli.regions.some((r) => r.id === from) &&
        window.aioli.regions.some((r) => r.id === to),
      [from, to],
    );
    const [a, b] = await page.evaluate(
      ([from, to]) => [from, to].map((id) => window.aioli.regions.find((r) => r.id === id)),
      [from, to],
    );
    await page.mouse.move(a.origin[0] + Math.min(a.size[0] - 5, 120), a.origin[1] + 12);
    await page.mouse.down();
    await page.mouse.move(b.origin[0] + 70, b.origin[1] + 12, { steps: 12 });
    await page.mouse.up();
  }
  await drag('file-move-me.lisp', 'folder-examples');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.sources['examples/move-me.lisp'] &&
      !window.aioli.sources['move-me.lisp'],
  );
  assert.equal(await page.evaluate(() => window.aioli.state.tab), 'examples/move-me.lisp');
  await drag('file-examples/move-me.lisp', 'collapse-files');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.sources['move-me.lisp'] &&
      !window.aioli.sources['examples/move-me.lisp'],
  );
  // A collision must leave both files intact; dropping outside Files cancels.
  const collision = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')));
  collision.files['examples/move-me.lisp'] = '; keep destination';
  await page.locator('#file-input').setInputFiles({
    name: 'collision.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(collision)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.sources['examples/move-me.lisp'] === '; keep destination',
  );
  await drag('file-move-me.lisp', 'folder-examples');
  await page.waitForFunction(
    () => window.aioli.error && window.aioli.status.includes('Destination already exists'),
  );
  assert.equal(
    await page.evaluate(() => window.aioli.sources['move-me.lisp']),
    '(defn moved-helper [] 42)',
  );
  assert.equal(
    await page.evaluate(() => window.aioli.sources['examples/move-me.lisp']),
    '; keep destination',
  );
  delete collision.files['examples/move-me.lisp'];
  await page.locator('#file-input').setInputFiles({
    name: 'restore.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(collision)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      !window.aioli.error &&
      !window.aioli.sources['examples/move-me.lisp'],
  );
  await drag('file-move-me.lisp', 'world');
  assert.ok(await page.evaluate(() => window.aioli.sources['move-me.lisp']));
  // Moving the active garden scene preserves imports, the entry request and preview.
  await drag('file-examples/garden.scene.lisp', 'folder-commands');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'commands/garden.scene.lisp',
  );
  assert.ok(
    await page.evaluate(() => window.aioli.sources.game.includes('commands/garden.scene.lisp')),
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  // Individual assets use the same open/save file actions.
  await click('file');
  const assets = page.waitForEvent('filechooser');
  await click('open-file');
  await (
    await assets
  ).setFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: await readFile('assets/editor-icons/code.png'),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.preview.ready &&
      window.aioli.preview.path === 'sample.png',
  );
  await click('file');
  downloaded = page.waitForEvent('download');
  await click('save-file');
  saved = await downloaded;
  assert.equal(saved.suggestedFilename(), 'sample.png');
  await click('close-window');
  const imageData = await page.evaluate(() => window.aioli.resources['sample.png'].data);
  await drag('file-sample.png', 'folder-assets');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.resources['assets/sample.png'] &&
      !window.aioli.resources['sample.png'],
  );
  assert.equal(
    await page.evaluate(() => window.aioli.resources['assets/sample.png'].data),
    imageData,
  );
  assert.equal(await page.evaluate(() => window.aioli.state['selected-file']), 'assets/sample.png');
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.ok(await page.evaluate(() => window.aioli.sources['commands/garden.scene.lisp']));
  if ((await page.evaluate(() => window.aioli.state.menu)) !== 'file') await click('file');
  await click('new-project');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/garden.scene.lisp' &&
      !window.aioli.sources['move-me.lisp'],
  );
  assert.equal(await page.evaluate(() => window.aioli.resources['sample.png']), undefined);
  assert.ok(await page.evaluate(() => window.aioli.sources['examples/bloom.scene.lisp']));
  assert.equal(await page.evaluate(() => window.aioli.sources['bloom.scene.lisp']), undefined);
  assert.ok(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('aioli.project.previous')).files['move-me.lisp'],
    ),
  );
  await page.screenshot({ path: 'artifacts/file-menu-new-project.png' });
  assert.deepEqual(errors, []);
  console.log(
    'New project, individual source/asset open and save, drag moves, entry reference updates and persistence passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
