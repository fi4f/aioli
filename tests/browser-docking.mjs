import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../server.js';
const require = createRequire(import.meta.url);
const { chromium } = require(
  `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`,
);
const server = createStaticServer({ basePath: '/project/' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/project/`);
  await page.waitForFunction(() => window.aioli?.running);
  const seed = await page.evaluate(() => JSON.parse(localStorage.getItem('aioli.project')));
  const frame = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const region = (id) => page.evaluate((id) => window.aioli.regions.find((r) => r.id === id), id);
  const pane = async (id) => {
    const r = await region(`pane-${id}`);
    return [...r.origin, ...r.size];
  };
  async function load(placements) {
    const project = structuredClone(seed);
    project.state = {
      ...project.state,
      'show-files': true,
      'show-tools': true,
      'ui-docks': placements,
    };
    await page.locator('#file-input').setInputFiles({
      name: 'docks.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.waitForFunction(() => !window.aioli.pending);
    await frame();
    assert.equal(
      await page.evaluate(() => window.aioli.error),
      false,
      await page.evaluate(() => window.aioli.status),
    );
  }
  async function click(id) {
    const r = await region(id);
    assert.ok(r, id);
    await page.mouse.click(r.origin[0] + r.size[0] / 2, r.origin[1] + r.size[1] / 2);
    await frame();
  }
  async function drag(id, x, y) {
    const r = await region(id);
    assert.ok(r, id);
    const inset = id.includes('move') ? [20, 10] : r.size.map((n) => n / 2);
    await page.mouse.move(r.origin[0] + inset[0], r.origin[1] + inset[1]);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await frame();
    if (await page.evaluate(() => !!window.aioli.dockPreview))
      await page.waitForFunction(() => window.aioli.dockPreview?.ready);
    await page.mouse.up();
    await frame();
  }
  await load({
    code: { dock: 'floating', x: 300, y: 180, width: 320, height: 400, z: 1 },
    game: { dock: 'floating', x: 500, y: 260, width: 400, height: 360, z: 2 },
  });
  await page.mouse.click(340, 280);
  await frame();
  assert.equal(
    await page.evaluate(
      () =>
        window.aioli.regions.filter((r) => r.id === 'pane-code' || r.id === 'pane-game').at(-1).id,
    ),
    'pane-code',
  );
  await page.mouse.click(850, 380);
  await frame();
  assert.equal(
    await page.evaluate(
      () =>
        window.aioli.regions.filter((r) => r.id === 'pane-code' || r.id === 'pane-game').at(-1).id,
    ),
    'pane-game',
  );
  await page.mouse.move(340, 300);
  await page.mouse.wheel(0, 120);
  await frame();
  assert.equal(
    await page.evaluate(
      () =>
        window.aioli.regions.filter((r) => r.id === 'pane-code' || r.id === 'pane-game').at(-1).id,
    ),
    'pane-code',
  );
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    await click('dock-move-code');
    const before = await pane('code'),
      r = await region(`dock-resize-${edge}-code`);
    const center = r.origin.map((n, i) => n + r.size[i] / 2);
    await drag(
      r.id,
      center[0] + (edge === 'left' ? -30 : edge === 'right' ? 30 : 0),
      center[1] + (edge === 'top' ? -20 : edge === 'bottom' ? 20 : 0),
    );
    const after = await pane('code');
    if (edge === 'left' || edge === 'right') assert.equal(after[2], before[2] + 30);
    else assert.equal(after[3], before[3] + 20);
    if (edge === 'left') assert.equal(after[0] + after[2], before[0] + before[2]);
    if (edge === 'top') assert.equal(after[1] + after[3], before[1] + before[3]);
  }
  await load({});
  const filesBefore = await pane('files'),
    edge = await region('dock-resize-right-files');
  await drag(edge.id, edge.origin[0] + 63, edge.origin[1] + edge.size[1] / 2);
  assert.equal((await pane('files'))[2], filesBefore[2] + 60);
  assert.equal((await pane('code'))[0], (await pane('files'))[2]);
  await load({});
  const text = await page.locator('#text-input').inputValue();
  await drag('dock-move-code', 140, 720);
  const files = await pane('files'),
    code = await pane('code');
  assert.equal(files[0], code[0]);
  assert.equal(files[2], code[2]);
  assert.equal(code[1], files[1] + files[3]);
  assert.equal(files[3], code[3]);
  assert.equal(await page.locator('#text-input').inputValue(), text);
  await drag('dock-move-inspector', 35, code[1] + code[3] / 2);
  const inspector = await pane('inspector'),
    nestedCode = await pane('code');
  assert.equal(inspector[1], nestedCode[1]);
  assert.equal(inspector[3], nestedCode[3]);
  assert.equal(nestedCode[0], inspector[0] + inspector[2]);
  const divider = await page.evaluate(() =>
    window.aioli.regions.find(
      (r) =>
        r.dockKind === 'divider' &&
        r.divider.axis === 'x' &&
        r.divider.owners.length === 2 &&
        r.divider.owners.includes('code'),
    ),
  );
  await drag(divider.id, divider.origin[0] + 23, divider.origin[1] + divider.size[1] / 2);
  assert.equal((await pane('inspector'))[2], inspector[2] + 20);
  const tree = await page.evaluate(() => window.aioli.state['ui-docks']._tree);
  await page.waitForFunction(
    (tree) =>
      JSON.stringify(JSON.parse(localStorage.getItem('aioli.project')).state['ui-docks']._tree) ===
      JSON.stringify(tree),
    tree,
  );
  await page.reload();
  await page.waitForFunction(() => window.aioli?.running);
  assert.deepEqual(await page.evaluate(() => window.aioli.state['ui-docks']._tree), tree);
  await click('view');
  await click('files');
  assert.equal(await region('pane-files'), undefined);
  assert.equal((await pane('code'))[3], 819);
  await click('view');
  await click('files');
  assert.equal((await pane('code'))[1], (await pane('files'))[1] + (await pane('files'))[3]);
  await mkdir('artifacts', { recursive: true });
  await frame();
  await page.screenshot({ path: 'artifacts/advanced-docking.png' });
  await drag('dock-move-code', 1210, 300);
  assert.equal(await page.evaluate(() => window.aioli.state['ui-docks'].code.dock), 'floating');
  assert.equal((await pane('inspector'))[2], (await pane('files'))[2]);
  const game = await pane('game');
  await drag('dock-move-code', game[0] + game[2] / 2, game[1] + game[3] * 0.7);
  const gameAfter = await pane('game'),
    codeAfter = await pane('code');
  assert.equal(gameAfter[0], codeAfter[0]);
  assert.equal(gameAfter[2], codeAfter[2]);
  assert.equal(codeAfter[1], gameAfter[1] + gameAfter[3]);
  assert.equal(await page.locator('#text-input').inputValue(), text);
  await frame();
  await page.screenshot({ path: 'artifacts/advanced-docking-rearranged.png' });
  assert.equal(await page.evaluate(() => window.aioli.error), false);
  assert.deepEqual(errors, []);
  console.log(
    'Floating content raises panes; four edge resizers, adjoining dividers, nested pane docking, source retention, hiding and saved split layouts passed',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
