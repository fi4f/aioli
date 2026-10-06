import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
import { synthesize, wav } from '../audio.js';
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
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1.25,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  project.files['hooks.lisp'] =
    '(defdraw mark [] ["Little moon"] (fill "#d5dcc7") (circle [50 50] 20))\n(defsound bell [] ["Bell"] (voice :sine 440 220 2 0.1))';
  project.resources['assets/moon.png'] = project.resources['editor/icon/main.png'];
  project.resources['assets/tone.wav'] = {
    mime: 'audio/wav',
    data:
      'data:audio/wav;base64,' +
      Buffer.from(
        wav(synthesize([{ wave: 'sine', start: 440, end: 220, duration: 2, gain: 0.1 }])),
      ).toString('base64'),
  };
  project.resources['assets/note.txt'] = {
    mime: 'text/plain;charset=utf-8',
    data:
      'data:text/plain;charset=utf-8;base64,' +
      Buffer.from('Boo! A little moon.').toString('base64'),
  };
  Object.assign(project.state, {
    'show-files': true,
    'show-code': true,
    'open-folders': ['assets'],
    tab: 'hooks.lisp',
  });
  await page.locator('#file-input').setInputFiles({
    name: 'tool-panes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => !window.aioli.pending && window.aioli.state.tab === 'hooks.lisp',
  );
  const frame = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const region = (id) => page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
  async function click(id) {
    await page.waitForFunction((id) => window.aioli.regions.some((r) => r.id === id), id);
    const r = await region(id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await frame();
  }
  async function dock(id, target, edge) {
    const header = await region(`dock-move-${id}`),
      pane = await region(`pane-${target}`);
    await page.mouse.move(header.origin[0] + 20, header.origin[1] + 12);
    await page.mouse.down();
    await page.mouse.move(
      pane.origin[0] + pane.size[0] * (edge === 'right' ? 0.8 : 0.5),
      pane.origin[1] + pane.size[1] * (edge === 'bottom' ? 0.8 : 0.5),
      { steps: 10 },
    );
    await frame();
    await page.waitForFunction(() => window.aioli.dockPreview?.ready);
    await page.mouse.up();
    await frame();
    assert.equal(await page.evaluate((id) => window.aioli.state['ui-docks'][id].dock, id), 'split');
  }
  await click('file-assets/moon.png');
  await page.waitForFunction(() => window.aioli.preview.ready);
  assert.equal(await page.evaluate(() => window.aioli.state.window), '');
  assert.ok(await region('pane-preview'));
  assert.ok(await region('source'), 'non-text previews leave the code editor available');
  await dock('preview', 'game', 'right');
  await click('asset-zoom-in');
  const zoom = await page.evaluate(() => window.aioli.state['preview-zoom']);
  const placement = await page.evaluate(() => window.aioli.state['ui-docks'].preview);
  await click('collapse-preview');
  assert.ok(await region('restore-preview'));
  await click('restore-preview');
  assert.equal(await page.evaluate(() => window.aioli.state['preview-zoom']), zoom);
  assert.deepEqual(await page.evaluate(() => window.aioli.state['ui-docks'].preview), placement);
  await click('project');
  await click('project-settings');
  assert.ok(await region('pane-settings'));
  assert.ok(await region('pane-preview'));
  await dock('settings', 'game', 'bottom');
  await click('project-name');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('A little moon');
  await click('collapse-settings');
  await click('restore-settings');
  await click('project-name');
  assert.equal(await page.locator('#field-input').inputValue(), 'A little moon');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/tools-docked.png' });
  await click('close-project-settings');
  await click('close-window');
  await click('file-assets/tone.wav');
  await page.waitForFunction(() => window.aioli.preview.ready && window.aioli.preview.duration > 1);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].preview.dock), 'split');
  await click('asset-play');
  await page.waitForFunction(() => window.aioli.preview.playing);
  const seek = await region('asset-seek');
  await page.mouse.click(seek.origin[0] + seek.size[0] * 0.75, seek.origin[1] + 10);
  await page.waitForFunction(() => window.aioli.preview.position > 1.4);
  await click('close-window');
  await page.waitForFunction(() => !window.aioli.preview.playing && !window.aioli.preview.ready);
  await click('inspect-hook-mark');
  await page.waitForFunction(() => window.aioli.hookPreview?.name === 'mark');
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].preview.dock), 'split');
  async function editDuringPreview(name) {
    await click('hook-args');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('[]');
    assert.ok(await region('source'), 'argument editing keeps the source editor visible');
    const source = await region('source');
    await page.mouse.click(source.origin[0] + 80, source.origin[1] + 80);
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(`\n; edited during ${name} preview`);
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(
      (name) =>
        !window.aioli.pending &&
        window.aioli.sources['hooks.lisp'].includes(`edited during ${name} preview`),
      name,
    );
    assert.equal(await page.evaluate(() => window.aioli.state['show-preview']), true);
    assert.equal(await page.evaluate(() => window.aioli.hookPreview.name), name);
  }
  await editDuringPreview('mark');
  await click('close-window');
  await click('inspect-hook-bell');
  await page.waitForFunction(() => window.aioli.preview.ready);
  await editDuringPreview('bell');
  await click('hook-forward');
  await page.waitForFunction(() => window.aioli.preview.position >= 1);
  await click('close-window');
  await click('file-assets/note.txt');
  await page.waitForFunction(() => document.querySelector('#text-input').readOnly);
  assert.equal(await page.locator('#text-input').inputValue(), 'Boo! A little moon.');
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('aioli.project')).state['preview-kind'] === 'text-asset',
  );
  await page.reload();
  await page.waitForFunction(
    () => window.aioli?.running && window.aioli.regions.some((r) => r.id === 'pane-preview'),
  );
  assert.equal(await page.locator('#text-input').inputValue(), 'Boo! A little moon.');
  await page.setViewportSize({ width: 390, height: 844 });
  await frame();
  assert.ok(await region('pane-preview'));
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Settings and asset/hook panes: docking, independent visibility, minimize/restore, drafts, playback, seek, close, text reload and narrow layout passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
