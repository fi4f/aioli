import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createStaticServer } from '../server.js';
import { exportHTML } from '../html-export.js';
import { defaults } from '../examples.js';
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
    await page.mouse.click(r.origin[0] + 12, r.origin[1] + 12);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('(init! :stolen (get :ui-bg))');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.match(await page.evaluate(() => window.aioli.status), /Unknown state :ui-bg/);
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(
    '(init! :editor-hidden true)\n(defn update [dt] (set! :px (pointer-x)) (set! :py (pointer-y)) (set! :sw (screen-width)) (set! :sh (screen-height)))\n(defn draw [] (fill "#ff0000") (rect [12 12] [40 40]))',
  );
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['editor-hidden'] === true,
  );
  assert.equal(await page.evaluate(() => window.aioli.editorState['editor-hidden']), undefined);
  assert.ok(
    await page.evaluate(() =>
      window.aioli.commands.some((c) => c.meta[0] === 0 && c.color[0] === 1 && c.color[1] === 0),
    ),
  );
  // Host authority flows only toward the embedded application's state.
  await page.keyboard.press('Control+Shift+p');
  await page.waitForFunction(
    () =>
      document.activeElement.id === 'text-input' &&
      document.querySelector('#text-input').value === '',
  );
  await page.keyboard.insertText('(game-set! :inspected 73) (set! :editor-private 99)');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.aioli.applicationState.inspected === 73);
  assert.equal(
    await page.evaluate(() => window.aioli.applicationState['editor-private']),
    undefined,
  );
  await page.keyboard.press('Escape');
  await click('file');
  const downloadPromise = page.waitForEvent('download');
  await click('export-html');
  const download = await downloadPromise;
  await mkdir('artifacts', { recursive: true });
  const filename = path.resolve('artifacts/application-export.html');
  await download.saveAs(filename);
  const html = await readFile(filename, 'utf8');
  assert.equal(html.includes('editor/workspace.lisp'), false);
  assert.equal(html.includes('assets/editor-icons/'), true);
  const offline = await browser.newPage();
  const external = [];
  offline.on('request', (r) => {
    if (/^https?:/.test(r.url())) external.push(r.url());
  });
  await offline.goto(pathToFileURL(filename).href);
  await offline.waitForFunction(
    () => window.aioliApplication || document.getElementById('error').textContent,
  );
  assert.equal(await offline.locator('#error').textContent(), '');
  assert.equal(
    await offline.evaluate(() => window.aioliApplication.runtime.state['editor-hidden']),
    true,
  );
  assert.equal(
    await offline.evaluate(() => window.aioliApplication.runtime.global['game-get']),
    undefined,
  );
  assert.equal(
    await offline.evaluate(() => window.aioliApplication.runtime.state.inspected),
    undefined,
  ); // fresh startup, no editor session state
  for (const viewport of [
    { width: 1000, height: 500 },
    { width: 500, height: 1000 },
  ]) {
    await offline.setViewportSize(viewport);
    await offline.waitForFunction(() => window.aioliApplication.runtime.state.sw === 320);
    const fit = await offline.evaluate(() => window.aioliApplication.surface);
    assert.ok(Math.abs(fit.size[0] / fit.size[1] - 4 / 3) < 1e-9);
    await offline.mouse.move(fit.origin[0] + 160 * fit.scale, fit.origin[1] + 120 * fit.scale);
    await offline.waitForFunction(
      () =>
        Math.abs(window.aioliApplication.runtime.state.px - 160) < 1 &&
        Math.abs(window.aioliApplication.runtime.state.py - 120) < 1,
    );
    assert.equal(await offline.evaluate(() => window.aioliApplication.runtime.state.sh), 240);
    await offline.screenshot({ path: `artifacts/export-${viewport.width}x${viewport.height}.png` });
  }
  assert.deepEqual(external, []);
  // Dynamic scene paths and bundled assets also work in a plain file with no server.
  const sceneHTML = await exportHTML(
    {
      ...Object.fromEntries(Object.entries(defaults).filter(([k]) => k !== 'main')),
      'game.lisp': '(start-scene "level.lisp")',
      'level.lisp': defaults['scenes/garden.scene.lisp'],
      'second.lisp': defaults['scenes/bloom.scene.lisp'],
      'unused.lisp': '; </script> retained',
    },
    { 'assets/example.txt': { data: 'data:text/plain;base64,SGVsbG8=' } },
    (p) => readFile(new URL('../' + p, import.meta.url), 'utf8'),
  );
  const sceneFile = path.resolve('artifacts/scene-export.html');
  await writeFile(sceneFile, sceneHTML);
  await offline.goto(pathToFileURL(sceneFile).href);
  await offline.waitForFunction(
    () => window.aioliApplication || document.getElementById('error').textContent,
  );
  assert.equal(await offline.locator('#error').textContent(), '');
  assert.equal(await offline.evaluate(() => window.aioliApplication.scene.path), 'level.lisp');
  const x = await offline.evaluate(() => window.aioliApplication.runtime.state.x);
  await offline.keyboard.down('d');
  await offline.waitForTimeout(200);
  await offline.keyboard.up('d');
  assert.ok((await offline.evaluate(() => window.aioliApplication.runtime.state.x)) > x);
  await offline.evaluate(() =>
    window.aioliApplication.runtime.global['start-scene']('second.lisp'),
  );
  await offline.waitForFunction(() => window.aioliApplication.scene.path === 'second.lisp');
  assert.equal(await offline.locator('#error').textContent(), '');
  assert.deepEqual(errors, []);
  console.log(
    'Independent editor/game state, one-way inspection, CPU drawing, native HTML export, offline file startup, input and dynamic scenes passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
