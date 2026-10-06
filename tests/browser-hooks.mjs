import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportHTML } from '../html-export.js';
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
  const instrumentAudio = () => {
    window.audioBuffers = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      createBuffer(channels, length, rate) {
        window.audioBuffers.push(length);
        return super.createBuffer(channels, length, rate);
      }
    };
  };
  await page.addInitScript(instrumentAudio);
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
  await page.locator('#open-file-input').setInputFiles({
    name: 'hooks.lisp',
    mimeType: 'text/plain',
    buffer: Buffer.from(`
(init! :preview-counter 0)
(defdraw mark [x y] ["Red mark" [30 40] [100 80]]
  (set! :preview-counter (+ (get :preview-counter) 1))
  (fill "#ff0000") (circle [x y] 5))
(defsound tone [pitch] ["Tone" [440]] (voice :sine pitch pitch 2 0.3))
(defsound hit [] ["Hit"] (voice :noise 100 40 0.15 0.2))`),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state.tab === 'hooks.lisp',
  );
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'inspect-hooks')),
    false,
  );
  const inline = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'inspect-hook-mark'),
  );
  const sourceRegion = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'source'),
  );
  assert.ok(inline.origin[1] >= sourceRegion.origin[1] && inline.size[1] === 20);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/inline-hooks.png' });
  await click('inspect-hook-mark');
  await page.waitForFunction(
    () =>
      window.aioli.hookPreview?.name === 'mark' &&
      window.aioli.state['preview-kind'] === 'hook-draw',
  );
  assert.equal(
    await page.evaluate(() => window.aioli.applicationState['preview-counter']),
    undefined,
  );
  assert.equal(await page.evaluate(() => window.aioli.hookPreview.state['preview-counter']), 1);
  assert.deepEqual(
    await page.evaluate(() => window.aioli.hookPreview.commands[0].bounds),
    [25, 35, 10, 10],
  );
  await click('hook-args');
  const edit = await page.evaluate(() =>
    window.aioli.regions.filter((r) => r.id === 'field-source').at(-1),
  );
  await page.mouse.click(edit.origin[0] + 12, edit.origin[1] + 12);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('[60,20]');
  await click('refresh-hook-preview');
  await page.waitForFunction(() => window.aioli.hookPreview?.args[0] === 60);
  assert.deepEqual(
    await page.evaluate(() => window.aioli.hookPreview.commands[0].bounds),
    [55, 15, 10, 10],
  );
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/drawing-hook-preview.png' });
  await click('back-to-hooks');
  assert.equal(await page.evaluate(() => window.aioli.state['show-preview']), true);
  await click('close-window');
  await click('inspect-hook-tone');
  await page.waitForFunction(
    () => window.aioli.preview.ready && window.aioli.state['preview-kind'] === 'hook-sound',
  );
  assert.ok(await page.evaluate(() => window.aioli.preview.duration >= 2));
  await click('hook-forward');
  await page.waitForFunction(() => window.aioli.preview.position >= 1);
  await click('asset-play');
  await page.waitForFunction(() => window.aioli.preview.playing);
  await click('asset-play');
  await page.waitForFunction(() => !window.aioli.preview.playing);
  await click('asset-stop');
  assert.equal(await page.evaluate(() => window.aioli.preview.position), 0);
  const seek = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'asset-seek'));
  await page.mouse.click(seek.origin[0] + seek.size[0] * 0.75, seek.origin[1] + 10);
  await page.waitForFunction(() => window.aioli.preview.position > 1.4);
  await page.screenshot({ path: 'artifacts/sound-hook-preview.png' });
  // Saved preview windows return to inline controls, never a stale decode or missing buffer.
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('aioli.project')).state['preview-kind'] === 'hook-sound',
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running && !window.aioli.state['show-preview']);
  await click('inspect-hook-hit');
  await page.waitForFunction(
    () => window.aioli.preview.ready && window.aioli.preview.duration < 0.3,
  );
  await click('close-window');
  await page.waitForFunction(() => !window.aioli.preview.ready);
  assert.equal(
    await page.evaluate(() => window.aioli.applicationState['preview-counter']),
    undefined,
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  // A regular draw hook calls defdraw functions; named audio works in both hosts.
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.files['hooks.lisp'] = await page.evaluate(() => window.aioli.sources['hooks.lisp']);
  project.files['game.lisp'] =
    '(import "./hooks.lisp")\n(defn update [dt] (when (pointer-pressed?) (play-sound :tone 220) (play-sound :hit)))\n(defdraw render [] (mark 50 60))';
  project.state = { tab: 'game', 'show-code': true };
  project.applicationState = {};
  await page.locator('#file-input').setInputFiles({
    name: 'hook-game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.applicationState['preview-counter'] > 0,
  );
  await page.evaluate(() => {
    window.audioBuffers = [];
  });
  await click('world');
  await page.waitForFunction(() => window.audioBuffers.length >= 2);
  assert.deepEqual(await page.evaluate(() => window.audioBuffers.slice(0, 2)), [89082, 7497]);
  const html = await exportHTML(project.files, project.resources, (file) => readFile(file, 'utf8'));
  const filename = path.resolve('artifacts/hook-export.html');
  await writeFile(filename, html);
  const offline = await browser.newPage();
  await offline.addInitScript(instrumentAudio);
  offline.on('pageerror', (e) => errors.push(e.message));
  await offline.goto('file:///' + filename.replaceAll('\\', '/'));
  await offline.waitForFunction(() => window.aioliApplication?.runtime);
  await offline.locator('canvas').click();
  await offline.waitForFunction(() => window.audioBuffers.length >= 2);
  assert.deepEqual(await offline.evaluate(() => window.audioBuffers.slice(0, 2)), [89082, 7497]);
  assert.equal(await offline.locator('#error').innerText(), '');
  assert.deepEqual(errors, []);
  console.log(
    'Composable drawing hooks, isolated preview state, editable arguments, named sound previews and audio transport passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
