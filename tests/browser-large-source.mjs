import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`);
const server = createStaticServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.aioli?.running);
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  if (process.env.LARGE_SOURCE_EDITOR_PATH) project.files['editor/ui/code-input.lisp'] = readFileSync(process.env.LARGE_SOURCE_EDITOR_PATH, 'utf8');
  Object.assign(project.state, { tab: 'examples/doom.scene.lisp', 'code-tabs': ['examples/doom.scene.lisp'], 'show-code': true, 'show-files': false, 'show-game': false });
  await page.locator('#file-input').setInputFiles({ name: 'large-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => !window.aioli.pending && window.aioli.state.tab === 'examples/doom.scene.lisp');
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const [width, height] of [[1280,900], [1920,1080], [2560,1600]]) {
    await page.setViewportSize({width,height});
    await frame();
    const source = await page.evaluate(() => window.aioli.regions.find((r) => r.id === 'source'));
    assert.ok(source, `source at ${width}x${height}`);
    await page.mouse.move(source.origin[0] + source.size[0]/2, source.origin[1] + source.size[1]/2);
    for (const direction of [1,-1]) for (let step = 0; step < 80; step++) {
      await page.mouse.wheel(0,direction*100);
      await frame();
      const status = await page.evaluate(() => ({running:window.aioli.running, error:window.aioli.error, status:window.aioli.status}));
      assert.equal(status.running, true, `${width}x${height} scroll ${direction*step}: ${JSON.stringify(status)}`);
      assert.equal(status.error, false, status.status);
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Doom source stays responsive while scrolling in both directions across wide and tall viewports');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
