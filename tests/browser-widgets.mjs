import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
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
const menuRoutes = {
  'new-file': 'file',
  export: 'file',
  import: 'file',
  png: 'file',
  docs: 'about',
  help: 'about',
  preset: 'project',
  reset: 'project',
  evaluate: 'project',
  generators: 'view',
  'upgrade-editor': 'project',
  code: 'view',
  files: 'view',
  tools: 'view',
  commands: 'view',
  wgsl: 'view',
};
async function click(id) {
  if (['image-generator', 'audio-generator'].includes(id)) {
    const output = id.split('-')[0];
    await click('generators');
    for (let i = 0; i < 8; i++) {
      if (
        (await page.evaluate(() => window.aioli.state['active-generator'])).includes(
          `/${output}.generator.lisp`,
        )
      )
        break;
      await click('generator-select');
      await page.waitForFunction(() => !window.aioli.pending);
    }
    return;
  }
  if (id === 'image-color-control') {
    await click('generator-field-image-color');
    await page.locator('#generator-color').evaluate((input) => {
      input.value = '#e9bca9';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
    });
    return;
  }

  if (id.startsWith('tab-')) {
    // Bring offscreen tabs into view through the actual overflow controls.
    for (let i = 0; i < 256; i++) {
      const ids = await page.evaluate(() => window.aioli.regions.map((r) => r.id));
      if (ids.includes(id)) break;
      if (!ids.includes('tabs-prev')) break;
      await click('tabs-prev');
    }
    for (let i = 0; i < 256; i++) {
      const ids = await page.evaluate(() => window.aioli.regions.map((r) => r.id));
      if (ids.includes(id) || !ids.includes('tabs-next')) break;
      await click('tabs-next');
    }
  }

  if (
    menuRoutes[id] &&
    !(await page.evaluate((id) => window.aioli.regions.some((region) => region.id === id), id))
  )
    await click(menuRoutes[id]);
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
async function openFiles() {
  if (!(await page.evaluate(() => window.aioli.state['show-files']))) await click('files');
  await page.waitForFunction(() =>
    window.aioli.regions.some((region) => region.id === 'files-tree'),
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
  assert.deepEqual(await page.evaluate(() => JSON.parse(window.aioli.state['open-tabs'])), [
    'main',
    'game',
  ]);
  assert.equal(
    await page.evaluate(() => 'scene' in window.aioli.sources || 'audio' in window.aioli.sources),
    false,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.aioli.regions.filter((region) => region.origin[1] === 8).map((region) => region.label),
    ),
    ['File', 'Project', 'View', 'Edit', 'About'],
  );
  await page.keyboard.press('Alt+v');
  await page.waitForFunction(() => window.aioli.state.menu === 'view');
  await page.locator('button[data-region="code"]').waitFor({ state: 'attached' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.aioli.state['show-code'] && !window.aioli.state.menu);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await click('code');
  await click('edit');
  assert.equal(await page.locator('button[data-region="undo"]').isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'artifacts/menu-bar.png' });
  for (const menu of ['file', 'project', 'view', 'edit', 'about']) {
    await click(menu);
    await page.screenshot({ path: `artifacts/menu-${menu}.png` });
    await page.keyboard.press('Escape');
  }
  await openFiles();
  await page.screenshot({ path: 'artifacts/file-explorer.png' });
  await click('new-file');
  await type('lib/math.lisp');
  await click('file-create');
  await page.waitForFunction(
    () => window.aioli.state.tab === 'lib/math.lisp' && !window.aioli.pending,
  );
  await type('(defn twice [value] (* value 2))');
  await page.keyboard.press('Control+Enter');
  await ready();
  assert.ok(
    await page.evaluate(() =>
      JSON.parse(window.aioli.state['open-tabs']).includes('lib/math.lisp'),
    ),
  );
  await click('tab-game');
  await click('tab-lib/math.lisp');
  const mathSource = await page.evaluate(() => window.aioli.sources['lib/math.lisp']);
  await click('edit');
  await click('undo');
  await page.waitForFunction((text) => window.aioli.sources['lib/math.lisp'] !== text, mathSource);
  await click('edit');
  await click('redo');
  await page.waitForFunction((text) => window.aioli.sources['lib/math.lisp'] === text, mathSource);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await click('edit');
  await click('select-all');
  await click('edit');
  await click('copy');
  await page.waitForFunction(
    async (text) => (await navigator.clipboard.readText()) === text,
    mathSource,
  );
  await click('edit');
  await click('cut');
  await page.waitForFunction(() => window.aioli.sources['lib/math.lisp'] === '');
  await click('edit');
  await click('paste');
  await page.waitForFunction((text) => window.aioli.sources['lib/math.lisp'] === text, mathSource);
  await page.keyboard.press('Control+Enter');
  await ready();
  // The docked tree stays beside a live code buffer, without a modal window.
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((region) => region.id === 'window')),
    false,
  );
  const codeRegion = await page.evaluate(() =>
    window.aioli.regions.find((region) => region.id === 'source'),
  );
  assert.ok(codeRegion.origin[0] >= 280);
  const beforeCollapse = await page.evaluate(() => ({
    tab: window.aioli.state.tab,
    folders: window.aioli.state['open-folders'],
    offset: window.aioli.state['file-offset'],
  }));
  await click('collapse-files');
  await page.waitForFunction(
    () =>
      window.aioli.state['files-collapsed'] &&
      !window.aioli.regions.some((r) => r.id === 'files-tree'),
  );
  assert.equal(await page.evaluate(() => window.aioli.state['show-files']), true);
  assert.equal(
    await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'source').origin[0]),
    56,
  );
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'hide-files')),
    false,
  );
  await click('collapse-files');
  await page.waitForFunction(
    () =>
      !window.aioli.state['files-collapsed'] &&
      window.aioli.regions.some((r) => r.id === 'files-tree'),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      tab: window.aioli.state.tab,
      folders: window.aioli.state['open-folders'],
      offset: window.aioli.state['file-offset'],
    })),
    beforeCollapse,
  );

  await click('folder-lib');
  await click('file-lib/math.lisp');
  assert.equal(await page.evaluate(() => window.aioli.state['show-files']), true);
  await click('folder-lib');
  await page.waitForFunction(
    () => !window.aioli.regions.some((region) => region.id === 'file-lib/math.lisp'),
  );
  await click('folder-lib');
  await palette('(create-file "lib/actors/player.lisp" "(defn player-name [] 1)")');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.sources['lib/actors/player.lisp'],
  );
  await click('folder-lib/actors');
  await page.waitForFunction(() =>
    window.aioli.regions.some((r) => r.id === 'file-lib/actors/player.lisp'),
  );

  await click('file-lib/actors/player.lisp');
  assert.equal(await page.evaluate(() => window.aioli.state.tab), 'lib/actors/player.lisp');
  await click('close-tab-lib/actors/player.lisp');
  await page.waitForFunction(
    () => !JSON.parse(window.aioli.state['open-tabs']).includes('lib/actors/player.lisp'),
  );
  assert.ok(await page.evaluate(() => window.aioli.sources['lib/actors/player.lisp']));
  await click('file-lib/actors/player.lisp');
  await click('file-lib/actors/player.lisp');
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(window.aioli.state['open-tabs']).filter((k) => k === 'lib/actors/player.lisp')
          .length,
    ),
    1,
  );

  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('aioli.project.v3')).state['open-folders'].includes(
        'lib/actors',
      ) &&
      JSON.parse(localStorage.getItem('aioli.project.v3')).state['open-tabs'].includes(
        'lib/actors/player.lisp',
      ),
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  await page.waitForFunction(() =>
    window.aioli.regions.some((region) => region.id === 'file-lib/actors/player.lisp'),
  );
  assert.ok(
    await page.evaluate(() =>
      JSON.parse(window.aioli.state['open-tabs']).includes('lib/actors/player.lisp'),
    ),
  );
  await page.screenshot({ path: 'artifacts/file-pane.png' });
  // The explorer is navigation only, with pixel icons and contextual file actions.
  assert.equal(
    await page.evaluate(() =>
      window.aioli.regions.some((r) =>
        [
          'new-image',
          'new-audio',
          'files-prev',
          'files-next',
          'file-create',
          'file-delete',
        ].includes(r.id),
      ),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.resourcePath === 'editor')),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => window.aioli.regions.find((r) => r.id === 'file-lib/math.lisp').assetKind,
    ),
    'code',
  );
  async function context(id) {
    const row = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(row.origin[0] + Math.min(10, row.size[0] / 2), row.origin[1] + 10, {
      button: 'right',
    });
    await page.waitForFunction(() => window.aioli.state['file-context']);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  await context('folder-lib');
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'context-delete')),
    false,
  );
  await context('file-lib/math.lisp');
  await page.waitForFunction(() => window.aioli.state['context-path'] === 'lib/math.lisp');
  await click('context-new');
  await page.waitForFunction(() => document.querySelector('#text-input').value === 'lib/new.lisp');
  await page.keyboard.press('Escape');
  await context('folder-lib');
  await click('context-new');
  await page.waitForFunction(() => document.querySelector('#text-input').value === 'lib/new.lisp');
  await type('lib/context.lisp');
  await click('file-create');
  await page.waitForFunction(
    () => window.aioli.sources['lib/context.lisp'] && !window.aioli.pending,
  );
  await context('file-lib/context.lisp');
  await click('context-rename');
  await type('lib/renamed.lisp');
  await click('file-rename');
  await page.waitForFunction(
    () => window.aioli.sources['lib/renamed.lisp'] && !window.aioli.pending,
  );
  await context('file-lib/renamed.lisp');
  await page.screenshot({ path: 'artifacts/file-context.png' });
  await click('context-delete');
  await page.waitForFunction(
    () => !window.aioli.sources['lib/renamed.lisp'] && !window.aioli.pending,
  );
  // Import a large project fixture to exercise wheel scrolling and the scrollbar.
  const treeProject = await page.evaluate(() => ({
    version: 8,
    files: Object.fromEntries(
      Object.entries(window.aioli.sources)
        .filter(([key]) => !key.startsWith('__'))
        .map(([key, text]) => [key.includes('/') ? key : key + '.lisp', text]),
    ),
    state: window.aioli.editorState,
    applicationState: window.aioli.applicationState,
    resources: window.aioli.resources,
    recovery: false,
  }));
  const manyFiles = structuredClone(treeProject);
  manyFiles.state.tab = 'scroll-49.lisp';
  for (let i = 0; i < 50; i++)
    manyFiles.files[`scroll-${String(i).padStart(2, '0')}.lisp`] = '; fixture';
  await page.locator('#file-input').setInputFiles({
    name: 'scroll.aioli.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(manyFiles)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.regions.some((r) => r.id === 'files-scroll'),
  );
  await page.waitForFunction(
    () =>
      window.aioli.state.tab === 'scroll-49.lisp' &&
      JSON.parse(window.aioli.state['open-tabs']).includes('scroll-49.lisp'),
  );
  await page.mouse.move(100, 250);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => window.aioli.state['file-offset'] > 0);
  const scroll = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'files-scroll'),
  );
  await page.mouse.move(scroll.origin[0] + 4, scroll.origin[1] + scroll.size[1] - 8);
  await page.mouse.down();
  await page.mouse.move(scroll.origin[0] + 4, scroll.origin[1] + scroll.size[1] - 4);
  await page.waitForFunction(() => window.aioli.state['file-offset'] > 10);
  await page.mouse.up();
  await page.locator('#file-input').setInputFiles({
    name: 'restore.aioli.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(treeProject)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && !window.aioli.sources['scroll-00.lisp'],
  );
  await click('tab-game');
  await openFiles();
  await click('folder-examples');
  await click('file-examples/garden.scene.lisp');
  const originalScene = await page.evaluate(
    () => window.aioli.sources['examples/garden.scene.lisp'],
  );
  await type(
    '(import "../lib/math.lisp")\n(init! :scene-tick 0)\n' +
      originalScene.replace(
        '(defn update [dt]',
        '(defn update [dt] (set! :scene-tick (+ (get :scene-tick) dt))',
      ),
  );
  await page.keyboard.press('Control+Enter');
  await ready();
  await page.waitForFunction(() => window.aioli.state['scene-tick'] > 0);
  await palette('(game-set! :x 60) (set! :paused true)');
  await page.waitForFunction(() => window.aioli.state.x === 60 && window.aioli.state.paused);
  await page.screenshot({ path: 'artifacts/command-palette.png' });
  await type('center-player');
  await click('command-examples/commands/center-player.command.lisp');
  await page.waitForFunction(() => window.aioli.applicationState.x === 160);
  assert.equal(await page.evaluate(() => window.aioli.applicationState.vy), 0);
  await page.keyboard.press('Escape');
  await openFiles();
  await click('image-generator');
  await page.waitForFunction(() => window.aioli.commands.some((command) => command.meta[0] === 5));
  await type(
    '(init! :image-radius 48) (init! :image-x 160) (init! :image-y 120) (init! :image-color "#bbd6a6")\n(defpixel image [p time] (background "#ff0000") (fill (param :image-color)) (circle [(param :image-x) (param :image-y)] (param :image-radius)))',
  );
  await page.keyboard.press('Control+Enter');
  await ready();
  const beforeScene = await page.evaluate(() => window.aioli.shader);
  await click('image-color-control');
  await click('generator-keep');
  await page.waitForFunction(() => !!window.aioli.resources['assets/generated.png']);
  await page.screenshot({ path: 'artifacts/image-generator.png' });
  let download = page.waitForEvent('download');
  await click('generator-export');
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
  await openFiles();
  await click('audio-generator');
  await type(
    '(defn generate-sound [] (voice :triangle (get :sound-pitch) 220 1.5 (get :sound-gain)))',
  );
  await page.keyboard.press('Control+Enter');
  await ready();
  await click('generator-keep');
  await page.waitForFunction(() => !!window.aioli.resources['assets/generated.wav']);
  await click('generator-play');
  await page.screenshot({ path: 'artifacts/audio-generator.png' });
  download = page.waitForEvent('download');
  await click('generator-export');
  await (await download).saveAs('artifacts/generated.wav');
  const wav = await readFile('artifacts/generated.wav');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.ok(wav.length > 1000);
  await click('close-window');
  await click('folder-assets');
  await page.waitForFunction(() =>
    window.aioli.regions.some((r) => r.id === 'file-assets/generated.wav'),
  );
  assert.equal(
    await page.evaluate(
      () => window.aioli.regions.find((r) => r.id === 'file-assets/generated.wav').assetKind,
    ),
    'audio',
  );
  assert.equal(
    await page.evaluate(
      () => window.aioli.regions.find((r) => r.id === 'file-assets/generated.png').assetKind,
    ),
    'image',
  );
  await page.screenshot({ path: 'artifacts/file-assets.png' });
  await click('file-assets/generated.png');
  await page.waitForFunction(
    () => window.aioli.preview.ready && window.aioli.preview.width === 320,
  );
  assert.equal(await page.evaluate(() => window.aioli.state.window), 'image-asset');
  await page.waitForFunction(() => window.aioli.commands.some((c) => c.meta[0] === 6));
  const area = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'asset-image-area'),
  );
  await page.mouse.move(area.origin[0] + 80, area.origin[1] + 80);
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(() => window.aioli.state['preview-zoom'] > 1);
  const pan = await page.evaluate(() => window.aioli.state['preview-pan-x']);
  await page.mouse.down();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.mouse.move(area.origin[0] + 140, area.origin[1] + 100);
  await page.waitForFunction((pan) => window.aioli.state['preview-pan-x'] > pan + 30, pan);
  await page.mouse.up();
  await click('asset-fit');
  await page.waitForFunction(
    () => window.aioli.state['preview-zoom'] === 1 && window.aioli.state['preview-pan-x'] === 0,
  );
  await page.screenshot({ path: 'artifacts/image-asset-preview.png' });
  await click('close-window');
  await click('file-assets/generated.wav');
  await page.waitForFunction(() => window.aioli.preview.ready && window.aioli.preview.duration > 1);
  assert.equal(await page.evaluate(() => window.aioli.state.window), 'audio-asset');
  await click('asset-play');
  await page.waitForFunction(
    () => window.aioli.preview.playing && window.aioli.preview.position > 0.05,
  );
  await click('asset-play');
  await page.waitForFunction(
    () => !window.aioli.preview.playing && window.aioli.preview.position > 0,
  );
  const seek = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'asset-seek'));
  await page.mouse.click(seek.origin[0] + seek.size[0] / 2, seek.origin[1] + 20);
  await page.waitForFunction(
    () => window.aioli.preview.position > window.aioli.preview.duration * 0.45,
  );
  await page.screenshot({ path: 'artifacts/audio-asset-preview.png' });
  await click('asset-stop');
  await page.waitForFunction(() => window.aioli.preview.position === 0);
  await click('asset-play');
  await page.waitForFunction(() => window.aioli.preview.playing);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.aioli.preview.playing && !window.aioli.preview.ready);

  await click('audio-generator');

  await click('close-window');
  await palette(
    '(create-file "commands/custom.command.lisp" "(set! :x 23) (init! :command-runs 0) (set! :command-runs (+ (get :command-runs) 1)) (game-set! :command-game (get :command-runs)) (set! :command-result (game-get :command-game))")',
  );
  await page.waitForFunction(
    () => window.aioli.sources['commands/custom.command.lisp'] && !window.aioli.pending,
  );
  await page.keyboard.press('Escape');
  await openFiles();
  if (
    !(await page.evaluate(() =>
      JSON.parse(window.aioli.state['open-folders']).includes('commands'),
    ))
  )
    await click('folder-commands');
  await click('tab-game');
  const activeBeforeRun = await page.evaluate(() => window.aioli.state.tab);
  await click('run-commands/custom.command.lisp');
  await page.waitForFunction(
    () => window.aioli.state.x === 23 && window.aioli.status.includes('Executed'),
  );
  assert.equal(
    await page.evaluate(() => window.aioli.editorState['command-result']),
    await page.evaluate(() => window.aioli.applicationState['command-game']),
  );
  assert.equal(await page.evaluate(() => window.aioli.state.tab), activeBeforeRun);
  assert.equal(await page.evaluate(() => window.aioli.state.window), '');
  await page.screenshot({ path: 'artifacts/file-commands.png' });
  await context('run-commands/custom.command.lisp');
  await page.waitForFunction(
    () => window.aioli.state['context-path'] === 'commands/custom.command.lisp',
  );
  await page.screenshot({ path: 'artifacts/command-context.png' });
  await click('context-run');
  await page.waitForFunction(
    () => !window.aioli.state['file-context'] && window.aioli.state['command-runs'] === 2,
  );
  assert.equal(await page.evaluate(() => window.aioli.state.tab), activeBeforeRun);
  await page.locator('[data-region="run-commands/custom.command.lisp"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.aioli.state['command-runs'] === 3);
  assert.equal(await page.evaluate(() => window.aioli.state.tab), activeBeforeRun);
  await palette('');
  await type('custom');
  await click('command-commands/custom.command.lisp');
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
  assert.equal(project.version, 17);
  assert.ok(project.files['lib/math.lisp']);
  assert.ok(project.resources['assets/generated.png']);
  assert.ok(project.resources['assets/generated.wav']);
  assert.equal(project.files.__palette, undefined);
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.ok(await page.evaluate(() => window.aioli.sources['commands/custom.command.lisp']));
  assert.ok(await page.evaluate(() => window.aioli.resources['assets/generated.png']));
  await page.locator('#file-input').setInputFiles('artifacts/project-v3.json');
  await page.waitForFunction(
    () => document.querySelector('#file-input').value === '' && !window.aioli.pending,
  );
  await ready();
  // Native resource import is a reversible project operation, with no server.
  await page
    .locator('#resource-input')
    .setInputFiles({ name: 'imported-tone.wav', mimeType: 'audio/wav', buffer: wav });
  await page.waitForFunction(() => !!window.aioli.resources['assets/imported-tone.wav']);
  // An older/custom saved shell remains the project source in recovery. File
  // operations must not silently switch back to that shell after evaluation.
  const oldEditor = '(defn draw [] (background "#101613"))\n; custom old editor';
  const oldUI = project.files['editor/ui/components.lisp'] + '\n; custom old library';
  const oldProject = {
    ...project,
    recovery: false,
    files: { ...project.files, 'main.lisp': oldEditor, 'editor/ui/components.lisp': oldUI },
  };
  oldProject.files['examples/generators/audio.generator.lisp'] =
    '(init! :sound-wave "sine") (init! :sound-pitch 440) (init! :sound-end 880) (init! :sound-duration 0.3) (init! :sound-gain 0.35)\n' +
    oldProject.files['examples/generators/audio.generator.lisp'];
  await page.locator('#file-input').setInputFiles({
    name: 'old-project.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(oldProject)),
  });
  await page.waitForFunction(
    (oldEditor) => !window.aioli.pending && window.aioli.sources.main === oldEditor,
    oldEditor,
  );
  await page.keyboard.press('F2');
  await openFiles();
  await click('new-file');
  await type('lib/recovery.lisp');
  await click('file-create');
  await page.waitForFunction(
    () => !window.aioli.pending && !!window.aioli.sources['lib/recovery.lisp'],
  );
  assert.equal(await page.evaluate(() => window.aioli.recovery), true);
  assert.equal(await page.evaluate(() => window.aioli.sources.main), oldEditor);
  await openFiles();
  await click('files');
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
      !window.aioli.pending && !window.aioli.recovery && window.aioli.sources.main !== oldEditor,
    oldEditor,
  );
  assert.equal(await page.evaluate(() => window.aioli.sources['main-backup-1.lisp']), oldEditor);
  assert.equal(
    await page.evaluate(() => window.aioli.sources['editor/ui/components-backup-1.lisp']),
    oldUI,
  );
  await openFiles();
  await click('files');
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running && !window.aioli.recovery);
  await openFiles();
  await click('files');
  await page.setViewportSize({ width: 390, height: 844 });
  await click('about');
  assert.ok(
    await page.evaluate(() =>
      window.aioli.regions
        .filter((region) => region.menuItem)
        .every(
          (region) => region.origin[0] >= 0 && region.origin[0] + region.size[0] <= innerWidth,
        ),
    ),
  );
  await page.screenshot({ path: 'artifacts/menu-mobile.png' });
  await page.keyboard.press('Escape');
  await openFiles();
  await click('folder-lib');
  await page.screenshot({ path: 'artifacts/file-pane-mobile.png' });
  await click('collapse-files');
  await page.waitForFunction(
    () =>
      window.aioli.state['files-collapsed'] && window.aioli.regions.some((r) => r.id === 'source'),
  );
  assert.ok(
    await page.evaluate(() => {
      const r = window.aioli.regions.find((r) => r.id === 'source');
      return r.origin[0] >= 40 && r.origin[0] + r.size[0] <= 390;
    }),
  );
  await click('collapse-files');
  await page.waitForFunction(() => !window.aioli.state['files-collapsed']);

  await click('file-lib/math.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.state['show-files'] &&
      window.aioli.regions.some((region) => region.id === 'source'),
  );
  await palette('(set! :x 19)');
  await page.waitForFunction(() => window.aioli.state.x === 19);
  await page.keyboard.press('Escape');
  await click('project');
  await click('image-generator');
  await page.screenshot({ path: 'artifacts/image-generator-mobile.png' });
  await page.waitForFunction(() =>
    window.aioli.regions.some(
      (region) =>
        region.id === 'generator-export' &&
        region.origin[0] + region.size[0] <= 390 &&
        region.origin[1] + region.size[1] <= 844,
    ),
  );
  // Lifecycle hooks are independent of filenames, and unused former roots are inert.
  await page.setViewportSize({ width: 1440, height: 900 });
  const lifecycleGame = `(init! :hook-inits 0)
(init! :hook-reloads 0)
(init! :hook-ticks 0)
(init! :radius 20)
(defn init [] (set! :hook-inits (+ (get :hook-inits) 1)))
(defn reload [] (set! :hook-reloads (+ (get :hook-reloads) 1)))
(defn update [dt] (set! :hook-ticks (+ (get :hook-ticks) dt)))
(defpixel render [p time] (background "#101613") (fill "#bbd6a6") (circle [160 120] (param :radius)))`;
  const lifecycleProject = {
    ...project,
    recovery: false,
    applicationState: {},
    files: {
      ...project.files,
      'examples/generators/audio.generator.lisp':
        oldProject.files['examples/generators/audio.generator.lisp'],
      'game.lisp': lifecycleGame,
      'main.lisp': project.files['main.lisp'],
      'scene.lisp': '(unused-error)',
      'audio.lisp': '(',
    },
    state: {
      tab: 'game',
      'open-tabs': '["main","game"]',
      'show-code': true,
      'show-files': false,
      paused: false,
    },
  };
  await page.locator('#file-input').setInputFiles({
    name: 'lifecycle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(lifecycleProject)),
  });
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.state['hook-inits'] === 1 &&
      window.aioli.state['hook-ticks'] > 0,
  );
  await ready();
  assert.equal(await page.evaluate(() => window.aioli.state['hook-reloads']), 0);
  assert.equal(await page.evaluate(() => window.aioli.primitives), 1);
  await type(lifecycleGame + '\n; Accepted live edit');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['hook-reloads'] === 1,
  );
  assert.equal(await page.evaluate(() => window.aioli.state['hook-inits']), 1);
  await click('reset');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['hook-reloads'] === 0,
  );
  assert.equal(await page.evaluate(() => window.aioli.state['hook-inits']), 1);
  await palette('(delete-file "scene.lisp") (delete-file "audio.lisp")');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      !('scene' in window.aioli.sources) &&
      !('audio' in window.aioli.sources),
  );
  await ready();
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(
    await page.evaluate(() => 'scene' in window.aioli.sources || 'audio' in window.aioli.sources),
    false,
  );
  // Swap scoped scenes transactionally; a rejected shader never leaves the old scene.
  const makeScene = (
    tag,
    extra = '',
  ) => `(defn enter [] (set! :exit-before-enter (get :scene-exits)) (set! :scene-label "${tag}") (set! :scene-enters (+ (get :scene-enters) 1)))
(defn exit [] (set! :scene-exits (+ (get :scene-exits) 1)))
(defn update [dt] (set! :scene-clock (+ (get :scene-clock) dt)))
(defpixel render [p time] (background "#101613") (fill "#bbd6a6") (circle [160 120] 20) ${extra})`;
  const sceneProject = {
    ...lifecycleProject,
    applicationState: {},
    files: {
      ...lifecycleProject.files,
      'game.lisp':
        '(init! :scene-enters 0) (init! :scene-exits 0) (init! :scene-clock 0) (start-scene "scenes/a.scene.lisp")',
      'scenes/a.scene.lisp': makeScene('A'),
      'scenes/b.scene': makeScene('B', '(rect [10 10] [20 20])'),
      'scenes/bad.scene.lisp': '(defpixel render [p time] (circle 3 2))',
    },
    state: { tab: 'game', 'show-code': true },
  };
  await page.locator('#file-input').setInputFiles({
    name: 'scenes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sceneProject)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['scene-label'] === 'A',
  );
  await ready();
  await palette('(start-scene "scenes/bad.scene.lisp")');
  await page.waitForFunction(() => !window.aioli.pending && window.aioli.error);
  assert.equal(
    await page.evaluate(() => window.aioli.state['active-scene']),
    'scenes/a.scene.lisp',
  );
  assert.equal(await page.evaluate(() => window.aioli.state['scene-exits']), 0);
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  await page.keyboard.press('Escape');
  await palette('(start-scene "scenes/b.scene")');
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state['scene-label'] === 'B',
  );
  await ready();
  assert.equal(await page.evaluate(() => window.aioli.state['scene-enters']), 2);
  assert.equal(await page.evaluate(() => window.aioli.state['scene-exits']), 1);
  assert.equal(await page.evaluate(() => window.aioli.state['exit-before-enter']), 1);
  assert.equal(await page.evaluate(() => window.aioli.primitives), 2);
  await page.keyboard.press('Escape');
  await openFiles();
  assert.equal(
    await page.evaluate(
      () => window.aioli.regions.find((r) => r.id === 'file-game.lisp').assetKind,
    ),
    'main-entry',
  );
  assert.equal(
    await page.evaluate(
      () => window.aioli.regions.find((r) => r.id === 'file-main.lisp').assetKind,
    ),
    'editor-entry',
  );
  await page.screenshot({ path: 'artifacts/scene-entry-icons.png' });
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('aioli.project.v3')).applicationState['active-scene'] ===
      'scenes/b.scene',
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(await page.evaluate(() => window.aioli.state['active-scene']), 'scenes/b.scene');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: source tabs, live component modules, image pan/zoom, audio waveform/playback/seek, named files, imports, commands, generators, persistence and narrow widgets.',
  );
} catch (error) {
  console.log(
    await page.evaluate(() => ({
      status: window.aioli?.status,
      state: window.aioli?.state,
      command: window.aioli?.sources['commands/custom.command.lisp'],
      input: document.querySelector('#text-input').value,
    })),
  );
  await page.screenshot({ path: 'artifacts/widgets-failure.png' });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}
