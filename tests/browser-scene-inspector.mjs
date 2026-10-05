import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
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
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1.25,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  await click('project');
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'preset')),
    false,
  );
  await page.keyboard.press('Escape');
  await click('view');
  await click('files');
  await click('folder-examples');
  assert.ok(await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'play-game.lisp')));
  assert.ok(await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'play-main.lisp')));
  await click('play-examples/bloom.scene.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/bloom.scene.lisp',
  );
  assert.equal(await page.evaluate(() => window.aioli.state.tab), 'game');
  await click('play-game.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'examples/garden.scene.lisp',
  );
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project.v3')));
  project.files['game.lisp'] =
    '(init! :boots 0) (defn init [] (set! :boots (+ (get :boots) 1))) (start-scene "levels/custom.scene.lisp")';
  project.files['levels/custom.scene.lisp'] = `(init! :radius 20 ["Radius" 5 80 0.5])
(init! :mode "round" ["Mode" ["round" "square"]])
(init! :enabled true ["Enabled"])
(init! :tint "#aabbcc" ["Tint"])
(init! :caption "Hello" ["Caption"])
${Array.from({ length: 20 }, (_, i) => `(init! :extra-${i} ${i} ["Extra ${i}" 0 30])`).join('\n')}
(defpixel render [p time] (background "#000000") (fill (param :tint)) (circle [160 120] (param :radius)))`;
  project.files['levels/tiny.scene.lisp'] =
    '(init! :only-current 1 ["Only current" 0 10 1]) (defpixel render [p time] (background "#000000"))';
  project.files['levels/bad.scene.lisp'] = '(defpixel render [p time] (circle 3 2))';
  project.applicationState = {};
  project.state = {
    'show-tools': true,
    'show-files': true,
    'open-folders': '["levels","examples"]',
    tab: 'levels/custom.scene.lisp',
    paused: true,
  };
  await page.locator('#file-input').setInputFiles({
    name: 'inspector.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => window.aioli.applicationState.boots === 1 && !window.aioli.pending,
  );
  await page.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'scene-field-radius'));
  const radius = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'scene-field-radius'),
  );
  assert.equal(radius.low, 5);
  assert.equal(radius.high, 80);
  assert.equal(radius.step, 0.5);
  const input = page.locator('[data-region="scene-field-radius"]');
  assert.equal(await input.getAttribute('step'), '0.5');
  await input.fill('33.5');
  await input.dispatchEvent('input');
  await page.waitForFunction(() => window.aioli.applicationState.radius === 33.5);
  assert.equal(await page.evaluate(() => window.aioli.editorState.radius), undefined);
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'scene-field-boots')),
    false,
  );
  await click('scene-field-mode');
  assert.equal(await page.evaluate(() => window.aioli.applicationState.mode), 'square');
  await click('scene-field-enabled');
  assert.equal(await page.evaluate(() => window.aioli.applicationState.enabled), false);
  await click('scene-field-caption');
  await page.waitForFunction(() =>
    window.aioli.regions.some((r) => r.id === 'scene-inspector-apply'),
  );
  const editors = await page.evaluate(() => window.aioli.regions.filter((r) => r.id === 'source'));
  const text = editors.at(-1);
  await page.mouse.click(text.origin[0] + 12, text.origin[1] + 12);
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('Updated');
  await click('scene-inspector-apply');
  assert.equal(await page.evaluate(() => window.aioli.applicationState.caption), 'Updated');
  await click('scene-field-tint');
  await page.locator('#generator-color').evaluate((input) => {
    input.value = '#ff0000';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
  });
  assert.equal(await page.evaluate(() => window.aioli.applicationState.tint), '#ff0000');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/scene-inspector.png' });
  await click('play-levels/tiny.scene.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'levels/tiny.scene.lisp',
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.aioli.regions.filter((r) => r.id.startsWith('scene-field-')).map((r) => r.id),
    ),
    ['scene-field-only-current'],
  );
  assert.equal(await page.evaluate(() => window.aioli.applicationState.caption), 'Updated');
  await click('play-levels/custom.scene.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending &&
      window.aioli.applicationState['active-scene'] === 'levels/custom.scene.lisp',
  );
  await click('play-levels/bad.scene.lisp');
  await page.waitForFunction(() => window.aioli.error && !window.aioli.pending);
  assert.equal(
    await page.evaluate(() => window.aioli.applicationState['active-scene']),
    'levels/custom.scene.lisp',
  );
  assert.equal(await page.evaluate(() => window.aioli.running), true);
  await click('play-game.lisp');
  await page.waitForFunction(
    () =>
      !window.aioli.pending && !window.aioli.error && window.aioli.applicationState.radius === 20,
  );
  assert.equal(await page.evaluate(() => window.aioli.applicationState.boots), 1);
  assert.equal(await page.evaluate(() => window.aioli.applicationState.caption), 'Hello');
  assert.equal(await page.evaluate(() => window.aioli.state.paused), false);
  assert.equal(await page.evaluate(() => window.aioli.state['show-tools']), true);
  const beforeFolding = await page.evaluate(() => ({
    tab: window.aioli.state.tab,
    code: window.aioli.sources[window.aioli.state.tab],
    offset: window.aioli.state['scene-inspector-offset'],
  }));
  const panePreview = await page.evaluate(
    () => window.aioli.regions.find((r) => r.id === 'world').size[0],
  );
  await click('collapse-code');
  await page.waitForFunction(
    () =>
      window.aioli.state['code-collapsed'] && !window.aioli.regions.some((r) => r.id === 'source'),
  );
  await click('collapse-inspector');
  await page.waitForFunction(
    () =>
      window.aioli.state['inspector-collapsed'] &&
      !window.aioli.regions.some((r) => r.id === 'scene-inspector-scroll'),
  );
  assert.ok(
    await page.evaluate(
      (old) => window.aioli.regions.find((r) => r.id === 'world').size[0] > old,
      panePreview,
    ),
  );
  assert.equal(
    await page.evaluate(() => window.aioli.state['show-code'] && window.aioli.state['show-tools']),
    true,
  );
  await page.screenshot({ path: 'artifacts/panes-collapsed.png' });
  await click('collapse-code');
  await click('collapse-inspector');
  await page.waitForFunction(
    () =>
      !window.aioli.state['code-collapsed'] &&
      !window.aioli.state['inspector-collapsed'] &&
      window.aioli.regions.some((r) => r.id === 'source') &&
      window.aioli.regions.some((r) => r.id === 'scene-inspector-scroll'),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      tab: window.aioli.state.tab,
      code: window.aioli.sources[window.aioli.state.tab],
      offset: window.aioli.state['scene-inspector-offset'],
    })),
    beforeFolding,
  );
  const workspace = await page.evaluate(() => ({
    code: window.aioli.state['show-code'],
    files: window.aioli.state['show-files'],
    tools: window.aioli.state['show-tools'],
    tab: window.aioli.state.tab,
    offset: window.aioli.state['scene-inspector-offset'],
  }));
  const smallPreview = await page.evaluate(
    () => window.aioli.regions.find((r) => r.id === 'world').size,
  );
  await page.keyboard.press('F4');
  await page.waitForFunction(
    () =>
      window.aioli.state['preview-focused'] &&
      !window.aioli.regions.some(
        (r) => r.id === 'files-tree' || r.id === 'scene-inspector-scroll' || r.id === 'source',
      ),
  );
  const focusedPreview = await page.evaluate(
    () => window.aioli.regions.find((r) => r.id === 'world').size,
  );
  assert.ok(focusedPreview[0] > smallPreview[0]);
  assert.ok(Math.abs(focusedPreview[0] / focusedPreview[1] - 4 / 3) < 1e-9);
  await page.screenshot({ path: 'artifacts/preview-focused.png' });
  await click('focus-preview');
  await page.waitForFunction(
    () =>
      !window.aioli.state['preview-focused'] &&
      window.aioli.regions.some((r) => r.id === 'files-tree'),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      code: window.aioli.state['show-code'],
      files: window.aioli.state['show-files'],
      tools: window.aioli.state['show-tools'],
      tab: window.aioli.state.tab,
      offset: window.aioli.state['scene-inspector-offset'],
    })),
    workspace,
  );
  await page.keyboard.press('F4');
  await page.waitForFunction(() => window.aioli.state['preview-focused']);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.aioli.state['preview-focused']);
  assert.equal(await page.evaluate(() => window.aioli.state['show-tools']), workspace.tools);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('#app').width === Math.round(390 * devicePixelRatio),
  );
  await page.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'scene-field-radius'));
  assert.ok(
    await page.evaluate(() =>
      window.aioli.regions
        .filter((r) => r.id.startsWith('scene-field-'))
        .every((r) => r.origin[0] >= 0 && r.origin[0] + r.size[0] <= 390),
    ),
  );
  await page.screenshot({ path: 'artifacts/scene-inspector-mobile.png' });
  const scroll = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'scene-inspector-scroll'),
  );
  assert.ok(scroll.scrollLimit > 0);
  await page.mouse.move(scroll.origin[0] + 20, scroll.origin[1] + 20);
  await page.mouse.wheel(0, 5000);
  await page.waitForFunction(() => window.aioli.state['scene-inspector-offset'] > 0);
  await page.waitForFunction(() =>
    window.aioli.regions.some((r) => r.id === 'scene-field-extra-19'),
  );
  assert.equal(
    await page.evaluate(() => window.aioli.regions.some((r) => r.id === 'scene-field-radius')),
    false,
  );
  await page.screenshot({ path: 'artifacts/scene-inspector-scrolled.png' });
  await page.mouse.wheel(0, -5000);
  await page.waitForFunction(() => window.aioli.state['scene-inspector-offset'] === 0);
  await page.waitForFunction(() => window.aioli.regions.some((r) => r.id === 'scene-field-radius'));
  assert.equal(await page.evaluate(() => window.aioli.applicationState.radius), 20);
  const bar = await page.evaluate(() =>
    window.aioli.regions.find((r) => r.id === 'scene-inspector-scroll-scrollbar'),
  );
  await page.mouse.move(bar.origin[0] + bar.size[0] / 2, bar.origin[1] + 12);
  await page.mouse.down();
  await page.mouse.move(bar.origin[0] + bar.size[0] / 2, bar.origin[1] + bar.size[1] - 5, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(() => window.aioli.state['scene-inspector-offset'] > 500);
  const savedOffset = await page.evaluate(() => window.aioli.state['scene-inspector-offset']);
  await click('collapse-inspector');
  await page.waitForFunction(() => window.aioli.state['inspector-collapsed']);
  await click('collapse-files');
  await page.waitForFunction(
    () =>
      window.aioli.state['files-collapsed'] &&
      window.aioli.regions.some((r) => r.id === 'collapse-code'),
  );
  await click('collapse-code');
  await page.waitForFunction(
    () =>
      window.aioli.state['code-collapsed'] && window.aioli.regions.some((r) => r.id === 'world'),
  );
  assert.ok(
    await page.evaluate(() =>
      window.aioli.regions
        .filter((r) => ['collapse-files', 'collapse-code', 'collapse-inspector'].includes(r.id))
        .every((r) => r.size[0] === 40 && r.origin[0] >= 0 && r.origin[0] + r.size[0] <= 390),
    ),
  );
  await page.screenshot({ path: 'artifacts/panes-collapsed-mobile.png' });
  await click('collapse-inspector');
  await page.waitForFunction(
    () =>
      !window.aioli.state['inspector-collapsed'] &&
      window.aioli.regions.some((r) => r.id === 'scene-inspector-scroll'),
  );
  assert.equal(
    await page.evaluate(() => window.aioli.state['scene-inspector-offset']),
    savedOffset,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Examples gallery, scene/game play buttons, fresh restart, annotation sliders, choices, toggles, text/colors, rollback and narrow inspector passed',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
