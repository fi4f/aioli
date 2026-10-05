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

  assert.deepEqual(
    await page.evaluate(() =>
      [
        ...new Set(
          Object.keys(window.aioli.sources)
            .filter((p) => p.includes('/'))
            .map((p) => p.split('/')[0]),
        ),
      ].sort(),
    ),
    ['editor', 'examples'],
  );
  async function create(name, type, expected, output) {
    await click('file');
    await click('new-file');
    await click('file-type-' + type);
    if (output) await click('generator-output-' + output);
    const input = await page.evaluate(() =>
      window.aioli.regions.filter((r) => r.id === 'source').at(-1),
    );
    await page.mouse.click(input.origin[0] + 12, input.origin[1] + 12);
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(name);
    await click('file-create');
    await page.waitForFunction(
      (path) => !window.aioli.pending && Object.hasOwn(window.aioli.sources, path),
      expected,
    );
    assert.equal(await page.evaluate(() => window.aioli.error), false);
    return await page.evaluate((path) => window.aioli.sources[path], expected);
  }
  assert.equal(await create('notes.txt', 'none', 'notes.txt'), '');
  assert.match(await create('helper', 'script', 'helper.lisp'), /Ordinary Lisp/);
  assert.match(await create('test.lisp', 'scene', 'test.scene.lisp'), /defdraw render/);
  assert.match(await create('reset.scene.lisp', 'command', 'reset.command.lisp'), /game-get/);
  assert.match(
    await create('picture', 'generator', 'picture.generator.lisp', 'image'),
    /generator :image/,
  );
  assert.match(
    await create('tone.lisp', 'generator', 'tone.generator.lisp', 'audio'),
    /generator :audio/,
  );
  assert.match(await create('text', 'generator', 'text.generator.lisp', 'text'), /generator :text/);
  // The scene starter is immediately playable.
  await click('view');
  await click('files');
  await click('play-test.scene.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending && window.aioli.applicationState['active-scene'] === 'test.scene.lisp',
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  await page.setViewportSize({ width: 390, height: 600 });
  await click('file');
  await click('new-file');
  await click('file-type-generator');
  const panel = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'file-path-panel'),
  );
  assert.ok(panel.origin[0] >= 0 && panel.origin[0] + panel.size[0] <= 390);
  assert.ok(panel.origin[1] + panel.size[1] <= 600);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/new-file-types-narrow.png' });
  assert.deepEqual(errors, []);
  console.log(
    'New file types, exact plain filenames, playable scene and generator starters, and narrow dialog passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
