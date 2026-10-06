import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

test('real WebGPU gradients, cached shaders, uniforms, and automatic presentation', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000');
    await page.waitForFunction(() => !document.getElementById('run').disabled || document.getElementById('error').textContent);
    assert.equal(await page.locator('#error').textContent(), '');
    await page.locator('#run').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#error').textContent(), '');
    await page.evaluate(async () => {
      const { Aioli, formatDiagnostic } = await import('./aioli.js');
      const make = id => {
        const canvas = document.createElement('canvas');
        canvas.id = id; canvas.width = 64; canvas.height = 48;
        document.body.append(canvas); return canvas;
      };
      const errors = [];
      const options = { onError: e => errors.push(formatDiagnostic(e)), bindings: { print() {} } };
      const a = new Aioli(options), b = new Aioli(options);
      await a.attach(make('test-gradient')); await b.attach(make('test-uniform'));
      a.setScene('(on render (context) ((sh () (let gradient (fn (uv:vec2) (return (vec4 uv 0 1)))) (return (gradient (/ p (vec2 w h))))) context))');
      const state = { a, b, errors, gain: 0.2 };
      b.bindings.level = () => state.gain;
      b.setScene('(let fill (sh (gain:float) (let color (fn () (let red (fn (x:float) (set x (* x 2)) (return x))) (return (vec4 (red (/ gain 2)) 0 0 1)))) (return (color)))) (on render (context) (fill context 0.1) (fill context (level)) (print "after"))', { debug: false });
      globalThis.shaderTest = state;
    });
    const pixel = async (id, x, y) => {
      const image = PNG.sync.read(await page.locator(id).screenshot());
      return [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
    };
    const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= 2, `${actual} != ${expected}`));
    await page.waitForTimeout(200);
    near(await pixel('#test-gradient', 32, 24), [129, 130, 0, 255]);
    near(await pixel('#test-uniform', 32, 24), [51, 0, 0, 255]);
    assert.deepEqual(await page.evaluate(() => [shaderTest.a.graphics.stats.shaderCompilations, shaderTest.b.graphics.stats.shaderCompilations]), [1, 1]);
    await page.evaluate(() => { shaderTest.gain = 0.8; });
    await page.waitForTimeout(100);
    near(await pixel('#test-uniform', 32, 24), [204, 0, 0, 255]);
    await page.evaluate(() => {
      const canvas = document.getElementById('test-gradient'); canvas.width = 96; canvas.height = 32;
    });
    await page.waitForTimeout(100);
    near(await pixel('#test-gradient', 48, 16), [129, 131, 0, 255]);
    assert.deepEqual(await page.evaluate(() => [shaderTest.a.graphics.stats.shaderCompilations, shaderTest.b.graphics.stats.shaderCompilations]), [1, 1]);
    await page.evaluate(() => { shaderTest.gain = 'bad'; });
    await page.waitForTimeout(100);
    near(await pixel('#test-uniform', 32, 24), [204, 0, 0, 255]);
    const errors = await page.evaluate(() => shaderTest.errors);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /parameter gain: expected float/);
    assert.doesNotMatch(errors[0], /source:1:/); // Fast mode keeps native runtime errors.
    await page.evaluate(() => {
      shaderTest.a.setScene('(on render (context) ((sh (gain:float) (return (vec4 gain 0 0 1))) context "bad"))');
    });
    await page.waitForTimeout(100);
    const diagnosticErrors = await page.evaluate(() => shaderTest.errors);
    assert.equal(diagnosticErrors.length, 2);
    assert.match(diagnosticErrors[1], /source:1:/);
    await page.evaluate(() => {
      shaderTest.a.setScene('(on render ())');
    });
    await page.waitForTimeout(100);
    near(await pixel('#test-gradient', 48, 16), [129, 131, 0, 255]);
    await page.evaluate(() => { shaderTest.a.destroy(); shaderTest.b.destroy(); });
  } finally { await browser.close(); }
});

test('typed texture/vector parameters compose GPU passes and reject stale or foreign resources', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000');
    await page.waitForFunction(() => !document.getElementById('run').disabled || document.getElementById('error').textContent);
    await page.evaluate(async () => {
      const { Aioli, formatDiagnostic } = await import('./aioli.js');
      const make = id => { const c = document.createElement('canvas'); c.id = id; c.width = 32; c.height = 24; document.body.append(c); return c; };
      const state = { errors: [], saved: null };
      const options = { onError: error => state.errors.push(formatDiagnostic(error)) };
      state.a = new Aioli({ ...options, bindings: { remember: image => { state.saved = image; return image; } } });
      state.b = new Aioli(options);
      await state.a.attach(make('test-composition')); await state.b.attach(make('test-foreign'));
      state.a.setScene(`
        (let gradient (sh () (return (vec4 (/ p (vec2 w h)) 0.4 1))))
        (let tint (sh (image:texture2d color:vec4)
          (let apply (fn (input:texture2d shade:vec4)
            (return (* (sample input (/ p (vec2 w h))) shade))))
          (return (apply image color))))
        (let composite (fn (context image:texture2d)
          (return (tint context image (vec4 0.5 1 0.25 1)))))
        (on render (context) (composite context (remember (gradient context))))
      `);
      globalThis.resourceTest = state;
    });
    await page.waitForTimeout(200);
    const pixel = async () => {
      const image = PNG.sync.read(await page.locator('#test-composition').screenshot());
      const offset = (12 * image.width + 16) * 4;
      return [...image.data.subarray(offset, offset + 4)];
    };
    const expected = await pixel();
    [66, 133, 26, 255].forEach((value, i) => assert.ok(Math.abs(expected[i] - value) <= 2));
    assert.equal(await page.evaluate(() => resourceTest.a.graphics.stats.shaderCompilations), 2);
    assert.deepEqual(await page.evaluate(() => resourceTest.errors), []);
    await page.evaluate(() => {
      resourceTest.a.player.stop();
      const old = resourceTest.saved;
      resourceTest.a.bindings.previous = () => old;
      resourceTest.b.bindings.previous = () => old;
      const source = '(let copy (sh (image:texture2d) (return (sample image (/ p (vec2 w h)))))) (on render (context) (copy context (previous)))';
      resourceTest.b.setScene(source);
      resourceTest.a.setScene(source);
    });
    await page.waitForTimeout(100);
    const errors = await page.evaluate(() => resourceTest.errors);
    assert.equal(errors.length, 2);
    for (const error of errors) {
      assert.match(error, /texture must come from this runtime's current frame/);
      assert.match(error, /source:1:/);
    }
    assert.deepEqual(await pixel(), expected);
    await page.evaluate(() => { resourceTest.a.destroy(); resourceTest.b.destroy(); });
  } finally { await browser.close(); }
});
