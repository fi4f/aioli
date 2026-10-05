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
async function click(id) {
  const r = await region(id);
  await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function source(tab, text) {
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

  const original = await page.evaluate(() => window.aioli.sources.scene);
  // An unfinished quote must reach the canvas immediately, even though the
  // strict reader rejects it. Verify the quote glyph in the source region.
  await source('scene', '"');
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
  await page.waitForFunction(() => window.aioli.sources.scene === '"hello\\');
  await source('scene', original);
  await evaluated();
  await source('scene', original + '\n(');
  await page.waitForFunction(() => window.aioli.error);
  assert.ok(await page.evaluate(() => window.aioli.running));
  await source('scene', '(defpixel bad [p time] (background (pow [0.1 0.2 0.3] 2)))');
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.match(await page.evaluate(() => window.aioli.status), /WGSL/);
  await source('scene', original);
  await evaluated();

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

  // Editing Lisp changes the actual fullscreen UI and its pixel output.
  const editor = await page.evaluate(() => window.aioli.sources.editor);
  await source(
    'editor',
    editor
      .replace('(text [24 18] "aioli")', '(text [24 18] "made in lisp")')
      .replace('(background (get :ui-bg))', '(background "#16221a")'),
  );
  await evaluated();
  assert.ok(
    await page.evaluate(() =>
      window.aioli.commands.some((c) => c.bounds[2] === innerWidth && c.color[0] > 0.08),
    ),
  );
  await source('editor', editor);
  await evaluated();
  const ui = await page.evaluate(() => window.aioli.sources.ui);
  await source('ui', ui.replace('"#191f1b"', '"#26322a"'));
  await evaluated();
  await source('ui', ui);
  await evaluated();

  // Recovery remains available even if a valid editor program hides all UI.
  await source('editor', '(defn editor [] (background "#101613"))');
  await evaluated();
  await page.waitForFunction(() => window.aioli.regions.length === 0);
  await page.keyboard.press('F2');
  await region('source');
  assert.ok(await page.evaluate(() => window.aioli.recovery));
  await source('editor', editor);
  await evaluated();
  await click('tab-scene');
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
    version: 2,
    sources: {
      ...Object.fromEntries(
        ['scene', 'game', 'audio', 'editor', 'ui'].map((key) => [key, window.aioli.sources[key]]),
      ),
      editor:
        window.aioli.sources.editor.replace(
          '(text [24 18] "aioli")',
          '(text [24 18] "pixel lisp")',
        ) + '\n; custom editor retained',
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
    await nested.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'project'));
    const projectRegion = await nested.evaluate(() =>
      window.aioli.regions.find((r) => r.id === 'project'),
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
