import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.AIOLI_URL || 'http://localhost:3000';

async function openEditor(page, trace) {
  await page.route('**/index.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace('host.app = app;', 'host.app = app; window.editorApp = app;') });
  });
  await page.goto(new URL(trace ? '/?trace=1' : '/', baseURL).href);
  await page.waitForFunction(() => window.editorApp?.__reflection__?.scene && !editorApp.attaching);
  await page.evaluate(async () => {
    window.App = (await import('/hg/app.js')).App;
    window.game = App.exec(editorApp, 'game-node');
  });
  await page.waitForFunction(() => game.state.child?.scene && !game.state.loading);
}

async function gamePoint(page) {
  return page.evaluate(() => {
    const b = game.state.view.bounds;
    return { x: b.x + b.z / 2, y: b.y + b.w / 2 };
  });
}

for (const trace of [true, false]) {
  test(`Game pane renders, routes input, reloads safely, and owns its child lifetime (trace=${trace})`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: trace ? 1 : 2 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await openEditor(page, trace);
      assert.deepEqual(await page.evaluate(() => ({
        sameDevice: game.state.child.graphics.device === editorApp.graphics.device,
        independentModules: game.state.child.modules !== editorApp.modules,
        sharedFilesystem: game.state.child.filesystem === editorApp.filesystem,
        sharedState: game.state.child.state === editorApp.state.project,
        children: editorApp.__children__.size,
        canvases: document.querySelectorAll('canvas').length,
        gameError: game.state.error,
      })), { sameDevice: true, independentModules: true, sharedFilesystem: true, sharedState: true,
        children: 1, canvases: 1, gameError: '' });

      const sample = time => page.evaluate(async time => {
        const { Scheduler } = await import('/hg/scheduler.js');
        const child = game.state.child;
        App.pause(child);
        Scheduler.render(child, child.scene.render, 0, time);
        App.exec(editorApp, '(ui-repaint desktop)');
        Scheduler.render(editorApp, editorApp.scene.render, 0, time);
        await child.graphics.device.queue.onSubmittedWorkDone();
        const b = game.state.view.bounds;
        const scale = App.exec(editorApp, 'desktop').scale;
        return [...editorApp.outerCanvas.getContext('2d')
          .getImageData(Math.floor((b.x + b.z / 2) * scale), Math.floor((b.y + b.w / 2) * scale), 1, 1).data];
      }, time);
      const bright = await sample(Math.PI / 2), dim = await sample(3 * Math.PI / 2);
      assert.equal(bright[3], 255);
      assert.ok(bright.slice(0, 3).some((value, channel) => value > dim[channel] + 40),
        `game pulses in its pane: ${bright} vs ${dim}`);

      const interactive = `
        (let Color (await (import "./color.lisp")))
        (configure (dict "w" 160 "h" 90 "scale-step" 1))
        (if (= app.state.loads nil) (set app.state.loads 0))
        (set app.state.loads (+ app.state.loads 1))
        (on pointerdown (event) (set app.state.point (copy event)))
        (on pointermove (event) (set app.state.move (copy event)))
        (on keydown (event) (set app.state.code event.code))
        (on render (context) (clear Color.value))`;
      // Save through the editor's actual buffer; this must trigger the game reload.
      await page.evaluate(async source => {
        editorApp.state.editor.auto = false;
        await App.exec(editorApp, '(fs-write-text "/project/color.lisp" "(let value (vec3 0.2 0.5 0.8))" nil)');
        const model = editorApp.state.editor;
        model.source = source; model.version++; model.dirty = true; model.pending = true;
        await App.exec(editorApp, '(save-file)');
        App.start(game.state.child);
      }, interactive);
      await page.waitForFunction(() => !game.state.loading && (game.state.error || game.state.child.source.includes('app.state.loads')));
      assert.equal(await page.evaluate(() => game.state.error), '');
      assert.equal(await page.evaluate(() => game.state.child.state.loads), 1);
      // Reload's flush consumes the save notification instead of scheduling a second reload.
      await page.evaluate(source => {
        const model = editorApp.state.editor;
        model.source = source + '\n; manual reload'; model.version++; model.dirty = true; model.pending = true;
      }, interactive);
      const reloadPoint = await page.evaluate(() => {
        const b = game.children[0].children[0].bounds;
        return { x: b.x + b.z / 2, y: b.y + b.w / 2 };
      });
      await page.mouse.click(reloadPoint.x, reloadPoint.y);
      await page.waitForFunction(() => !game.state.loading && game.state.child.state.loads === 2);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => game.state.child.state.loads), 2);
      const point = await gamePoint(page);
      await page.mouse.click(point.x, point.y);
      const input = await page.evaluate(() => ({
        x: game.state.child.state.point.x, y: game.state.child.state.point.y,
        inside: game.state.child.state.point.inside,
      }));
      assert.ok(Math.abs(input.x - 80) <= 1 && Math.abs(input.y - 45) <= 1, JSON.stringify(input));
      assert.equal(input.inside, true);
      assert.equal(await page.evaluate(() => 'ui' in game.state.child.state.point), false);
      await page.keyboard.down('w');
      assert.deepEqual(await page.evaluate(() => [game.state.child.state.code, game.state.child.input.bindings['key?']('KeyW')]), ['KeyW', true]);
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.evaluate(() => game.state.child.input.bindings['key?']('KeyW')), true);
      // Clicking Source clears held game keys; typing there never reaches the game.
      const sourcePoint = await page.evaluate(() => {
        const b = App.exec(editorApp, 'source-node').bounds;
        return { x: b.x + b.z / 2, y: b.y + b.w / 2 };
      });
      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      assert.equal(await page.evaluate(() => game.state.child.input.bindings['key?']('KeyW')), false);
      await page.keyboard.up('w');
      await page.keyboard.press('a');
      assert.equal(await page.evaluate(() => game.state.child.state.code), 'KeyW');
      // Right-button drags remain with the game outside the viewport.
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: 'left' });
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(sourcePoint.x, sourcePoint.y);
      await page.mouse.up({ button: 'left' });
      assert.equal(await page.evaluate(() => game.state.child.state.move.inside), false);
      assert.equal(await page.evaluate(() => game.state.child.input.bindings['pointer?'](2)), true);
      await page.mouse.up({ button: 'right' });
      assert.equal(await page.evaluate(() => game.state.child.input.bindings['pointer?'](2)), false);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await page.evaluate(() => game.state.child.input.bindings.pointer()), null);

      // Failed recompilation retains the working game and keeps the editor usable.
      await page.evaluate(async () => {
        await App.exec(editorApp, '(fs-write-text "/project/main.lisp" "(broken" nil)');
        await App.exec(editorApp, '(Game.reload desktop game-node false)');
      });
      assert.deepEqual(await page.evaluate(() => [!!game.state.error, !!game.state.child.scene, editorApp.failed,
        document.querySelector('#host-error').hidden]), [true, true, false, true]);
      await page.evaluate(async source => {
        await App.exec(editorApp, `(fs-write-text "/project/main.lisp" ${JSON.stringify(source)} nil)`);
        await App.exec(editorApp, '(Game.reload desktop game-node false)');
      }, interactive);
      assert.deepEqual(await page.evaluate(() => [game.state.error, game.state.child.state.loads]), ['', 3]);

      // Runtime callback failures stop only the game and a successful reload recovers it.
      await page.evaluate(() => {
        game.state.child.scene.update = () => { throw new Error('Game update failed'); };
      });
      await page.waitForFunction(() => game.state.child.failed && game.state.error);
      assert.deepEqual(await page.evaluate(() => [editorApp.failed, document.querySelector('#host-error').hidden]), [false, true]);
      await page.evaluate(() => App.exec(editorApp, '(Game.reload desktop game-node false)'));
      assert.deepEqual(await page.evaluate(() => [game.state.child.failed, game.state.error]), [false, '']);

      await page.evaluate(() => {
        const child = game.state.child;
        child.scene.resize = () => { throw new Error('Game resize failed'); };
        child.display.bindings.configure({ w: null, h: null });
        App.resize(child, child.view.outerWidth + 1, child.view.outerHeight);
      });
      assert.deepEqual(await page.evaluate(() => [game.state.child.failed, editorApp.failed]), [true, false]);
      await page.evaluate(() => App.exec(editorApp, '(Game.reload desktop game-node false)'));
      assert.deepEqual(await page.evaluate(() => [game.state.child.failed, game.state.error]), [false, '']);

      const pausePoint = () => page.evaluate(() => {
        const b = game.state['pause-label'].bounds;
        return { x: b.x + b.z / 2, y: b.y + b.w / 2 };
      });
      let control = await pausePoint();
      await page.mouse.click(control.x, control.y);
      await page.waitForFunction(() => game.state.child.paused);
      control = await pausePoint();
      await page.mouse.click(control.x, control.y);
      await page.waitForFunction(() => !game.state.child.paused);

      await page.evaluate(() => App.exec(editorApp, '(ui-pane-minimize desktop game-pane)'));
      await page.waitForFunction(() => game.state.child.hidden);
      const stopped = await page.evaluate(() => game.state.child.outputRevision);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => game.state.child.outputRevision), stopped);
      await page.evaluate(() => App.exec(editorApp, '(ui-pane-restore desktop game-pane)'));
      await page.waitForFunction(() => !game.state.child.hidden && game.state.child.outputRevision > 0);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForFunction(() => {
        const c = game.state.child, b = game.state.view.bounds;
        const scale = App.exec(editorApp, 'desktop').scale;
        return c.display.outerCanvas.width === Math.max(1, Math.trunc(b.z * scale)) && c.view.w === 160;
      });

      await page.evaluate(async () => {
        window.oldChild = game.state.child;
        await App.exec(editorApp, '(Game.reload desktop game-node true)');
      });
      assert.deepEqual(await page.evaluate(() => [oldChild.destroyed, oldChild.output,
        game.state.child.state.loads, editorApp.state.project === game.state.child.state,
        editorApp.__children__.size, editorApp.failed]), [true, null, 1, true, 1, false]);
      await page.evaluate(() => {
        window.closedChild = game.state.child;
        App.exec(editorApp, '(ui-pane-close desktop game-pane)');
      });
      assert.deepEqual(await page.evaluate(() => [closedChild.destroyed, editorApp.__children__.size]), [true, 0]);
      await page.evaluate(() => App.exec(editorApp, '(ui-pane-open desktop game-pane)'));
      await page.waitForFunction(() => game.state.child?.scene && !game.state.loading);
      assert.equal(await page.evaluate(() => editorApp.__children__.size), 1);
      await page.evaluate(async () => {
        window.beforeReload = game.state.child;
        await App.reloadModules(editorApp);
        window.game = App.exec(editorApp, 'game-node');
      });
      await page.waitForFunction(() => game.state.child?.scene && !game.state.loading);
      assert.deepEqual(await page.evaluate(() => [beforeReload.destroyed, editorApp.__children__.size,
        editorApp.failed, game.state.error]), [true, 1, false, '']);
      await page.evaluate(() => { window.lastChild = game.state.child; App.dispose(editorApp); });
      assert.deepEqual(await page.evaluate(() => [lastChild.destroyed, lastChild.output]), [true, null]);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
