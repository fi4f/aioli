import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';
const checkpointKey = 'hg-storage:mercury-project:editor-state';

async function openEditor(page) {
  await page.route('**/index.js', async route => {
    const response = await route.fetch();
    const source = (await response.text())
      .replace('host.app = app;', 'host.app = app; window.sessionTestApp = app;')
      .replace('const checkpointTimer = window.setInterval(checkpoint, 500);',
        'const checkpointTimer = window.setInterval(checkpoint, 500); window.sessionTestTimer = checkpointTimer;');
    await route.fulfill({ response, body: source });
  });
  await page.goto(new URL('/index.html', baseURL).href);
  await ready(page);
}
async function ready(page) {
  await page.waitForFunction(() => window.sessionTestApp?.scene && !sessionTestApp.attaching && !sessionTestApp.failed);
}

test('immediate refresh preserves pane positions, draft, selection, view settings, and application data', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await openEditor(page);
    const header = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const workspace = App.read(sessionTestApp, App.inspect(sessionTestApp).workspace);
      const pane = workspace.state.panes.find(pane => pane.props.id === 'Bindings');
      return { x: pane.bounds.x + 80, y: pane.bounds.y + 16 };
    });
    await page.mouse.move(header.x, header.y);
    await page.mouse.down();
    await page.mouse.move(380, 180, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => sessionTestApp.state.layout.panes.find(pane => pane.id === 'Bindings').floating);
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      await App.exec(sessionTestApp, '(open-file "/editor/icons/code.png")');
      const app = sessionTestApp, refs = App.inspect(app);
      const workspace = App.read(app, refs.workspace), desktop = App.read(app, refs.desktop);
      App.exec(app, 'ui-pane-minimize')(desktop, workspace.state.panes.find(pane => pane.props.id === 'Diagnostics'));
      const path = App.exec(app, '(ui-path desktop.root inspector)');
      const scroll = path.find(node => node.component === App.exec(app, 'ui-scroll-component'));
      App.exec(app, 'ui-scroll-to')(desktop, scroll, App.exec(app, '(vec2 0 90)'));
    });
    // Disable the periodic save to prove the final pagehide checkpoint is enough.
    const expected = await page.evaluate(() => {
      clearInterval(sessionTestTimer);
      const state = sessionTestApp.state, model = state.editor;
      model.source += '\n; unsaved refresh draft';
      model.dirty = true; model.pending = false; model.auto = false;
      model.anchor = 12; model.head = 19; model.scroll = 4; model['scroll-x'] = 40;
      model.files.selected = '/editor'; model.files.expanded['/project'] = false;
      model['preview-view'].pan.x = 23; model['preview-view'].pan.y = -17;
      model['preview-view'].zoom = 2; model['preview-view'].fit = false;
      state.tools.preferences = { scale: 1.5, filter: 'functions' };
      state.project = { score: 42, camera: { x: 5, y: 7 } };
      return JSON.parse(JSON.stringify({ layout: state.layout, source: model.source,
        tools: state.tools, project: state.project, path: model.path }));
    });
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => sessionTestApp.state.tools['bindings-scroll'].y === 90);
    const actual = await page.evaluate(() => {
      const state = sessionTestApp.state, model = state.editor, preview = model['preview-view'];
      return JSON.parse(JSON.stringify({ layout: state.layout, source: model.source,
        tools: state.tools, project: state.project, path: model.path,
        selection: [model.anchor, model.head], scroll: [model.scroll, model['scroll-x']], auto: model.auto,
        selected: model.files.selected, expanded: model.files.expanded['/project'],
        preview: { path: preview.path, pan: [preview.pan.x, preview.pan.y], zoom: preview.zoom, fit: preview.fit, loaded: !!preview.image } }));
    });
    assert.deepEqual({ layout: actual.layout, source: actual.source, tools: actual.tools, project: actual.project, path: actual.path }, expected);
    assert.deepEqual(actual.selection, [12, 19]);
    assert.deepEqual(actual.scroll, [4, 40]);
    assert.equal(actual.auto, false);
    assert.equal(actual.selected, '/editor');
    assert.equal(actual.expanded, false);
    assert.deepEqual(actual.preview, { path: '/editor/icons/code.png', pan: [23, -17], zoom: 2, fit: false, loaded: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('session restore ignores corrupt data and checkpoints from a replaced project', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openEditor(page);
    // Suppress the old document's checkpoint so the deliberately bad value reaches boot.
    await page.route('**/index.js', async route => {
      const response = await route.fetch();
      const source = (await response.text()).replace('host.app = app;', 'host.app = app; window.sessionTestApp = app;');
      await route.fulfill({ response, body: source });
    });
    await page.evaluate(key => {
      clearInterval(sessionTestTimer);
      sessionStorage.setItem(key, 'invalid json');
      // pagehide still writes a valid snapshot; corrupt it in a later listener.
      window.addEventListener('pagehide', () => sessionStorage.setItem(key, 'invalid json'));
    }, checkpointKey);
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => sessionTestApp.state['editor-mode']), 'saved');
    assert.equal(await page.locator('#host-error').isVisible(), false);
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      sessionTestApp.state.project = { oldProject: true };
      await new Promise(resolve => setTimeout(resolve, 550));
      window.oldProjectCheckpoint = sessionStorage.getItem('hg-storage:mercury-project:editor-state');
      await App.exec(sessionTestApp, '(new-project)');
    });
    await ready(page);
    await page.evaluate(key => {
      const stale = oldProjectCheckpoint;
      // Install a valid old checkpoint after the new document's final checkpoint.
      window.addEventListener('pagehide', () => sessionStorage.setItem(key, stale));
    }, checkpointKey);
    await page.reload();
    await ready(page);
    assert.deepEqual(await page.evaluate(() => sessionTestApp.state.project), {});
    assert.equal(await page.evaluate(() => sessionTestApp.state['editor-mode']), 'saved');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('ordinary file writes retain the session and a deliberately empty Source stays empty', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await openEditor(page);
    await page.evaluate(() => {
      const model = sessionTestApp.state.editor;
      model.path = ''; model.source = ''; model['saved-source'] = '';
      model.dirty = false; model.pending = false; model.locked = true;
      model.anchor = 0; model.head = 0;
      sessionTestApp.state.project = { survivesFileWrites: true };
    });
    await page.waitForFunction(key => {
      const source = sessionStorage.getItem(key);
      return source && JSON.parse(source).state.project.survivesFileWrites;
    }, checkpointKey);
    await page.evaluate(async key => {
      const { Data } = await import('/hg/data.js');
      const { Storage } = await import('/hg/storage.js');
      const app = sessionTestApp, store = app.filesystem.storage;
      Storage.writeSession(store, 'probe', 'plain text');
      if (Storage.readSession(store, 'probe') !== 'plain text') throw new Error('Session storage did not round trip');
      Storage.removeSession(store, 'probe');
      if (Storage.readSession(store, 'probe') !== null) throw new Error('Session storage did not remove its key');
      clearInterval(sessionTestTimer);
      const saved = sessionStorage.getItem(key);
      await Data.get(app.__filesystemApi__, 'writeText')(app.filesystem, '/project/session-change.lisp', '; file changed', null);
      window.addEventListener('pagehide', () => sessionStorage.setItem(key, saved));
    }, checkpointKey);
    await page.reload();
    await ready(page);
    assert.deepEqual(await page.evaluate(() => [sessionTestApp.state.editor.path,
      sessionTestApp.state.editor.source, sessionTestApp.state.editor.locked, sessionTestApp.state.project]),
      ['', '', true, { survivesFileWrites: true }]);
  } finally { await browser.close(); }
});

test('F2 checkpoints through trusted capture even when the project capture hook is broken', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await openEditor(page);
    await page.evaluate(async () => {
      clearInterval(sessionTestTimer);
      const { App } = await import('/hg/app.js');
      const project = App.exec(sessionTestApp, 'Project');
      window.failedCaptureCalls = 0;
      project.capture = () => { failedCaptureCalls++; throw new Error('broken capture hook'); };
      sessionTestApp.state.editor.source += '\n; draft before F2';
      sessionTestApp.state.editor.dirty = true;
      sessionTestApp.state.editor.pending = false;
      window.beforeRecoveryApp = sessionTestApp;
    });
    await page.keyboard.press('F2');
    await page.waitForFunction(() => sessionTestApp !== beforeRecoveryApp && sessionTestApp.scene && !sessionTestApp.attaching);
    assert.equal(await page.evaluate(() => failedCaptureCalls), 0);
    assert.equal(await page.evaluate(() => sessionTestApp.state.editor.source.endsWith('; draft before F2')), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
