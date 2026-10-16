import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

async function openEditor(page, trace) {
  await page.route('**/index.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace('host.app = app;', 'host.app = app; window.operationsTestApp = app;') });
  });
  await page.goto(new URL(trace ? '/?trace=1' : '/', baseURL).href);
  await page.waitForFunction(() => window.operationsTestApp?.__reflection__?.scene && !operationsTestApp.attaching);
  assert.equal(await page.locator('#host-error').isVisible(), false);
}

async function clickButton(page, text) {
  const point = await page.evaluate(async text => {
    const { App } = await import('/hg/app.js');
    const ui = App.exec(operationsTestApp, 'desktop');
    const hasLabel = node => node.props?.value === text || node.children?.some(hasLabel);
    const find = node => {
      if (!node || node.props?.visible === false) return null;
      if (node.handlers?.click?.length && hasLabel(node)) return node;
      for (const child of node.children ?? []) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    const node = find(ui.popup?.node ?? ui.root);
    if (!node || !node.bounds.z || !node.bounds.w) throw new Error(`Button unavailable: ${text}`);
    const left = Math.max(node.bounds.x, node.clip.x), top = Math.max(node.bounds.y, node.clip.y);
    const right = Math.min(node.bounds.x + node.bounds.z, node.clip.x + node.clip.z);
    const bottom = Math.min(node.bounds.y + node.bounds.w, node.clip.y + node.clip.w);
    if (right <= left || bottom <= top) throw new Error(`Button clipped: ${text}`);
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }, text);
  await page.mouse.click(point.x, point.y);
}

async function projectMenu(page, action) {
  await clickButton(page, 'Project');
  await page.evaluate(async () => { window.operationsTestAppClass = (await import('/hg/app.js')).App; });
  await page.waitForFunction(() => operationsTestAppClass.exec(operationsTestApp, 'desktop').popup?.node.bounds.z > 0);
  await clickButton(page, action);
}

test('Project menu separators remain visible at fractional display scales', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const scale of [0.5, 0.9, 1, 1.25]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: scale });
      try {
        await openEditor(page, false);
        await page.evaluate(async () => { window.operationsTestAppClass = (await import('/hg/app.js')).App; });
        await clickButton(page, 'Project');
        await page.waitForFunction(() => {
          const ui = operationsTestAppClass.exec(operationsTestApp, 'desktop');
          const separators = ui.popup?.node.children.filter(node => node.props.role === 'separator');
          if (separators?.length !== 2) return false;
          const context = operationsTestApp.outerCanvas.getContext('2d');
          return separators.every(separator => {
            const line = separator.children[0], b = line.bounds, color = line.props.background;
            if (!b.z || !b.w) return false;
            const x = Math.ceil((b.x + b.z / 2) * ui.scale - 0.5);
            const top = Math.ceil(b.y * ui.scale - 0.5);
            const bottom = Math.ceil((b.y + b.w) * ui.scale - 0.5);
            const expected = [color.x, color.y, color.z, color.w].map(channel => Math.round(channel * 255));
            for (let y = top; y < bottom; y++) {
              if ([...context.getImageData(x, y, 1, 1).data].every((channel, i) => channel === expected[i])) return true;
            }
            return false;
          });
        }, undefined, { timeout: 5000 });
      } catch (error) {
        throw new Error(`Separators at display scale ${scale}: ${error.message}`, { cause: error });
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test('Project menu offers only the actions for the current editor mode', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openEditor(page, false);
    const original = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const source = await App.exec(operationsTestApp, '(fs-read-text "/editor/main.lisp")');
      await App.exec(operationsTestApp, 'fs-write-text')('/editor/main.lisp', source + '\n; customized editor\n', null);
      await App.exec(operationsTestApp, 'fs-write-text')('/project/preserved.txt', 'my project', null);
      return source;
    });
    const checkMenu = async actions => {
      await clickButton(page, 'Project');
      await page.evaluate(async () => { window.operationsTestAppClass = (await import('/hg/app.js')).App; });
      await page.waitForFunction(() => operationsTestAppClass.exec(operationsTestApp, 'desktop').popup?.node.bounds.z > 0);
      assert.deepEqual(await page.evaluate(() => {
        const popup = operationsTestAppClass.exec(operationsTestApp, 'desktop').popup.node;
        const label = node => node.props?.value ?? node.children?.map(label).join('') ?? '';
        return popup.children.map(node => node.props.role === 'separator' ? '---' : label(node));
      }), ['New Project', 'Open Project', 'Save Project', '---', 'Settings', '---', ...actions]);
      await page.keyboard.press('Escape');
    };
    const changeMode = async (action, mode) => {
      await page.evaluate(() => { window.menuPreviousApp = operationsTestApp; });
      await projectMenu(page, action);
      await page.waitForFunction(mode => operationsTestApp !== menuPreviousApp &&
        operationsTestApp.state['editor-mode'] === mode && operationsTestApp.__reflection__?.scene &&
        !operationsTestApp.attaching, mode);
      assert.equal(await page.locator('#host-error').isVisible(), false);
    };
    await checkMenu(['Recover default editor']);
    await changeMode('Recover default editor', 'recovery');
    await checkMenu(['Restore project editor', 'Keep default editor']);
    await changeMode('Restore project editor', 'saved');
    assert.equal(await page.evaluate(async () =>
      operationsTestAppClass.exec(operationsTestApp, '(fs-read-text "/editor/main.lisp")')), original + '\n; customized editor\n');
    await checkMenu(['Recover default editor']);
    await changeMode('Recover default editor', 'recovery');
    await changeMode('Keep default editor', 'saved');
    await checkMenu(['Recover default editor']);
    const result = await page.evaluate(async () => {
      const snapshot = JSON.parse(await operationsTestAppClass.exec(operationsTestApp, '(Project.snapshot app.filesystem state)'));
      return { main: snapshot.files['/editor/main.lisp'].data, project: snapshot.files['/project/preserved.txt'].data,
        backups: Object.entries(snapshot.files).filter(([path]) => path.startsWith('/editor/backups/') && path.endsWith('/main.lisp'))
          .map(([, file]) => file.data), failed: operationsTestApp.failed };
    });
    assert.deepEqual(result, { main: original, project: 'my project', backups: [original + '\n; customized editor\n'], failed: false });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

