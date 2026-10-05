import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    'C:/Users/smcge/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const server = createStaticServer({ basePath: '/aioli/' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function click(id) {
  await page.waitForFunction((id) => window.aioli?.regions.some((region) => region.id === id), id);
  const region = await page.evaluate(
    (id) => window.aioli.regions.find((region) => region.id === id),
    id,
  );
  await page.mouse.click(region.origin[0] + 10, region.origin[1] + 10);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function type(text) {
  await click('source');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}
async function palette(text) {
  await page.keyboard.press('Control+Shift+p');
  // The shortcut should focus the native input without requiring a mouse click.
  await page.waitForFunction(
    () =>
      window.aioli.state.window === 'palette' &&
      document.activeElement.id === 'text-input' &&
      document.querySelector('#text-input').value === '',
  );
  await page.keyboard.insertText(text);
  await page.keyboard.press('Control+Enter');
}
async function ready() {
  await page.waitForFunction(() => !window.aioli.pending);
  assert.equal(
    await page.evaluate(() => window.aioli.error),
    false,
    await page.evaluate(() => window.aioli.status),
  );
}
try {
  await mkdir('artifacts', { recursive: true });
  const url = `http://127.0.0.1:${server.address().port}/aioli/`;
  await page.goto(url);
  await page.waitForFunction(() => window.aioli?.running);
  await click('files');
  await page.screenshot({ path: 'artifacts/file-explorer.png' });
  await type('lib/math.lisp');
  await click('file-create');
  await page.waitForFunction(
    () => window.aioli.state.tab === 'lib/math.lisp' && !window.aioli.pending,
  );
  await type('(defn twice [value] (* value 2))');
  await page.keyboard.press('Control+Enter');
  await ready();
  await click('tab-scene');
  const originalScene = await page.evaluate(() => window.aioli.sources.scene);
  await type(
    '(import "./lib/math.lisp")\n(init! :scene-tick 0)\n(defn scene-update [dt] (set! :scene-tick (+ (get :scene-tick) dt)))\n' +
      originalScene,
  );
  await page.keyboard.press('Control+Enter');
  await ready();
  await page.waitForFunction(() => window.aioli.state['scene-tick'] > 0);
  await palette('(set! :x (twice 30)) (set! :paused true)');
  await page.waitForFunction(() => window.aioli.state.x === 60 && window.aioli.state.paused);
  await page.screenshot({ path: 'artifacts/command-palette.png' });
  await type('center-player');
  await click('command-commands/center-player.lisp');
  await page.waitForFunction(() => window.aioli.state.x === 160);
  await page.keyboard.press('Escape');
  await click('files');
  await click('new-image');
  await page.waitForFunction(() => window.aioli.commands.some((command) => command.meta[0] === 5));
  await type(
    '(init! :image-radius 48) (init! :image-x 160) (init! :image-y 120) (init! :image-color "#bbd6a6")\n(defpixel image [p time] (background "#ff0000") (fill (param :image-color)) (circle [(param :image-x) (param :image-y)] (param :image-radius)))',
  );
  await page.keyboard.press('Control+Enter');
  await ready();
  const beforeScene = await page.evaluate(() => window.aioli.shader);
  await click('image-color-control');
  await click('image-store');
  await page.waitForFunction(() => !!window.aioli.resources['assets/generated.png']);
  await page.screenshot({ path: 'artifacts/image-generator.png' });
  let download = page.waitForEvent('download');
  await click('image-export');
  await (await download).saveAs('artifacts/generated.png');
  const png = await readFile('artifacts/generated.png');
  assert.equal(png.readUInt32BE(16), 320);
  assert.equal(png.readUInt32BE(20), 240);
  assert.equal(await page.evaluate(() => window.aioli.shader), beforeScene);
  assert.deepEqual(
    await page.evaluate(async () => {
      const response = await fetch(window.aioli.resources['assets/generated.png'].data);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return [...context.getImageData(0, 0, 1, 1).data];
    }),
    [255, 0, 0, 255],
  );
  await click('close-window');
  await click('files');
  await click('new-audio');
  await type(
    '(defn generate-sound [] (voice :triangle (get :sound-pitch) 220 (get :sound-duration) (get :sound-gain)))',
  );
  await page.keyboard.press('Control+Enter');
  await ready();
  await click('sound-store');
  await page.waitForFunction(() => !!window.aioli.resources['assets/generated.wav']);
  await click('sound-preview');
  await page.screenshot({ path: 'artifacts/audio-generator.png' });
  download = page.waitForEvent('download');
  await click('sound-export');
  await (await download).saveAs('artifacts/generated.wav');
  const wav = await readFile('artifacts/generated.wav');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.ok(wav.length > 1000);
  await click('close-window');
  await palette('(create-file "commands/custom.lisp" "(set! :x 23)")');
  await page.waitForFunction(
    () => window.aioli.sources['commands/custom.lisp'] && !window.aioli.pending,
  );
  await palette('');
  await type('custom');
  await click('command-commands/custom.lisp');
  await page.waitForFunction(() => window.aioli.state.x === 23);
  await type('(rename-file "lib/math.lisp" "lib/arithmetic.lisp")');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => window.aioli.error && window.aioli.status.includes('Missing import'),
  );
  assert.ok(await page.evaluate(() => window.aioli.running));
  await type('(rename-file "lib/arithmetic.lisp" "lib/math.lisp")');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !window.aioli.pending && !window.aioli.error);
  await page.keyboard.press('Escape');
  await click('project');
  download = page.waitForEvent('download');
  await click('export');
  await (await download).saveAs('artifacts/project-v3.json');
  const project = JSON.parse(await readFile('artifacts/project-v3.json', 'utf8'));
  assert.equal(project.version, 3);
  assert.ok(project.files['lib/math.lisp']);
  assert.ok(project.resources['assets/generated.png']);
  assert.ok(project.resources['assets/generated.wav']);
  assert.equal(project.files.__palette, undefined);
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.ok(await page.evaluate(() => window.aioli.sources['commands/custom.lisp']));
  assert.ok(await page.evaluate(() => window.aioli.resources['assets/generated.png']));
  await page.locator('#file-input').setInputFiles('artifacts/project-v3.json');
  await ready();
  // Native resource import is a reversible project operation, with no server.
  await page
    .locator('#resource-input')
    .setInputFiles({ name: 'imported-tone.wav', mimeType: 'audio/wav', buffer: wav });
  await page.waitForFunction(() => !!window.aioli.resources['assets/imported-tone.wav']);
  // An older/custom saved shell remains the project source in recovery. File
  // operations must not silently switch back to that shell after evaluation.
  const oldEditor = '(defn editor [] (background "#101613"))\n; custom old editor';
  const oldUI = project.files['ui.lisp'] + '\n; custom old library';
  const oldProject = {
    ...project,
    recovery: false,
    files: { ...project.files, 'editor.lisp': oldEditor, 'ui.lisp': oldUI },
  };
  oldProject.files['generators/audio.lisp'] =
    '(init! :sound-wave "sine") (init! :sound-pitch 440) (init! :sound-end 880) (init! :sound-duration 0.3) (init! :sound-gain 0.35)\n' +
    oldProject.files['generators/audio.lisp'];
  await page.locator('#file-input').setInputFiles({
    name: 'old-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(oldProject)),
  });
  await page.waitForFunction(
    (oldEditor) => !window.aioli.pending && window.aioli.sources.editor === oldEditor,
    oldEditor,
  );
  await page.keyboard.press('F2');
  await click('files');
  await type('lib/recovery.lisp');
  await click('file-create');
  await page.waitForFunction(
    () => !window.aioli.pending && !!window.aioli.sources['lib/recovery.lisp'],
  );
  assert.equal(await page.evaluate(() => window.aioli.recovery), true);
  assert.equal(await page.evaluate(() => window.aioli.sources.editor), oldEditor);
  await click('files');
  await click('close-window');
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running && window.aioli.recovery);
  await palette('(rename-file "lib/recovery.lisp" "lib/recovered.lisp")');
  await page.waitForFunction(
    () => !window.aioli.pending && !!window.aioli.sources['lib/recovered.lisp'],
  );
  assert.equal(await page.evaluate(() => window.aioli.recovery), true);
  await type('(reset-project)');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state.x === 160 && window.aioli.state.window === '',
  );
  assert.equal(await page.evaluate(() => window.aioli.recovery), true);
  await click('upgrade-editor');
  await page.waitForFunction(
    (oldEditor) =>
      !window.aioli.pending && !window.aioli.recovery && window.aioli.sources.editor !== oldEditor,
    oldEditor,
  );
  assert.equal(await page.evaluate(() => window.aioli.sources['editor-backup-1.lisp']), oldEditor);
  assert.equal(await page.evaluate(() => window.aioli.sources['ui-backup-1.lisp']), oldUI);
  await click('files');
  await click('close-window');
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running && !window.aioli.recovery);
  await click('files');
  await click('close-window');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Control+Shift+p');
  await type('(set! :x 19)');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.aioli.state.x === 19);
  await page.keyboard.press('Escape');
  await click('project');
  await click('image-generator');
  await page.screenshot({ path: 'artifacts/image-generator-mobile.png' });
  await page.waitForFunction(() =>
    window.aioli.regions.some(
      (region) =>
        region.id === 'image-export' &&
        region.origin[0] + region.size[0] <= 390 &&
        region.origin[1] + region.size[1] <= 844,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: named files, imports, mixed scene hook, palette commands, independent generator previews, PNG/WAV resources, v3 export/import/reload, narrow widgets.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}
