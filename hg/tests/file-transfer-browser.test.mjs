import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

async function ready(page) {
  await page.waitForFunction(() => window.transferApp?.__reflection__?.scene && !transferApp.attaching);
  assert.equal(await page.locator('#host-error').isVisible(), false);
  await page.evaluate(async () => {
    const { App } = await import('/hg/app.js'), { Data } = await import('/hg/data.js');
    const app = transferApp, ui = App.exec(app, 'desktop');
    const find = node => node.state?.context && node.props?.flush ? node : node.children.map(find).find(Boolean);
    const node = find(App.exec(app, 'files-pane'));
    window.transferTest = { App, Data, app, ui, node, toolbar: node.children[0] };
  });
}
async function click(page, label, button = 'left') {
  await page.waitForFunction(label => {
    const find = node => node.props.visible !== false &&
      ((node.props.value === label && node.bounds.z > 0 && node.clip.z > 0) || node.children.some(find));
    return find(transferTest.ui.popup?.node ?? transferTest.ui.root);
  }, label);
  const point = await page.evaluate(label => {
    const { ui } = transferTest;
    const hasLabel = node => node.props?.value === label || node.children.some(hasLabel);
    const find = node => {
      if (node.props.visible === false) return;
      if (node.handlers?.click?.length && hasLabel(node)) return node;
      return node.children.map(find).find(Boolean);
    };
    const node = find(ui.popup?.node ?? ui.root);
    if (!node) throw new Error(`Missing control: ${label}`);
    const left = Math.max(node.bounds.x, node.clip.x), top = Math.max(node.bounds.y, node.clip.y);
    const right = Math.min(node.bounds.x + node.bounds.z, node.clip.x + node.clip.z);
    const bottom = Math.min(node.bounds.y + node.bounds.w, node.clip.y + node.clip.w);
    if (right <= left || bottom <= top) throw new Error(`Clipped control: ${label}`);
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }, label);
  await page.mouse.click(point.x, point.y, { button });
}
async function toolbarEnd(page) {
  const point = await page.evaluate(() => {
    const node = transferTest.toolbar;
    return { x: node.bounds.x + node.bounds.z / 2, y: node.bounds.y + node.bounds.w / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(10000, 0);
  await page.waitForFunction(() => transferTest.toolbar.state.scroll === transferTest.toolbar.state['max-scroll']);
}
async function importMenu(page) {
  await toolbarEnd(page); await click(page, 'Import');
  await page.waitForFunction(() => transferTest.ui.popup?.node.bounds.z > 0);
}
async function contextMenu(page, label) {
  await click(page, label, 'right');
  await page.waitForFunction(() => transferTest.ui.popup?.node.bounds.z > 0);
}
async function idle(page) {
  await page.waitForFunction(() => !transferTest.app.state.editor.files.busy);
}
const textFile = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

for (const trace of [true, false]) {
  test(`Files imports/exports files and folders at root or context destination (trace=${trace})`, { timeout: 60000 }, async t => {
    const fixture = await mkdtemp(join(tmpdir(), 'mercury-transfer-'));
    t.after(async () => { assert.equal(dirname(fixture), tmpdir()); await rm(fixture, { recursive: true, force: true }); });
    const diskFolder = join(fixture, 'Disk folder');
    await mkdir(join(diskFolder, 'nested'), { recursive: true });
    await writeFile(join(diskFolder, 'nested', 'café.txt'), 'disk folder text');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.route('**/index.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text())
          .replace('host.app = app;', 'host.app = app; window.transferApp = app;') });
      });
      await page.goto(new URL(trace ? '/?trace=1' : '/', baseURL).href); await ready(page);
      // A toolbar import still targets / when another directory is selected.
      await contextMenu(page, 'editor'); await page.keyboard.press('Escape');
      await importMenu(page);
      let [chooser] = await Promise.all([page.waitForEvent('filechooser'), click(page, 'Import files')]);
      assert.equal(chooser.isMultiple(), true);
      await chooser.setFiles([textFile('notes.lisp', '; original 👋'),
        { name: 'data.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 128, 255]) }]);
      await idle(page);
      assert.deepEqual(await page.evaluate(async () => {
        const { App, app } = transferTest;
        return [await App.exec(app, '(fs-read-text "/notes.lisp")'),
          await App.exec(app, '(fs-read-bytes "/data.bin")'), app.state.editor.files.error];
      }), ['; original 👋', [0, 128, 255], '']);

      await importMenu(page);
      [chooser] = await Promise.all([page.waitForEvent('filechooser'), click(page, 'Import files')]);
      await chooser.setFiles([textFile('partial.txt', 'must not be committed'), textFile('notes.lisp', 'overwrite')]);
      await idle(page);
      assert.deepEqual(await page.evaluate(() => [transferTest.App.exec(transferTest.app, '(fs-stat "/partial.txt")'),
        transferTest.app.state.editor.files.error]), [null, 'Path already exists: /notes.lisp']);

      await importMenu(page);
      await Promise.all([page.waitForEvent('filechooser'), click(page, 'Import files')]);
      await page.evaluate(() => document.querySelector('input[type=file]').dispatchEvent(new Event('cancel')));
      await idle(page);
      assert.equal(await page.locator('input[type=file]').count(), 0);
      await click(page, 'project');
      await page.evaluate(async () => {
        await transferTest.App.exec(transferTest.app, '(fs-mkdir "/project/target")');
      });
      await contextMenu(page, 'target');
      [chooser] = await Promise.all([page.waitForEvent('filechooser'), click(page, 'Import files')]);
      await chooser.setFiles(textFile('inside.txt', 'folder destination'));
      await idle(page);
      assert.equal(await page.evaluate(() => transferTest.App.exec(transferTest.app,
        '(fs-read-text "/project/target/inside.txt")')), 'folder destination');

      // Directory handles include empty folders; the picker must be invoked during the user gesture.
      await page.evaluate(() => {
        const file = (name, bytes, type) => ({ kind: 'file', name, getFile: async () => new File([bytes], name, { type }) });
        const dir = (name, children) => ({ kind: 'directory', name, async *values() { yield* children; } });
        window.showDirectoryPicker = async () => {
          window.directoryPickerActive = navigator.userActivation.isActive;
          return dir('Assets', [dir('empty', []), dir('nested', [file('pixels.bin', new Uint8Array([0, 128, 255]), 'application/octet-stream')]),
            file('café #👋.txt', 'folder text 👋', 'text/plain')]);
        };
      });
      await contextMenu(page, 'target'); await click(page, 'Import folder'); await idle(page);
      assert.equal(await page.evaluate(() => directoryPickerActive), true);
      assert.deepEqual(await page.evaluate(async () => {
        const { App, app } = transferTest;
        return [App.exec(app, '(fs-stat "/project/target/Assets/empty")').kind,
          await App.exec(app, '(fs-read-bytes "/project/target/Assets/nested/pixels.bin")'),
          await App.exec(app, '(fs-read-text "/project/target/Assets/café #👋.txt")')];
      }), ['directory', [0, 128, 255], 'folder text 👋']);

      // The directory-input fallback also preserves paths beneath the selected folder.
      await page.evaluate(() => { window.showDirectoryPicker = undefined; });
      await importMenu(page);
      [chooser] = await Promise.all([page.waitForEvent('filechooser'), click(page, 'Import folder')]);
      await chooser.setFiles(diskFolder); await idle(page);
      assert.equal(await page.evaluate(() => transferTest.App.exec(transferTest.app,
        '(fs-read-text "/Disk folder/nested/café.txt")')), 'disk folder text');

      const sourceIndex = await page.evaluate(async () => {
        const { App, app } = transferTest;
        await App.exec(app, '(open-file "/notes.lisp")');
        return [...document.querySelectorAll('[data-hg-text-proxy]')]
          .indexOf(App.exec(app, 'source-node').state.proxy.target);
      });
      await page.locator('[data-hg-text-proxy]').nth(sourceIndex).fill('; latest unsaved export 👋');
      await page.evaluate(() => { transferTest.app.state.editor.pending = false; });
      await contextMenu(page, 'notes.lisp');
      let [download] = await Promise.all([page.waitForEvent('download'), click(page, 'Export')]);
      assert.equal(download.suggestedFilename(), 'notes.lisp');
      assert.equal(await readFile(await download.path(), 'utf8'), '; latest unsaved export 👋');
      await contextMenu(page, 'data.bin');
      await page.keyboard.press('Escape');
      await toolbarEnd(page);
      [download] = await Promise.all([page.waitForEvent('download'), click(page, 'Export')]);
      assert.equal(download.suggestedFilename(), 'data.bin');
      assert.deepEqual(await readFile(await download.path()), Buffer.from([0, 128, 255]));
      await contextMenu(page, 'Assets');
      [download] = await Promise.all([page.waitForEvent('download'), click(page, 'Export')]);
      assert.equal(download.suggestedFilename(), 'Assets.zip');
      const archive = await readFile(await download.path());
      assert.equal(archive.readUInt32LE(), 0x04034b50);
      assert.ok(archive.includes(Buffer.from('Assets/empty/')));
      assert.ok(archive.includes(Buffer.from('Assets/café #👋.txt')));
      await download.saveAs(join(tmpdir(), `mercury-transfer-${trace ? 'trace' : 'plain'}.zip`));
      const saved = await page.evaluate(async () => JSON.parse(await transferTest.App.exec(transferTest.app,
        '(Project.snapshot app.filesystem state)')));
      assert.equal(saved.files['/notes.lisp'].data !== undefined, true);
      assert.ok(saved.directories.includes('/project/target/Assets/empty'));
      await click(page, '/');
      assert.equal(await page.evaluate(() => transferTest.app.state.editor.files.selected), '/');
      await toolbarEnd(page);
      [download] = await Promise.all([page.waitForEvent('download'), click(page, 'Export')]);
      assert.equal(download.suggestedFilename(), 'files.zip');
      const whole = await readFile(await download.path());
      for (const path of ['files/editor/main.lisp', 'files/project/main.lisp', 'files/data.bin',
        'files/notes.lisp', 'files/project/target/Assets/empty/']) assert.ok(whole.includes(Buffer.from(path)), path);
      await page.reload(); await ready(page);
      assert.equal(await page.evaluate(() => transferTest.App.exec(transferTest.app, '(fs-read-text "/notes.lisp")')),
        '; latest unsaved export 👋');
      assert.deepEqual(errors, []);
      assert.equal(await page.locator('#host-error').isVisible(), false);
    } finally { await browser.close(); }
  });
}
