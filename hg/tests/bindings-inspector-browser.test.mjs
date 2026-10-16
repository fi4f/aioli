import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';
const key = (name, path = []) => JSON.stringify([name, path]);

async function ready(page) {
  await page.locator('#host-loading').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#host-error').isVisible(), false,
    await page.locator('#host-diagnostic').textContent());
  await page.evaluate(async () => {
    const { App } = await import('/hg/app.js');
    const app = inspectorTestApp, refs = App.inspect(app);
    const desktop = App.read(app, refs.desktop), node = App.read(app, refs.inspector);
    window.inspectorTest = { App, app, desktop, node };
    App.exec(app, '(ui-pane-open desktop bindings-pane)');
  });
  await page.waitForFunction(() => inspectorTest.node.state.mounted && inspectorTest.node.clip.z > 0);
}
async function open(page, trace = false) {
  await page.route('**/index.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('host.app = app;', 'host.app = app; window.inspectorTestApp = app;') });
  });
  await page.goto(new URL(`/index.html${trace ? '?trace=1' : ''}`, baseURL).href);
  await ready(page);
}
async function click(page, key) {
  await page.waitForFunction(key => !!inspectorTest.node.state.nodes[key], key);
  await page.evaluate(key => {
    const { App, app, desktop, node } = inspectorTest;
    App.exec(app, 'ui-focus')(desktop, App.exec(app, 'ui-path')(desktop.root, node.state.nodes[key]));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, key);
  const point = await page.evaluate(key => {
    const { app, desktop, node } = inspectorTest;
    const row = node.state.nodes[key], bounds = app.outerCanvas.getBoundingClientRect();
    return { x: bounds.left + (row.clip.x + row.clip.z / 2) * desktop.scale * bounds.width / app.outerCanvas.width,
      y: bounds.top + (row.clip.y + row.clip.w / 2) * desktop.scale * bounds.height / app.outerCanvas.height };
  }, key);
  await page.mouse.click(point.x, point.y);
}
const expanded = (page, key, value = true) => page.waitForFunction(({ key, value }) =>
  inspectorTest.node.state.nodes[key]?.props.entry.expanded === value, { key, value });

for (const trace of [true, false]) {
  test(`Bindings recursively previews live values with mouse, keyboard, cycles, and pages (trace=${trace})`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, deviceScaleFactor: 1.25 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await open(page, trace);
      await page.evaluate(() => {
        const { App, app } = inspectorTest;
        App.exec(app, '(let inspector-sample (dict "branch" (dict "nested" (list (dict "answer" 42))) "zero" 0 "flag" false "items" (list)))');
        const sample = App.read(app, App.inspect(app)['inspector-sample']);
        sample.self = sample; sample.alias = sample.branch;
        sample.items = Array.from({ length: 10000 }, (_, index) => index);
        window.getterCalls = 0;
        Object.defineProperty(sample, 'danger', { enumerable: true, get() { getterCalls++; throw new Error('Do not execute getters'); } });
      });
      const root = key('inspector-sample');
      await click(page, root); await expanded(page, root);
      const caption = path => page.evaluate(key => inspectorTest.node.state.nodes[key].state.label.props.value, key('inspector-sample', path));
      assert.equal(await caption(['zero']), '"zero": 0');
      assert.equal(await caption(['flag']), '"flag": false');
      assert.match(await caption(['self']), /circular reference/);
      assert.match(await caption(['danger']), /Accessor is not evaluated/);
      assert.equal(await page.evaluate(() => getterCalls), 0);
      for (const path of [['branch'], ['branch', 'nested'], ['branch', 'nested', 0]]) {
        await click(page, key('inspector-sample', path)); await expanded(page, key('inspector-sample', path));
      }
      assert.equal(await caption(['branch', 'nested', 0, 'answer']), '"answer": 42');
      await page.evaluate(key => {
        const { App, app, node } = inspectorTest;
        window.retainedInspectorRow = node.state.nodes[key];
        App.exec(app, '(set inspector-sample.branch.nested.0.answer 99)');
      }, key('inspector-sample', ['branch', 'nested', 0, 'answer']));
      await page.waitForFunction(key => inspectorTest.node.state.nodes[key].state.label.props.value.endsWith('99'), key('inspector-sample', ['branch', 'nested', 0, 'answer']));
      assert.equal(await page.evaluate(key => inspectorTest.node.state.nodes[key] === retainedInspectorRow, key('inspector-sample', ['branch', 'nested', 0, 'answer'])), true);
      await click(page, key('inspector-sample', ['alias'])); await expanded(page, key('inspector-sample', ['alias']));
      assert.equal(await page.evaluate(key => inspectorTest.node.state.nodes[key].props.entry.expandable, key('inspector-sample', ['alias', 'nested'])), true);
      const items = key('inspector-sample', ['items']);
      await click(page, items); await expanded(page, items);
      assert.equal(await caption(['items', 49]), '49: 49');
      assert.equal(await page.evaluate(key => !!inspectorTest.node.state.nodes[key], key('inspector-sample', ['items', 50])), false);
      await click(page, `${items}:next`);
      await page.waitForFunction(key => !!inspectorTest.node.state.nodes[key], key('inspector-sample', ['items', 50]));
      assert.equal(await caption(['items', 99]), '99: 99');
      assert.equal(await page.evaluate(key => !!inspectorTest.node.state.nodes[key], key('inspector-sample', ['items', 0])), false);
      await click(page, `${items}:previous`);
      await page.waitForFunction(key => !!inspectorTest.node.state.nodes[key], key('inspector-sample', ['items', 0]));
      await click(page, root); await expanded(page, root, false);
      await page.keyboard.press('ArrowRight'); await expanded(page, root);
      await page.keyboard.press('ArrowLeft'); await expanded(page, root, false);
      await page.keyboard.press('Space'); await expanded(page, root);
      assert.equal(await page.evaluate(() => getterCalls), 0);
      assert.equal(await page.evaluate(() => inspectorTest.app.failed), false);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test('binding expansion and paging survive refresh with the workspace', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await open(page);
    await page.evaluate(() => { inspectorTest.app.state.project = { nested: { count: 7 }, items: Array.from({ length: 100 }, (_, index) => index) }; });
    for (const path of [[], ['project'], ['project', 'nested'], ['project', 'items']]) {
      await click(page, key('state', path)); await expanded(page, key('state', path));
    }
    await click(page, `${key('state', ['project', 'items'])}:next`);
    await page.waitForFunction(key => !!inspectorTest.node.state.nodes[key], key('state', ['project', 'items', 50]));
    await page.reload(); await ready(page);
    await page.waitForFunction(key => !!inspectorTest.node.state.nodes[key], key('state', ['project', 'items', 50]));
    assert.equal(await page.evaluate(key => inspectorTest.node.state.nodes[key].state.label.props.value, key('state', ['project', 'nested', 'count'])), '"count": 7');
    assert.equal(await page.evaluate(() => inspectorTest.app.failed), false);
  } finally { await browser.close(); }
});
