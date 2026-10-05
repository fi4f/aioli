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

  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')));
  const prefix = Array.from({ length: 40 }, (_, i) => `row-${i},é 🌱\n`).join('');
  project.files['level.generator.lisp'] = `(generator :text "Level data" "levels/generated.csv")
(init! :level-value 10 ["Value" 1 64 1])
(defn generate-text [] (str ${JSON.stringify(prefix)} (get :level-value) "\\n"))`;
  project.state['show-files'] = true;
  project.state['open-folders'] = '[]';
  await page.locator('#file-input').setInputFiles({
    name: 'text.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.sources['level.generator.lisp'],
  );
  await click('file-level.generator.lisp');
  await page.waitForFunction(
    () =>
      window.aioli.state.window === 'generator' &&
      window.aioli.regions.some((r) => r.id === 'generator-generate'),
  );
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  const slider = page.locator('[data-region="generator-field-level-value"]');
  await slider.fill('23');
  await slider.dispatchEvent('input');
  await page.waitForFunction(() => window.aioli.editorState['level-value'] === 23);
  const preview = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'generator-text-scroll'),
  );
  await page.mouse.move(preview.origin[0] + 50, preview.origin[1] + 30);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => window.aioli.editorState['text-preview-offset'] > 0);
  await click('generator-keep');
  await page.waitForFunction(() => window.aioli.resources['levels/generated.csv']);
  const expected = prefix + '23\n';
  const actual = await page.evaluate(async () =>
    (await fetch(window.aioli.resources['levels/generated.csv'].data)).text(),
  );
  assert.equal(actual, expected);
  assert.equal(
    await page.evaluate(() => window.aioli.resources['levels/generated.csv'].mime),
    'text/csv;charset=utf-8',
  );
  const downloading = page.waitForEvent('download');
  await click('generator-export');
  const downloaded = await downloading;
  assert.equal(downloaded.suggestedFilename(), 'generated.csv');
  await mkdir('artifacts', { recursive: true });
  await downloaded.saveAs('artifacts/generated-level.csv');
  assert.equal(await readFile('artifacts/generated-level.csv', 'utf8'), expected);
  await click('close-window');
  await click('folder-levels');
  await click('file-levels/generated.csv');
  await page.waitForFunction(
    () =>
      window.aioli.state.window === 'text-asset' && document.querySelector('#text-input').readOnly,
  );
  assert.equal(await page.locator('#text-input').inputValue(), expected);
  await page.screenshot({ path: 'artifacts/generated-text-resource.png' });
  await click('close-window');
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.equal(
    await page.evaluate(async () =>
      (await fetch(window.aioli.resources['levels/generated.csv'].data)).text(),
    ),
    expected,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Text inspector, live output, scrolling, exact UTF-8 keep/download, read-only resource preview and persistence passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