async function sourceProxy(page) {
  const index = await page.evaluate(async () => {
    const { App } = await import('/hg/app.js');
    const target = App.exec(operationsTestApp, 'source-node').state.proxy.target;
    return [...document.querySelectorAll('[data-hg-text-proxy]')].indexOf(target);
  });
  assert.ok(index >= 0);
  return page.locator('[data-hg-text-proxy]').nth(index);
}

async function filename(page, value, path) {
  await page.waitForFunction(async () => {
    const { App } = await import('/hg/app.js');
    const find = node => node.state?.prompt?.props.visible && node.state.input?.bounds.z > 0 ||
      node.children?.some(find);
    return find(App.exec(operationsTestApp, 'desktop').root);
  });
  const inputState = await page.evaluate(async () => {
    const { App } = await import('/hg/app.js');
    const find = node => {
      if (node.state?.prompt?.props.visible && node.state.input) return node.state.input;
      for (const child of node.children ?? []) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    const input = find(App.exec(operationsTestApp, 'desktop').root);
    return { index: [...document.querySelectorAll('[data-hg-text-proxy]')].indexOf(input.state.proxy.target),
      x: input.bounds.x + input.bounds.z / 2, y: input.bounds.y + input.bounds.w / 2 };
  });
  assert.ok(inputState.index >= 0);
  await page.mouse.click(inputState.x, inputState.y);
  const input = page.locator('[data-hg-text-proxy]').nth(inputState.index);
  await input.fill(value);
  await input.press('Enter');
  await page.waitForFunction(path => {
    const model = operationsTestApp.state.editor;
    return model.files.selected === path && model.files.mode === '' && !model.files.busy && !model.switching;
  }, path);
}

for (const trace of [true, false]) {
  test(`project settings edit, validate, reload the game, and survive refresh/export (trace=${trace})`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const capture = async () => page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        const app = operationsTestApp, ui = App.exec(app, 'desktop'), pane = App.exec(app, 'settings-pane');
        const find = node => node.state?.entry && node.state?.numbers ? node : node.children.map(find).find(Boolean);
        window.settingsTest = { App, app, ui, pane, node: find(pane), game: App.exec(app, 'game-node') };
      });
      const fill = async (field, value) => {
        const input = await page.evaluate(field => {
          const node = settingsTest.node.state.numbers[field] ?? settingsTest.node.state[field];
          return { index: [...document.querySelectorAll('[data-hg-text-proxy]')].indexOf(node.state.proxy.target),
            x: node.bounds.x + Math.min(50, node.bounds.z / 2), y: node.bounds.y + node.bounds.w / 2 };
        }, field);
        assert.ok(input.index >= 0);
        await page.mouse.click(input.x, input.y);
        await page.locator('[data-hg-text-proxy]').nth(input.index).fill(value);
        await page.waitForFunction(({ field, value }) =>
          (settingsTest.node.state.numbers[field] ?? settingsTest.node.state[field]).props.value === value, { field, value });
      };
      await openEditor(page, trace);
      await capture();
      assert.equal(await page.evaluate(() => settingsTest.pane.state.closed), true);
      await page.evaluate(() => settingsTest.App.exec(settingsTest.app,
        '(fs-write-text "/project/other.lisp" "(let settings-marker 42) (on render (c) (clear))" 0)'));
      await projectMenu(page, 'Settings');
      await page.waitForFunction(() => settingsTest.node.state.entry.state.proxy && settingsTest.node.state.entry.bounds.z > 0);
      assert.deepEqual(await page.evaluate(() => [settingsTest.node.state.entry.props.value,
        settingsTest.node.state.numbers.w.props.value, settingsTest.node.state.numbers.ups.props.value]), ['/project/main.lisp', '', '60']);
      await fill('entry', '/project/missing.lisp');
      await clickButton(page, 'Save settings');
      await page.waitForFunction(() => settingsTest.node.state.status.props.value.includes('existing text file') && !settingsTest.node.state.busy);
      assert.equal(await page.evaluate(() => settingsTest.app.filesystem.project.entry), '/project/main.lisp');
      await fill('entry', '/project/other.lisp');
      await fill('w', '1.5');
      await clickButton(page, 'Save settings');
      await page.waitForFunction(() => settingsTest.node.state.status.props.value.includes('positive integer') && !settingsTest.node.state.busy);
      assert.equal(await page.evaluate(() => settingsTest.node.state.entry.props.value), '/project/other.lisp');
      await clickButton(page, 'Revert');
      await page.waitForFunction(() => settingsTest.node.state.entry.props.value === '/project/main.lisp' &&
        settingsTest.node.state.status.props.value === '');
      await fill('entry', '/project/other.lisp');
      for (const [field, value] of Object.entries({ w: '320', h: '180', si: '1', ups: '30' })) await fill(field, value);
      await clickButton(page, 'Image smoothing: off');
      await clickButton(page, 'Execution tracing: inherit');
      const options = { w: 320, h: 180, si: 1, is: true, ups: 30, trace: true };
      await page.evaluate(async () => {
        const { Storage } = await import('/hg/storage.js');
        window.settingsCommit = Storage.commit;
        Storage.commit = () => Promise.reject(new Error('Settings storage denied'));
      });
      await clickButton(page, 'Save settings');
      await page.waitForFunction(() => settingsTest.node.state.status.props.value === 'Settings storage denied' && !settingsTest.node.state.busy);
      assert.equal(await page.evaluate(() => settingsTest.app.filesystem.project.entry), '/project/main.lisp');
      assert.equal(await page.evaluate(() => settingsTest.node.state.numbers.w.props.value), '320');
      await page.evaluate(async () => { (await import('/hg/storage.js')).Storage.commit = settingsCommit; });
      await clickButton(page, 'Save settings');
      await page.waitForFunction(() => settingsTest.node.state.status.props.value === 'Settings saved.' && !settingsTest.node.state.busy);
      await page.waitForFunction(() => settingsTest.game.state.child?.sourceURL?.endsWith('/project/other.lisp') &&
        !settingsTest.game.state.loading && !settingsTest.game.state.error);
      assert.equal(await page.evaluate(() => settingsTest.App.exec(settingsTest.game.state.child, 'settings-marker')), 42);
      assert.deepEqual(await page.evaluate(() => settingsTest.app.filesystem.project.app), options);
      assert.deepEqual(await page.evaluate(() => {
        const child = settingsTest.game.state.child;
        return [child.w, child.h, child.si, child.is, child.ups, child.trace, child.view.w, child.view.h];
      }), [320, 180, 1, true, 30, true, 320, 180]);
      const snapshot = await page.evaluate(async () => JSON.parse(await settingsTest.App.exec(settingsTest.app,
        '(Project.snapshot app.filesystem state)')));
      assert.equal(snapshot.entry, '/project/other.lisp');
      assert.deepEqual(snapshot.app, options);
      assert.equal(Object.hasOwn(snapshot, 'assetURL'), false);
      // A changed configuration must not disable the tab's pagehide checkpoint.
      await page.evaluate(async () => {
        const { Data } = await import('/hg/data.js');
        // Old stored URLs cannot change the host's local fallback location.
        const fs = settingsTest.app.filesystem;
        await Data.get(settingsTest.app.__filesystemApi__, 'setProject')(fs, { ...fs.project, assetURL: 'https://old-assets.invalid/' });
        const model = settingsTest.app.state.editor;
        model.source += '\n; unsaved after configuration';
        model.dirty = true; model.pending = false;
        settingsTest.App.exec(settingsTest.app, '(ui-pane-close desktop settings-pane)');
      });
      await page.reload();
      await page.waitForFunction(() => operationsTestApp?.__reflection__?.scene && !operationsTestApp.attaching);
      await capture();
      assert.equal(await page.evaluate(() => settingsTest.app.state.editor.source.endsWith('; unsaved after configuration')), true);
      assert.equal(await page.evaluate(() => settingsTest.app.filesystem.localURL), `${baseURL}/`);
      assert.deepEqual(await page.evaluate(() => settingsTest.app.filesystem.project.app), options);
      await projectMenu(page, 'Settings');
      await page.waitForFunction(() => settingsTest.node.state.entry.state.proxy && settingsTest.node.state.entry.bounds.z > 0);
      assert.deepEqual(await page.evaluate(() => [settingsTest.node.state.entry.props.value,
        settingsTest.node.state.numbers.w.props.value, settingsTest.node.state.numbers.ups.props.value]), ['/project/other.lisp', '320', '30']);
      assert.equal(await page.locator('#host-error').isVisible(), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${process.env.TEMP}/mercury-project-settings.png` });
      // Reproduce the original pane crash in the saved editor, then recover with the pristine bundle.
      await page.evaluate(async () => {
        const { Data } = await import('/hg/data.js');
        const { App, app } = settingsTest, fs = app.filesystem, api = app.__filesystemApi__;
        App.exec(app, '(ui-pane-close desktop settings-pane)');
        const source = await Data.get(api, 'readText')(fs, '/editor/settings.lisp');
        await Data.get(api, 'writeText')(fs, '/editor/settings.lisp', source.replace('"padding" 0', '"padding" nil'), null);
        await App.exec(app, '(reload-editor)');
      });
      await capture();
      await projectMenu(page, 'Settings');
      await page.locator('#host-error').waitFor({ state: 'visible' });
      assert.match(await page.locator('#host-diagnostic').textContent(), /padding expects/);
      await page.keyboard.press('F2');
      await page.waitForFunction(() => operationsTestApp.state['editor-mode'] === 'recovery' &&
        operationsTestApp.__reflection__?.scene && !operationsTestApp.attaching && !operationsTestApp.failed);
      await capture();
      await page.waitForFunction(() => settingsTest.node.state.entry.state.proxy && settingsTest.node.state.entry.bounds.z > 0);
      assert.equal(await page.locator('#host-error').isVisible(), false);
      assert.equal(await page.evaluate(() => settingsTest.node.state.numbers.w.props.value), '320');
      // Recovery can replace the broken saved editor and return to the project without losing its settings.
      await page.evaluate(() => settingsTest.App.exec(settingsTest.app, '(ui-pane-close desktop settings-pane)'));
      await projectMenu(page, 'Keep default editor');
      await page.waitForFunction(() => operationsTestApp.state['editor-mode'] === 'saved' &&
        operationsTestApp.__reflection__?.scene && !operationsTestApp.attaching && !operationsTestApp.failed);
      await capture();
      await projectMenu(page, 'Settings');
      await page.waitForFunction(() => settingsTest.node.state.entry.state.proxy && settingsTest.node.state.entry.bounds.z > 0);
      assert.deepEqual(await page.evaluate(() => settingsTest.app.filesystem.project.app), options);
      assert.equal(await page.locator('#host-error').isVisible(), false);
      assert.equal(errors.filter(message => !message.includes('padding expects')).length, 0);
    } finally { await browser.close(); }
  });

  test(`Diagnostics copies full text, reports clipboard failures, and remains usable (trace=${trace})`, { timeout: 30000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 },
        permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await openEditor(page, trace);
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        window.copyTest = { diagnostics: App.exec(operationsTestApp, 'diagnostics'),
          status: App.exec(operationsTestApp, 'copy-status') };
      });
      await clickButton(page, 'Copy');
      await page.waitForFunction(() => copyTest.status.props.value === 'Copied');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'No errors.');
      const diagnostic = 'Compile error: unexpected token 👋\n' +
        Array.from({ length: 80 }, (_, i) => `main.lisp:${i + 1}: ${'long diagnostic '.repeat(30)}`).join('\n');
      await page.evaluate(message => { operationsTestApp.state.editor.error = message; }, diagnostic);
      await page.waitForFunction(message => copyTest.diagnostics.props.value === message &&
        copyTest.status.props.value === '', diagnostic);
      await clickButton(page, 'Copy');
      await page.waitForFunction(() => copyTest.status.props.value === 'Copied');
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), diagnostic);
      await page.evaluate(() => {
        window.clipboardWrite = navigator.clipboard.writeText;
        navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard denied'));
      });
      await clickButton(page, 'Copy');
      await page.waitForFunction(() => copyTest.status.props.value === 'Copy failed: Clipboard denied');
      const failure = await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        return [App.exec(operationsTestApp, 'copy-status').props.value,
          App.exec(operationsTestApp, 'diagnostics').props.value, operationsTestApp.state.editor.error,
          operationsTestApp.failed];
      });
      assert.deepEqual(failure, ['Copy failed: Clipboard denied', diagnostic, diagnostic, false]);
      await page.evaluate(() => { navigator.clipboard.writeText = clipboardWrite; });
      await clickButton(page, 'Copy');
      await page.waitForFunction(() => copyTest.status.props.value === 'Copied');
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), diagnostic);
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
      await clickButton(page, 'Copy');
      await page.waitForFunction(() => copyTest.status.props.value === 'Copy failed: Clipboard access is unavailable.');
      assert.equal(await page.evaluate(() => copyTest.diagnostics.props.value), diagnostic);
      await page.evaluate(() => { delete navigator.clipboard; });
      assert.equal(await page.locator('#host-error').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test(`fresh and new projects open only main.lisp with a pulsing gradient (trace=${trace})`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await openEditor(page, trace);
      const starter = readFileSync(new URL('../../project/main.lisp', import.meta.url), 'utf8');
      for (let reset = 0; reset < 2; reset++) {
        const project = await page.evaluate(async () => {
          const { App } = await import('/hg/app.js');
          const app = operationsTestApp;
          return { files: Object.keys(app.filesystem.entries).filter(path => path.startsWith('/project/')),
            entry: app.filesystem.project.entry, path: app.state.editor.path,
            selected: app.state.editor.files.selected, source: app.state.editor.source,
            content: await App.exec(app, '(fs-read-text "/project/main.lisp")'), error: app.state.editor.error };
        });
        assert.deepEqual(project, { files: ['/project/main.lisp'], entry: '/project/main.lisp',
          path: '/project/main.lisp', selected: '/project/main.lisp', source: starter, content: starter, error: '' });
        assert.deepEqual(await page.evaluate(() => operationsTestApp.state.editor.files.expanded), { '/': true });
        if (reset === 0) {
          await page.evaluate(async () => {
            const { App } = await import('/hg/app.js');
            await App.exec(operationsTestApp, '(fs-write-text "/project/old.lisp" "; old project" nil)');
            operationsTestApp.state.editor.files.expanded['/editor'] = true;
            operationsTestApp.state.editor.files.expanded['/project'] = true;
            window.beforeNewProject = operationsTestApp;
          });
          await projectMenu(page, 'New Project');
          await page.waitForFunction(() => operationsTestApp !== beforeNewProject && operationsTestApp.scene && !operationsTestApp.attaching);
        }
      }
      // Render the saved starter at fixed times to verify the gradient and pulse on WebGPU.
      await page.evaluate(async ({ starter, trace }) => {
        const { AppCore } = await import('/hg/app.js');
        const { Scheduler } = await import('/hg/scheduler.js');
        const canvas = document.createElement('canvas');
        canvas.id = 'starter-test'; canvas.width = 64; canvas.height = 48;
        Object.assign(canvas.style, { position: 'fixed', top: '0', left: '0', zIndex: '100' });
        document.body.append(canvas);
        const runtime = AppCore.new({ trace, onError: error => { throw error; } });
        await AppCore.attach(runtime, canvas);
        AppCore.setScene(runtime, starter);
        Scheduler.stop(runtime);
        window.starterTest = { runtime, AppCore, Scheduler };
      }, { starter, trace });
      const sample = time => page.evaluate(async time => {
        const { runtime, Scheduler } = starterTest;
        Scheduler.render(runtime, runtime.scene.render, 0, time);
        await runtime.graphics.device.queue.onSubmittedWorkDone();
        const context = document.getElementById('starter-test').getContext('2d');
        const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
        return { center: pixel(32, 24), corner: pixel(0, 0) };
      }, time);
      const bright = await sample(Math.PI / 2), dim = await sample(3 * Math.PI / 2);
      for (const frame of [bright, dim]) {
        assert.equal(frame.center[3], 255);
        assert.ok(frame.center[0] > frame.corner[0] + 40, `horizontal gradient: ${JSON.stringify(frame)}`);
        assert.ok(frame.center[1] > frame.corner[1] + 40, `vertical gradient: ${JSON.stringify(frame)}`);
      }
      assert.ok(bright.center.slice(0, 3).some((value, channel) => value > dim.center[channel] + 40),
        `gradient pulses: ${bright.center} vs ${dim.center}`);
      await page.evaluate(() => starterTest.AppCore.destroy(starterTest.runtime));
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test(`Save Project downloads current files repeatedly and survives reload (trace=${trace})`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await openEditor(page, trace);
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        await App.exec(operationsTestApp, '(open-file "/project/main.lisp")');
        operationsTestApp.state.editor.auto = false;
        operationsTestApp.state.project = { score: 42 };
      });
      const failure = await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        const { Resources } = await import('/hg/resources.js');
        const download = Resources.download;
        Resources.download = () => { throw new Error('Download unavailable'); };
        try {
          return { result: await App.exec(operationsTestApp, '(save-project)'), error: operationsTestApp.state.editor.error };
        } finally { Resources.download = download; }
      });
      assert.deepEqual(failure, { result: false, error: 'Download unavailable' });
      const draft = '(on render (c) (clear 0.25))\n; project save regression';
      await (await sourceProxy(page)).fill(draft);
      let projectSource;
      for (let save = 0; save < 2; save++) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }),
          projectMenu(page, 'Save Project'),
        ]);
        assert.equal(download.suggestedFilename(), 'project.json');
        projectSource = readFileSync(await download.path(), 'utf8');
        const saved = JSON.parse(projectSource);
        assert.equal(saved.format, 'mercury-project');
        assert.equal(saved.files['/project/main.lisp'].data, draft);
        assert.deepEqual(saved.state.project, { score: 42 });
        assert.deepEqual(await page.evaluate(() => ({ error: operationsTestApp.state.editor.error,
          failed: operationsTestApp.failed, entry: operationsTestApp.filesystem.project.entry })),
          { error: '', failed: false, entry: '/project/main.lisp' });
      }
      await page.evaluate(() => {
        window.beforeProjectOpen = operationsTestApp;
        operationsTestApp.state.project.score = 99;
      });
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'), projectMenu(page, 'Open Project'),
      ]);
      await chooser.setFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(projectSource) });
      await page.waitForFunction(() => operationsTestApp !== beforeProjectOpen && operationsTestApp.scene && !operationsTestApp.attaching);
      assert.deepEqual(await page.evaluate(() => [operationsTestApp.state.editor.source,
        operationsTestApp.state.project, operationsTestApp.state.editor.error]), [draft, { score: 42 }, '']);
      await page.reload();
      await page.waitForFunction(() => window.operationsTestApp?.scene && !operationsTestApp.attaching);
      assert.deepEqual(await page.evaluate(() => [operationsTestApp.state.editor.source,
        operationsTestApp.state.project, operationsTestApp.state.editor.error]), [draft, { score: 42 }, '']);
      assert.equal(await page.locator('#host-error').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test('a project theme file styles the editor and can be reapplied without replacing controls', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await openEditor(page, true);
    const result = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const app = operationsTestApp, oldScene = app.scene;
      const write = App.exec(app, 'fs-write-text');
      const defaultTheme = await App.exec(app, '(fs-read-text "/editor/theme.lisp")');
      await write('/project/my-theme.lisp', `
        (let Base (await (import "/editor/theme.lisp")))
        (let theme (re-copy Base.theme))
        (set theme.background (vec4 0.1 0.2 0.3 1))
        (set theme.components.pane.background theme.background)
        (set theme.components.button.hover (vec4 0.4 0.3 0.2 1))
        (set theme.components.label.size 17)
        (set theme.code-size 18)`, null);
      const uiSource = await App.exec(app, '(fs-read-text "/editor/ui.lisp")');
      await write('/editor/ui.lisp', uiSource.replace('"../editor/theme.lisp"', '"../project/my-theme.lisp"'), null);
      const reloaded = await App.exec(app, '(reload-editor)');
      if (!reloaded) throw new Error(app.state.editor.error);
      const ui = App.exec(app, 'desktop'), theme = App.exec(app, 'Theme');
      const source = App.exec(app, 'source-node'), proxy = source.state.proxy;
      const panes = App.exec(app, 'workspace').state.panes;
      const header = panes[0].children[0], minimize = header.children[1], icon = minimize.children[0];
      const rgba = value => [value.x, value.y, value.z, value.w].map(channel => Math.round(channel * 1000) / 1000);
      const initial = { reloaded, replaced: oldScene !== app.scene, background: rgba(ui.background),
        pane: rgba(panes[0].props.background), codeSize: source.props.size,
        hover: rgba(minimize.props.hover), icon: theme.icons.code,
        sharedTheme: App.exec(app, '(and (same? ui-theme-data Theme) (same? Editor.Theme Theme) (same? Files.Theme Theme) (same? Game.Theme Theme) (same? Settings.Theme Theme) (same? Inspector.Theme Theme))'),
        defaultUnchanged: defaultTheme === await App.exec(app, '(fs-read-text "/editor/theme.lisp")') };
      const count = app.textProxies.size;
      theme.components.button.hover = App.exec(app, '(vec4 0.6 0.5 0.4 1)');
      for (let i = 0; i < 3; i++) App.exec(app, 'ui-theme')(ui, theme);
      return { ...initial, hoverAfter: rgba(minimize.props.hover),
        sameControl: minimize.children[0] === icon, sameProxy: source.state.proxy === proxy,
        proxyCount: app.textProxies.size === count, error: app.state.editor.error, failed: app.failed };
    });
    assert.deepEqual(result, { reloaded: true, replaced: true, background: [0.1, 0.2, 0.3, 1],
      pane: [0.1, 0.2, 0.3, 1], codeSize: 18, hover: [0.4, 0.3, 0.2, 1],
      icon: 'vfs://mercury/editor/icons/code.png', hoverAfter: [0.6, 0.5, 0.4, 1],
      sharedTheme: true, defaultUnchanged: true, sameControl: true, sameProxy: true, proxyCount: true, error: '', failed: false });
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      await App.exec(operationsTestApp, '(open-file "/project/my-theme.lisp")');
    });
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('file creation, saving, rename, and deletion remain usable through canvas controls', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await openEditor(page, false);
    await clickButton(page, 'Folder +');
    await filename(page, 'stability', '/project/stability');
    await clickButton(page, 'File +');
    await filename(page, 'notes.lisp', '/project/stability/notes.lisp');
    const draft = '; created and saved from the editor';
    await (await sourceProxy(page)).fill(draft);
    const download = page.waitForEvent('download');
    await projectMenu(page, 'Save Project');
    await download;
    await page.waitForFunction(() => !operationsTestApp.state.editor.dirty && !operationsTestApp.state.editor.saving);
    await clickButton(page, 'Rename');
    await filename(page, 'renamed.lisp', '/project/stability/renamed.lisp');
    assert.deepEqual(await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      return [operationsTestApp.state.editor.path,
        await App.exec(operationsTestApp, '(fs-read-text "/project/stability/renamed.lisp")')];
    }), ['/project/stability/renamed.lisp', draft]);
    await clickButton(page, 'Delete');
    await page.waitForFunction(() => operationsTestApp.state.editor.files['confirm-delete'] !== '');
    await clickButton(page, 'Delete contents');
    await page.waitForFunction(() => operationsTestApp.state.editor.path === '' && !operationsTestApp.state.editor.files.busy);
    assert.deepEqual(await page.evaluate(() => [operationsTestApp.state.editor.error,
      operationsTestApp.state.editor.files.error, operationsTestApp.failed]), ['', '', false]);
    const cancelled = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const { Resources } = await import('/hg/resources.js');
      const openText = Resources.openText;
      Resources.openText = () => Promise.resolve(null);
      try {
        const result = await App.exec(operationsTestApp, '(open-project)');
        const proxy = App.exec(operationsTestApp, 'source-node').state.proxy;
        return [result, operationsTestApp.state.editor.locked, proxy.target.readOnly,
          operationsTestApp.state.editor.reloading];
      } finally { Resources.openText = openText; }
    });
    assert.deepEqual(cancelled, [false, true, true, false]);
    assert.equal(await page.locator('#host-error').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('saves preserve edits made during a write and failed writes remain explicitly retryable', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openEditor(page, false);
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const { Data } = await import('/hg/data.js');
      await App.exec(operationsTestApp, '(open-file "/project/main.lisp")');
      operationsTestApp.state.editor.auto = false;
      Data.put(App.exec(operationsTestApp, 'Theme'), 'save-delay', 3600);
      const api = operationsTestApp.__filesystemApi__;
      window.originalWrite = Data.get(api, 'writeText');
      window.writeStarted = new Promise(resolve => { window.noteWrite = resolve; });
      Data.put(api, 'writeText', (...args) => {
        noteWrite();
        return new Promise(resolve => { window.releaseWrite = resolve; }).then(() => originalWrite(...args));
      });
    });
    await (await sourceProxy(page)).fill('; first edit');
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      window.pendingSave = App.exec(operationsTestApp, '(save-file)');
      await writeStarted;
    });
    await (await sourceProxy(page)).fill('; newer edit');
    const intermediate = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const { Data } = await import('/hg/data.js');
      Data.put(operationsTestApp.__filesystemApi__, 'writeText', originalWrite);
      releaseWrite();
      const result = await pendingSave;
      const model = operationsTestApp.state.editor;
      return [result, model.source, model['saved-source'], model.dirty, model.pending, model.saving,
        await App.exec(operationsTestApp, '(fs-read-text "/project/main.lisp")')];
    });
    assert.deepEqual(intermediate, [true, '; newer edit', '; first edit', true, true, false, '; first edit']);
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const { Data } = await import('/hg/data.js');
      await App.exec(operationsTestApp, '(flush-file)');
      Data.put(operationsTestApp.__filesystemApi__, 'writeText', () => { throw new Error('Write unavailable'); });
    });
    await (await sourceProxy(page)).fill('; retry this edit');
    const failed = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const result = await App.exec(operationsTestApp, '(save-file)');
      const model = operationsTestApp.state.editor;
      return [result, model.dirty, model.pending, model.saving, model.error];
    });
    assert.deepEqual(failed, [false, true, false, false, 'Write unavailable']);
    const retried = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const { Data } = await import('/hg/data.js');
      Data.put(operationsTestApp.__filesystemApi__, 'writeText', originalWrite);
      const result = await App.exec(operationsTestApp, '(save-file)');
      const model = operationsTestApp.state.editor;
      return [result, model.dirty, model.pending, model.saving, model.error,
        await App.exec(operationsTestApp, '(fs-read-text "/project/main.lisp")')];
    });
    assert.deepEqual(retried, [true, false, false, false, '', '; retry this edit']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('F2 and Keep default editor repair a saved broken filesystem while preserving project files', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await openEditor(page, false);
    await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const source = await App.exec(operationsTestApp, '(fs-read-text "/editor/vfs.lisp")');
      const broken = source.replaceAll('(return metadata)', 'metadata')
        .replace('(return (dict "updated" updated "backup" backup))', '(dict "updated" updated "backup" backup)');
      const write = App.exec(operationsTestApp, 'fs-write-text');
      await write('/editor/vfs.lisp', broken, null);
      await write('/project/preserved.txt', 'keep my project', null);
    });
    await page.reload();
    await page.waitForFunction(() => window.operationsTestApp?.scene && !operationsTestApp.attaching);
    assert.deepEqual(await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      return [await App.exec(operationsTestApp, '(save-project)'), operationsTestApp.state.editor.error];
    }), [false, 'Dot access requires a collection, struct, or vector']);
    await page.keyboard.press('F2');
    await page.waitForFunction(() => operationsTestApp.state['editor-mode'] === 'recovery' && operationsTestApp.scene && !operationsTestApp.attaching);
    assert.ok(errors.every(message => message.includes('Unable to preserve the editor session')));
    errors.length = 0;
    await projectMenu(page, 'Keep default editor');
    await page.waitForFunction(() => operationsTestApp.state['editor-mode'] === 'saved' && operationsTestApp.scene && !operationsTestApp.attaching);
    const result = await page.evaluate(async () => {
      const { App } = await import('/hg/app.js');
      const snapshot = JSON.parse(await App.exec(operationsTestApp, '(Project.snapshot app.filesystem state)'));
      return { content: snapshot.files['/project/preserved.txt'].data,
        backups: Object.keys(snapshot.files).filter(path => path.startsWith('/editor/backups/') && path.endsWith('/vfs.lisp')),
        error: operationsTestApp.state.editor.error, failed: operationsTestApp.failed };
    });
    assert.equal(result.content, 'keep my project');
    assert.equal(result.backups.length, 1);
    assert.deepEqual([result.error, result.failed], ['', false]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
