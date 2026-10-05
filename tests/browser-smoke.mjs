import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    'C:/Users/smcge/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
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
page.on('pageerror', (e) => errors.push(e.message));
async function region(id) {
  await page.waitForFunction((id) => window.aioli?.regions.some((r) => r.id === id), id);
  return page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
}
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
  'image-generator': 'view',
  'audio-generator': 'view',
  'upgrade-editor': 'project',
  code: 'view',
  files: 'view',
  tools: 'view',
  commands: 'view',
  wgsl: 'view',
};
async function click(id) {
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
  const r = await region(id);
  await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function source(tab, text) {
  if (
    tab.includes('/') &&
    !(await page.evaluate(
      (key) => JSON.parse(window.aioli.state['open-tabs'] ?? '[]').includes(key),
      tab,
    ))
  ) {
    if (!(await page.evaluate(() => window.aioli.state['show-files']))) await click('files');
    const parts = tab.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (
        !(await page.evaluate(
          (path) => JSON.parse(window.aioli.state['open-folders']).includes(path),
          folder,
        ))
      )
        await click('folder-' + folder);
    }
    await click('file-' + tab);
  }

  await click(`tab-${tab}`);
  await page.waitForFunction((tab) => window.aioli.state.tab === tab, tab);
  const r = await region('source');
  await page.mouse.click(r.origin[0] + 55, r.origin[1] + 5);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Control+Enter');
}
async function evaluated() {
  await page.waitForFunction(() => !window.aioli.pending);
  assert.equal(
    await page.evaluate(() => window.aioli.error),
    false,
    await page.evaluate(() => window.aioli.status),
  );
}
try {
  await page.goto('http://127.0.0.1:4173');
  await page.waitForFunction(() => window.aioli);
  console.log('Startup:', await page.evaluate(() => window.aioli.status));
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/fullscreen-editor.png' });
  assert.ok(
    await page.evaluate(() => window.aioli.running),
    await page.evaluate(() => window.aioli.status),
  );
  await region('source');
  // Only the fullscreen canvas paints. No visible native widget/dashboard UI.
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return (
            r.width > 5 &&
            r.height > 5 &&
            s.display !== 'none' &&
            s.visibility !== 'hidden' &&
            s.opacity !== '0' &&
            !el.closest('.sr-only')
          );
        })
        .map((el) => el.tagName),
    ),
    ['CANVAS'],
  );
  assert.ok(
    await page.evaluate(() => window.aioli.commands.some((c) => c.meta[0] === 3)),
    'Text is a GPU pixel primitive',
  );
  assert.ok(
    await page.evaluate(() => window.aioli.commands.some((c) => c.meta[0] === 4)),
    'Game is sampled into the editor canvas',
  );

  const original = await page.evaluate(() => window.aioli.sources['scenes/garden.scene.lisp']);
  // An unfinished quote must reach the canvas immediately, even though the
  // strict reader rejects it. Verify the quote glyph in the source region.
  await source('scenes/garden.scene.lisp', '"');
  await page.waitForFunction(() => window.aioli.error);
  const sourceBox = await region('source');
  await page.waitForFunction(
    (box) =>
      window.aioli.commands.some(
        (c) =>
          c.meta[0] === 3 &&
          c.detail[0] === 16 &&
          c.detail[1] === 0 &&
          c.bounds[0] === box.origin[0] + 40 &&
          c.bounds[1] === box.origin[1],
      ),
    sourceBox,
  );
  await page.screenshot({
    path: 'artifacts/unfinished-quote.png',
    clip: { x: sourceBox.origin[0], y: sourceBox.origin[1], width: 220, height: 42 },
  });
  await page.keyboard.insertText('hello\\');
  await page.waitForFunction(() => window.aioli.sources['scenes/garden.scene.lisp'] === '"hello\\');
  await source('scenes/garden.scene.lisp', original);
  await evaluated();
  await source('scenes/garden.scene.lisp', original + '\n(');
  await page.waitForFunction(() => window.aioli.error);
  assert.ok(await page.evaluate(() => window.aioli.running));
  await source(
    'scenes/garden.scene.lisp',
    '(defpixel render [p time] (background (pow [0.1 0.2 0.3] 2)))',
  );
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.match(await page.evaluate(() => window.aioli.status), /WGSL/);
  await source('scenes/garden.scene.lisp', original);
  await evaluated();

  // Imported CRLF, Unicode fallbacks and tabs share the textarea's true offsets.
  const selectionFixture = ';A\u{1f642}B\tC\r\n;D\u00e9F\r\n;G\u{1f600}H';
  await page.locator('#resource-input').setInputFiles({
    name: 'selection.lisp',
    mimeType: 'text/plain',
    buffer: Buffer.from(selectionFixture),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.sources['assets/selection.lisp'],
  );
  assert.equal(
    await page.evaluate(() => window.aioli.sources['assets/selection.lisp'].includes('\r')),
    false,
  );
  await source('assets/selection.lisp', selectionFixture.replaceAll('\r\n', '\n'));
  await evaluated();
  const selectionBox = await region('source');
  await page.mouse.click(selectionBox.origin[0] + 40 + 2 * 8, selectionBox.origin[1] + 5);
  await page.keyboard.press('Shift+ArrowRight');
  assert.deepEqual(
    await page.evaluate(() => {
      const input = document.querySelector('#text-input');
      return [
        input.selectionStart,
        input.selectionEnd,
        input.value.slice(input.selectionStart, input.selectionEnd),
      ];
    }),
    [2, 4, '\u{1f642}'],
  );
  await page.waitForFunction(
    (box) =>
      window.aioli.commands.some(
        (c) =>
          c.meta[0] === 0 &&
          c.bounds[0] === box.origin[0] + 56 &&
          c.bounds[1] === box.origin[1] &&
          c.bounds[2] === 8 &&
          c.bounds[3] === 21,
      ),
    selectionBox,
  );
  await page.mouse.click(selectionBox.origin[0] + 40 + 3 * 8, selectionBox.origin[1] + 21 + 5);
  assert.equal(await page.evaluate(() => document.querySelector('#text-input').selectionStart), 11);
  await page.mouse.click(selectionBox.origin[0] + 40 + 2 * 8, selectionBox.origin[1] + 42 + 5);
  await page.mouse.down();
  await page.mouse.move(selectionBox.origin[0] + 40 + 4 * 8, selectionBox.origin[1] + 42 + 5);
  await page.mouse.up();
  assert.equal(
    await page.evaluate(() => {
      const input = document.querySelector('#text-input');
      return input.value.slice(input.selectionStart, input.selectionEnd);
    }),
    '\u{1f600}H',
  );
  await page.screenshot({ path: 'artifacts/unicode-selection.png' });
  await click('tab-main');
  if (await page.evaluate(() => window.aioli.state['show-files'])) await click('files');

  // Use the pixel slider by dragging, not an HTML input.
  await click('tools');
  await region('moon');
  const slider = await region('moon');
  await page.mouse.move(slider.origin[0] + 2, slider.origin[1] + 8);
  await page.mouse.down();
  await page.mouse.move(slider.origin[0] + slider.size[0] * 0.75, slider.origin[1] + 8, {
    steps: 5,
  });
  await page.waitForFunction(() => window.aioli.state.moon > 25);
  await page.mouse.up();
  const moon = await page.evaluate(() => window.aioli.state.moon);
  await click('evaluate');
  await evaluated();
  assert.equal(await page.evaluate(() => window.aioli.state.moon), moon);
  await click('tools');

  // Editing imported component files changes the actual fullscreen pixel UI.
  const editor = await page.evaluate(() => window.aioli.sources.editor);
  const workspace = await page.evaluate(() => window.aioli.sources['editor/workspace.lisp']);
  await source(
    'editor/workspace.lisp',
    workspace.replace('(background (get :ui-bg))', '(background "#16221a")'),
  );
  await evaluated();
  assert.deepEqual(await page.evaluate(() => window.aioli.commands[0].color), [
    22 / 255,
    34 / 255,
    26 / 255,
    1,
  ]);
  await source('editor/workspace.lisp', workspace);
  await evaluated();
  const buttons = await page.evaluate(() => window.aioli.sources['ui/buttons.lisp']);
  await source('ui/buttons.lisp', buttons.replace('"#191f1b"', '"#26322a"'));
  await evaluated();
  assert.ok(
    await page.evaluate(() =>
      window.aioli.commands.some(
        (c) => c.meta[0] === 0 && c.color[0] === 38 / 255 && c.color[1] === 50 / 255,
      ),
    ),
  );
  await source('ui/buttons.lisp', buttons);
  await evaluated();

  if (await page.evaluate(() => window.aioli.state['show-files'])) await click('files');

  // Recovery remains available even if a valid editor program hides all UI.
  await source('editor', '(defn editor [] (background "#101613"))');
  await evaluated();
  await page.waitForFunction(() => window.aioli.regions.length === 0);
  await page.keyboard.press('F2');
  await region('source');
  assert.ok(await page.evaluate(() => window.aioli.recovery));
  await source('editor', editor);
  await evaluated();
  await click('tab-main');
  for (const expected of [18, 9, 93]) {
    await click('project');
    await click('preset');
    await evaluated();
    assert.equal(await page.evaluate(() => window.aioli.primitives), expected);
  }

  await click('world');
  const x = await page.evaluate(() => window.aioli.state.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction((x) => window.aioli.state.x > x, x);
  await page.keyboard.up('ArrowRight');
  await click('tools');
  await click('sound');
  await region('wav');
  let event = page.waitForEvent('download');
  await click('wav');
  assert.equal((await event).suggestedFilename(), 'aioli-patch.wav');
  await click('audition');
  await click('tools');
  await click('project');
  event = page.waitForEvent('download');
  await click('png');
  await (await event).saveAs('artifacts/aioli.png');
  await click('project');
  event = page.waitForEvent('download');
  await click('export');
  await (await event).saveAs('artifacts/project.json');
  await page.locator('#file-input').setInputFiles('artifacts/project.json');
  await evaluated();
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(await page.evaluate(() => window.aioli.state.moon), moon);
  await region('source');
  await page.screenshot({ path: 'artifacts/fullscreen-editor.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('canvas').width === 390);
  await click('code');
  await region('world');
  await page.screenshot({ path: 'artifacts/fullscreen-mobile.png' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  // Rename compatibility: old saves keep state and custom editor code.
  const legacy = await page.evaluate(() => ({
    version: 5,
    files: {
      ...Object.fromEntries(
        Object.entries(window.aioli.sources)
          .filter(([key]) => !key.startsWith('__'))
          .map(([key, value]) => [key.includes('/') ? key : key + '.lisp', value]),
      ),
      'editor.lisp':
        window.aioli.sources.editor.replace(
          '(text [24 18] "aioli")',
          '(text [24 18] "pixel lisp")',
        ) + '\n(defn legacy-brand [] (text [24 18] "pixel lisp"))\n; custom editor retained',
    },
    state: { ...window.aioli.state, moon: 17 },
  }));
  const migration = await browser.newPage();
  await migration.addInitScript(
    (project) => localStorage.setItem('pixel-lisp.project.v2', JSON.stringify(project)),
    legacy,
  );
  await migration.goto('http://127.0.0.1:4173');
  await migration.waitForFunction(() => window.aioli?.running);
  assert.equal(await migration.evaluate(() => window.aioli.state.moon), 17);
  assert.match(
    await migration.evaluate(() => window.aioli.sources.editor),
    /custom editor retained/,
  );
  assert.match(
    await migration.evaluate(() => window.aioli.sources.editor),
    /\(text \[24 18\] "aioli"\)/,
  );
  assert.ok(await migration.evaluate(() => localStorage.getItem('aioli.project.v3')));
  await migration.close();
  // A real static server mounted below a repository path catches root-relative
  // assets, Lisp source fetches, and documentation URLs that break on Pages.
  const projectServer = createStaticServer({ basePath: '/aioli/' });
  await new Promise((resolve) => projectServer.listen(0, '127.0.0.1', resolve));
  try {
    const nested = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const nestedUrl = `http://127.0.0.1:${projectServer.address().port}/aioli/`;
    await nested.goto(nestedUrl);
    await nested.waitForFunction(() => window.aioli?.running);
    await nested.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'about'));
    const projectRegion = await nested.evaluate(() =>
      window.aioli.regions.find((r) => r.id === 'about'),
    );
    await nested.mouse.click(projectRegion.origin[0] + 10, projectRegion.origin[1] + 10);
    await nested.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'docs'));
    const docsRegion = await nested.evaluate(() =>
      window.aioli.regions.find((r) => r.id === 'docs'),
    );
    const opened = nested.waitForEvent('popup');
    await nested.mouse.click(docsRegion.origin[0] + 10, docsRegion.origin[1] + 10);
    const documentation = await opened;
    await documentation.waitForLoadState();
    assert.equal(new URL(documentation.url()).pathname, '/aioli/docs/');
    assert.equal(await documentation.title(), 'aioli documentation');
    await documentation.screenshot({ path: 'artifacts/docs.png', fullPage: true });
    await documentation.getByRole('link', { name: 'Language', exact: true }).click();
    assert.equal(new URL(documentation.url()).pathname, '/aioli/docs/language.html');
    await documentation.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await documentation.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    await documentation.close();
    await nested.close();
  } finally {
    await new Promise((resolve) => {
      projectServer.close(resolve);
      projectServer.closeAllConnections();
    });
  }
  console.log(
    'PASS: fullscreen pixel UI, custom Lisp drawing/widgets, source input, recovery, WebGPU presets, pointer sliders, gameplay, exports, persistence, narrow layout.',
  );
} finally {
  await browser.close();
}
