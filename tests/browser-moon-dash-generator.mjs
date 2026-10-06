import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
import { createRuntime, parse } from '../lisp.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  const generator = 'examples/generators/moon-dash.generator.lisp';
  assert.ok(await page.evaluate((path) => window.aioli.sources[path], generator));
  await page.evaluate((path) => {
    const project = JSON.parse(localStorage.getItem('aioli.project'));
    Object.assign(project.state, {
      window: 'generator',
      'show-generator': true,
      'active-generator': path,
    });
    localStorage.setItem('aioli.project', JSON.stringify(project));
  }, generator);
  await page.reload();
  await page.waitForFunction(() =>
    window.aioli?.regions.some((r) => r.id === 'generator-field-chart-seed'),
  );
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
  }
  async function keptText(expectChange = false) {
    const previous = await page.evaluate(
      () => window.aioli.resources['levels/moon-dash-chart.lisp']?.data,
    );
    await click('generator-keep');
    await page.waitForFunction(() => window.aioli.resources['levels/moon-dash-chart.lisp']);
    if (expectChange)
      await page.waitForFunction(
        (previous) => window.aioli.resources['levels/moon-dash-chart.lisp'].data !== previous,
        previous,
      );
    return page.evaluate(async () =>
      (await fetch(window.aioli.resources['levels/moon-dash-chart.lisp'].data)).text(),
    );
  }
  const original = await keptText();
  const input = page.locator('[data-region="generator-field-chart-seed"]');
  await input.fill('14');
  await input.dispatchEvent('input');
  await page.waitForFunction(() => window.aioli.editorState['chart-seed'] === 14);
  const changed = await keptText(true);
  assert.notEqual(changed, original);
  await click('generator-generate');
  assert.equal(await keptText(), changed);
  const runtime = createRuntime({});
  runtime.load(parse(`(defn chart [] ${changed})`));
  assert.ok(runtime.call('chart').length > 0);
  const downloading = page.waitForEvent('download');
  await click('generator-export');
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'moon-dash-chart.lisp');
  await mkdir('artifacts', { recursive: true });
  await download.saveAs('artifacts/moon-dash-chart.lisp');
  assert.equal(await readFile('artifacts/moon-dash-chart.lisp', 'utf8'), changed);
  await page.screenshot({ path: 'artifacts/moon-dash-generator.png' });
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Moon Dash generator discovery, live parameters, deterministic generation, Keep and Download passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
