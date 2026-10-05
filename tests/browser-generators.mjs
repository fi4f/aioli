import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
import { projectSnapshot } from '../project.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1.25,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.aioli?.running);
  const sources = await page.evaluate(() => window.aioli.sources);
  sources.main += '\n; custom editor entry';
  sources['reset.command.lisp'] = '(set! :command-counter 3)';
  sources['commands/helper.lisp'] = '(defn helper [] 1)';
  sources['textures/stripe.generator.lisp'] = `
    (generator :image "Custom shape")
    (init! :custom-size 3 ["Size" 0 10 0.5])
    (init! :custom-enabled true ["Enabled"])
    (init! :custom-color "#bbd6a6" ["Tint"])
    (init! :custom-name "Example" ["Name"])
    (init! :custom-choice "one" ["Mode" ["one" "two"]])
    (defpixel image [p time]
      (background "#101613")
      (fill (param :custom-color))
      (circle [160 120] (* 10 (param :custom-size))))`;
  const project = projectSnapshot(sources, {
    paused: true,
    window: 'generator',
    'active-generator': 'textures/stripe.generator.lisp',
  });
  await page.evaluate(
    (project) => localStorage.setItem('aioli.project.v3', JSON.stringify(project)),
    project,
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      window.aioli?.running &&
      window.aioli.regions.some((r) => r.id === 'generator-field-custom-size'),
  );
  assert.equal(await page.evaluate(() => window.aioli.state.tab), 'game');
  async function region(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    return page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
  }
  async function click(id) {
    const r = await region(id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  const slider = await region('generator-field-custom-size');
  assert.equal(slider.low, 0);
  assert.equal(slider.high, 10);
  assert.equal(slider.step, 0.5);
  assert.equal(
    await page.locator('[data-region="generator-field-custom-size"]').getAttribute('step'),
    '0.5',
  );
  await click('generator-field-custom-size');
  assert.equal(await page.evaluate(() => window.aioli.state['custom-size']), 5);
  await click('generator-field-custom-enabled');
  assert.equal(await page.evaluate(() => window.aioli.state['custom-enabled']), false);
  await click('generator-field-custom-choice');
  assert.equal(await page.evaluate(() => window.aioli.state['custom-choice']), 'two');
  await click('generator-field-custom-name');
  await region('inspector-apply');
  const edit = await page.evaluate(() =>
    window.aioli.regions.filter((r) => r.id === 'source').at(-1),
  );
  await page.mouse.click(edit.origin[0] + 12, edit.origin[1] + 12);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('Changed');
  await click('inspector-apply');
  assert.equal(await page.evaluate(() => window.aioli.state['custom-name']), 'Changed');
  await click('generator-keep');
  await page.waitForFunction(() => window.aioli.resources['assets/generated.png']);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/generator-inspector.png' });
  // Cycles to an audio generator with the same inspector and output actions.
  await click('generator-select');
  await region('generator-play');
  await click('generator-keep');
  await page.waitForFunction(() => window.aioli.resources['assets/generated.wav']);
  await click('close-window');
  await page.keyboard.press('Control+Shift+p');
  await click('command-reset.command.lisp');
  assert.equal(await page.evaluate(() => window.aioli.state['command-counter']), 3);
  assert.equal(
    await page.evaluate(() =>
      window.aioli.regions.some((r) => r.id === 'command-commands/helper.lisp'),
    ),
    false,
  );
  await click('close-window');
  await click('view');
  await click('generators');
  for (let i = 0; i < 3; i++) {
    if (
      await page.evaluate(
        () => window.aioli.state['active-generator'] === 'textures/stripe.generator.lisp',
      )
    )
      break;
    await click('generator-select');
    await page.waitForFunction(() => !window.aioli.pending);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('#app').width === Math.round(390 * devicePixelRatio),
  );
  const mobileExport = await region('generator-export');
  assert.ok(mobileExport.origin[0] + mobileExport.size[0] <= 390);
  assert.ok(mobileExport.origin[1] + mobileExport.size[1] <= 844);
  const scroll = await region('generator-inspector-scroll');
  assert.ok(scroll.scrollLimit > 0);
  await page.mouse.move(scroll.origin[0] + 20, scroll.origin[1] + 20);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => window.aioli.state['inspector-offset'] > 0);
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'inspector-next')),
    false,
  );
  await region('generator-field-custom-choice');
  await page.screenshot({ path: 'artifacts/generator-inspector-mobile.png' });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForFunction(
    () => document.querySelector('#app').width === Math.round(1200 * devicePixelRatio),
  );
  await click('close-window');
  async function instruction(text) {
    await page.keyboard.press('Escape');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.keyboard.press('Control+Shift+p');
    await page.waitForFunction(
      () =>
        document.activeElement.id === 'text-input' &&
        document.querySelector('#text-input').value === '',
    );
    await page.keyboard.insertText(text);
    await page.keyboard.press('Control+Enter');
  }
  await instruction('(rename-file "game.lisp" "another/runtime.lisp")');
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.ok(await page.evaluate(() => window.aioli.sources.game));
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  await instruction('(upgrade-editor)');
  await page.waitForFunction(() => window.aioli.status.includes('Latest editor installed'));
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  assert.ok(await page.evaluate(() => window.aioli.sources['main-backup-1.lisp']));
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  console.log(
    'Generator discovery, annotated controls, text editing, image/audio output, entry protection, editor upgrade and root commands passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
