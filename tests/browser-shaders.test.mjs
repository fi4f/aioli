import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

test('blend handles translucent backgrounds, transparent colors, and automatic before sampling with text', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'blend-test'; canvas.width = 80; canvas.height = 40;
      document.body.append(canvas);
      const errors = [], runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas); globalThis.blendTest = { runtime, errors };
      const draw = runtime.run('(sh () (return (blend (vec4 1 0 0 0.5))))');
      runtime.graphics.render(context => draw(context));
    });
    const check = async expected => {
      await page.waitForTimeout(90);
      assert.deepEqual(await page.evaluate(() => blendTest.errors), []);
      const image = PNG.sync.read(await page.locator('#blend-test').screenshot());
      const pixel = [...image.data.subarray(0,4)];
      expected.forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 1, `${pixel} != ${expected}`));
    };
    await check([128,0,0,255]);
    await page.evaluate(() => {
      blendTest.runtime.graphics.bindings.clear(0,0,1);
      const draw = blendTest.runtime.run('(sh () (let apply (fn (color:vec4) (return (blend color)))) (return (apply (vec4 1 0 0 0.5))))');
      blendTest.runtime.graphics.render(context => draw(context));
    });
    await check([128,0,128,255]);
    await page.evaluate(() => {
      const draw = blendTest.runtime.run('(sh () (let color (blend (vec4 1 0 0 0.5) (vec4 0 0 1 0.25))) (return (vec4 color.x color.z color.w 1)))');
      blendTest.runtime.graphics.render(context => draw(context));
    });
    await check([204,51,159,255]);
    await page.evaluate(() => {
      const draw = blendTest.runtime.run('(sh () (let color (blend (vec4 1 0 0 0) (vec4 0 1 0 0))) (return (vec4 color.xyz 1)))');
      blendTest.runtime.graphics.render(context => draw(context));
    });
    await check([0,0,0,255]);
    await page.evaluate(() => {
      blendTest.runtime.graphics.bindings.clear(0,0,1);
      const draw = blendTest.runtime.run(`(sh ()
        (let label (text (font "monospace") (size 24) (color (vec4 1 0 0 0.5)) (span "M")))
        (let uv (/ xy (vec2 label.w label.h)))
        (return (blend (sample label uv))))`);
      blendTest.runtime.graphics.render(context => draw(context));
    });
    await page.waitForTimeout(90);
    assert.deepEqual(await page.evaluate(() => blendTest.errors), []);
    const image = PNG.sync.read(await page.locator('#blend-test').screenshot());
    let blended = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const [r,g,b] = image.data.subarray(i,i+3);
      assert.ok(g < 2 && r <= 130 && Math.abs(r+b-255) <= 2, `text blend ${r},${g},${b}`);
      if (r > 100) blended++;
    }
    assert.ok(blended > 10);
    await page.evaluate(() => blendTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('context before supplies stable last-frame feedback, black initialization, rollback, and resize reset', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const { get } = await import(new URL('/engine/data.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'before-test'; canvas.width = 4; canvas.height = 3;
      document.body.append(canvas);
      const errors = [], runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      const draw = runtime.run(`(sh (gain:f32)
        (let empty (text)) (let unused (sample empty uv))
        (let read (fn () (return (sample before uv)))) (let image (read))
        (return (vec4 (+ image.x gain) (+ image.y (* gain 2)) (+ (* image.w 0.2) unused.x) 1)))`);
      const copy = runtime.run('(sh () (return (sample before uv)))');
      const explicit = runtime.run('(sh (image:texture2d) (return (sample image uv)))');
      globalThis.beforeTest = { runtime, errors, draw, copy, explicit, get, saved: null };
      runtime.graphics.render(context => { beforeTest.saved = get(context, 'before'); draw(context, 0.2); });
    });
    const check = async expected => {
      await page.waitForTimeout(80);
      assert.deepEqual(await page.evaluate(() => beforeTest.errors), []);
      const image = PNG.sync.read(await page.locator('#before-test').screenshot());
      for (let i = 0; i < image.data.length; i += 4) expected.forEach((value, channel) =>
        assert.ok(Math.abs(image.data[i + channel] - value) <= 2, `pixel ${[...image.data.subarray(i, i+4)]}, expected ${expected}`));
    };
    await check([51,102,51,255]);
    await page.evaluate(() => beforeTest.runtime.graphics.render(context => beforeTest.draw(context, 0.2)));
    await check([102,204,51,255]);
    // Both the automatic input and context.before remain the incoming surface,
    // even after another pass has drawn during this callback.
    await page.evaluate(() => beforeTest.runtime.graphics.render(context => {
      beforeTest.draw(context, 0.2); beforeTest.copy(context);
      beforeTest.explicit(context, beforeTest.get(context, 'before'));
    }));
    await check([102,204,51,255]);
    const rejected = await page.evaluate(() => {
      let stale = false, failed = false;
      try { beforeTest.runtime.graphics.render(context => beforeTest.explicit(context, beforeTest.saved)); }
      catch (error) { stale = /current frame/.test(error.message); }
      try { beforeTest.runtime.graphics.render(context => { beforeTest.draw(context, 0.2); throw new Error('rollback'); }); }
      catch (error) { failed = error.message === 'rollback'; }
      return { stale, failed };
    });
    assert.deepEqual(rejected, { stale: true, failed: true });
    await check([102,204,51,255]);
    await page.evaluate(() => beforeTest.runtime.graphics.render(context => beforeTest.draw(context, 0.2)));
    await check([153,255,51,255]);
    await page.evaluate(() => {
      const canvas = document.getElementById('before-test'); canvas.width = 8; canvas.height = 6;
      beforeTest.runtime.graphics.render(context => beforeTest.draw(context, 0.2));
    });
    await check([51,102,51,255]);
    await page.evaluate(() => beforeTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('automatic pixel, UV, and dimension inputs work in helpers and selectors after resizing', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'coordinates-test'; canvas.width = 4; canvas.height = 2;
      document.body.append(canvas);
      const errors = [], runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`(let draw (sh ()
        (let read (fn ()
          (let selected (or (- x x) u))
          (return (vec4 (/ (+ uv (vec2 selected v) (/ xy wh) (/ (vec2 x y) (vec2 w h))) 4)
            (/ (+ wh.x wh.y) 16) 1))))
        (return (read)))) (on render (context) (draw context))`);
      globalThis.coordinatesTest = { runtime, errors };
    });
    for (const [width, height] of [[4, 2], [8, 4]]) {
      await page.evaluate(({ width, height }) => {
        const canvas = document.getElementById('coordinates-test'); canvas.width = width; canvas.height = height;
      }, { width, height });
      await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(() => coordinatesTest.errors), []);
      const image = PNG.sync.read(await page.locator('#coordinates-test').screenshot());
      assert.equal(image.width, width); assert.equal(image.height, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const pixel = [...image.data.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];
        const expected = [(x + 0.5) / width * 255, (y + 0.5) / height * 255, (width + height) / 16 * 255, 255];
        expected.forEach((value, i) => assert.ok(Math.abs(pixel[i] - Math.round(value)) <= 1, `${width}x${height}, ${x},${y}: ${pixel}`));
      }
    }
    assert.equal(await page.evaluate(() => coordinatesTest.runtime.graphics.stats.shaderCompilations), 1);
    await page.evaluate(() => coordinatesTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('shader text hoists named and inline resources alongside explicit texture, storage, and numeric inputs', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    const metadata = await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'shader-text'; canvas.width = 80; canvas.height = 48;
      document.body.append(canvas);
      const errors = [], builds = [];
      const runtime = new Aioli({ bindings: { record: value => builds.push(value) }, onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      const program = runtime.compileScene(`(let name "M") (let items (array (f32) 1))
        (let background (sh () (return (vec4 0 0 0.1 1))))
        (let draw (sh (image:texture2d items:array<f32> gain:f32)
          (let label (text (font "monospace") (size 24) (color (vec3 1 0 0)) (record "named") (span name)))
          (let alias label)
          (let read (fn () (return (sample alias (/ (- xy (vec2 4 4)) (vec2 label.w label.h))))))
          (let red (read))
          (let green (sample (text (font "monospace") (size 24) (color (vec3 0 1 0)) (record "inline") (span "M"))
            (/ (- xy (vec2 36 4)) (vec2 24 32))))
          (let base (sample image (/ xy (vec2 w h))))
          (return (vec4 (+ (* (+ (* red.xyz red.w) (* green.xyz green.w)) (* items.0 gain)) base.xyz) 1))))
        (set name "Changed")
        (on render (context) (draw context (background context) items 1))`);
      runtime.activate(program);
      globalThis.shaderTextTest = { runtime, errors, builds };
      return { resources: program.shaders[1].resources.length, parameters: program.shaders[1].parameterCount,
        rasterizations: runtime.graphics.stats.textRasterizations };
    });
    assert.deepEqual(metadata, { resources: 4, parameters: 3, rasterizations: 2 });
    await page.waitForTimeout(180);
    assert.deepEqual(await page.evaluate(() => shaderTextTest.errors), []);
    assert.deepEqual(await page.evaluate(() => shaderTextTest.builds), ['named', 'inline']);
    const image = PNG.sync.read(await page.locator('#shader-text').screenshot());
    let red = 0, green = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const [r,g,b] = image.data.subarray(i, i + 3);
      if (r > 150 && g < 20 && b < 40) red++;
      if (g > 150 && r < 20 && b < 40) green++;
    }
    assert.ok(red > 10 && green > 10, `red=${red}, green=${green}`);
    assert.equal(await page.evaluate(() => shaderTextTest.runtime.graphics.stats.textRasterizations), 2);
    await page.evaluate(() => shaderTextTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('immediate text renders multicolor lines through persistent cached textures', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    const metrics = await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const { get, put } = await import(new URL('/engine/data.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'text-test'; canvas.width = 100; canvas.height = 100;
      document.body.append(canvas);
      const errors = [], runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      const source = `(text (font "monospace") (size 24) (line-height 30)
        (span "M") (if true { (color (vec3 1 0 0)) (span "M") })
        (line) (color (vec3 0 1 0)) (span "M"))`;
      const label = runtime.run(source), cached = runtime.run(source);
      const sameTexture = get(label, 'texture') === get(cached, 'texture');
      put(get(cached, 'origin'), 'x', 1000);
      const freshOrigin = get(get(runtime.run(source), 'origin'), 'x');
      const wrapped = runtime.run('(text (font "monospace") (size 16) (width 55) (span "hello world") (line) (line))');
      const blank = runtime.run('(text)');
      runtime.bindings.label = label;
      runtime.setScene(`(let draw (sh (image:texture2d dimensions:vec2)
        (let pixel (sample image (/ xy dimensions)))
        (return (vec4 (* pixel.xyz pixel.w) 1))))
        (on render (context) (draw context label.texture (vec2 label.w label.h)))`);
      canvas.width = get(label, 'w'); canvas.height = get(label, 'h');
      globalThis.textTest = { runtime, errors, label };
      return { sameTexture, rasterizations: runtime.graphics.stats.textRasterizations, freshOrigin,
        w: get(label, 'w'), h: get(label, 'h'), lines: get(label, 'lines'), wrappedLines: get(wrapped, 'lines'), blankW: get(blank, 'w') };
    });
    assert.equal(metrics.sameTexture, true); assert.equal(metrics.rasterizations, 3);
    assert.equal(metrics.freshOrigin, 1); assert.equal(metrics.lines, 2); assert.equal(metrics.wrappedLines, 4);
    assert.ok(metrics.w > 20 && metrics.h > 30 && metrics.blankW > 0);
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => textTest.errors), []);
    const image = PNG.sync.read(await page.locator('#text-test').screenshot());
    let red = 0, green = 0, white = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const [r,g,b] = image.data.subarray(i, i + 3);
      if (r > 150 && g < 20 && b < 20) red++;
      if (g > 150 && r < 20 && b < 20) green++;
      if (r > 150 && g > 150 && b > 150) white++;
    }
    assert.ok(red > 10 && green > 10 && white > 10, `red=${red}, green=${green}, white=${white}`);
    const ownership = await page.evaluate(async () => {
      const { Aioli } = await import(new URL('/aioli.js', location.href).href);
      const { get } = await import(new URL('/engine/data.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
      const other = new Aioli(); await other.attach(canvas);
      const shader = other.run('(sh (image:texture2d) (return (sample image (vec2 0.5))))');
      let rejected = false;
      try { other.graphics.render(context => shader(context, get(textTest.label, 'texture'))); }
      catch (error) { rejected = /this runtime/.test(error.message); }
      finally { other.destroy(); }
      // Cache eviction does not invalidate a texture still owned by a label.
      for (let i = 0; i < 130; i++) textTest.runtime.run(`(text (span "${i}"))`);
      return rejected;
    });
    assert.equal(ownership, true);
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => textTest.errors), []);
    await page.evaluate(() => textTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('2d and 3d transforms agree across CPU matrices, shader helpers, and skew array inputs', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'transform-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [], runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      globalThis.transformTest = { runtime, errors };
    });
    const cases = [
      ['2d', '', '', '(vec3 0.2 0.3 1)'],
      ['2d', 'position (vec2 0.1 0.2) scale 0.5 rotation 0.3 skew (vec2 0.1 -0.2)', '', '(vec3 0.2 0.3 1)'],
      ['2d', 'scale (vec2 0.2 -0.3) position (vec2 0.4 0.5) rotation 1.2', '', '(vec3 0.1 0.2 0)'],
      ['3d', '', '', '(vec4 0.2 0.3 0.4 1)'],
      ['3d', 'rotation (vec3 0.1 0.2 0.3) scale (vec3 0.3 0.4 0.5) position (vec3 0.1 0.2 0.3) skew skews', '0.1 0.2 0.3 -0.1 -0.2 -0.3', '(vec4 0.2 0.3 0.4 1)'],
      ['3d', 'scale 0.5 skew (array (f32 6) 0.2)', '', '(vec4 0.2 0.3 0.4 0)'],
      ...Array.from({ length: 6 }, (_, i) => ['3d', 'skew skews', Array.from({ length: 6 }, (_, j) => i === j ? 0.3 : 0).join(' '), '(vec4 0.2 0.3 0.4 1)']),
    ];
    for (const [name, options, skew, point] of cases) {
      await page.evaluate(({ name, options, skew, point }) => {
        const size = name === '2d' ? 3 : 4;
        transformTest.runtime.setScene(`
          (let skews (array (f32 6) ${skew}))
          (let matrix (${name} ${options})) (let expected (* matrix ${point}))
          (let draw (sh (m:mat${size} expected:vec${size} skews:array<f32,6>)
            (let make (fn () (return (${name} ${options}))))
            (let direct (* (make) ${point})) (let passed (* m ${point}))
            (let delta (- direct expected)) (let delta2 (- passed expected))
            (let error (+ delta delta2))
            (return (vec4 (+ (* ${size === 3 ? '(vec3 error.xy error.z)' : 'error.xyz'} 10) (vec3 0.5)) 1))))
          (on render (context) (draw context matrix expected skews))`);
      }, { name, options, skew, point });
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(() => transformTest.errors), [], `${name} ${options}`);
      const image = PNG.sync.read(await page.locator('#transform-test').screenshot());
      const pixel = [...image.data.subarray(0, 4)];
      [128, 128, 128, 255].forEach((expected, i) => assert.ok(Math.abs(pixel[i] - expected) <= 1, `${name} ${options} skew ${skew}: ${pixel}`));
    }
    await page.evaluate(() => transformTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('WGSL zero, splat, mixed vector, and column/scalar matrix constructors render together', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'constructor-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [], runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`(let draw (sh ()
        (let v (vec4 (vec2 0.25 0.5) 0.75 1))
        (let splat (vec3u 1))
        (let zero (+ (vec4) (vec4f (vec4i)) (vec4f (vec4u))))
        (let m2 (mat2 (vec2 1 0) (vec2 0 1)))
        (let m3 (mat3x3f 1 0 0 0 1 0 0 0 1))
        (let m4 (mat4 (vec4 1 0 0 0) (vec4 0 1 0 0) (vec4 0 0 1 0) (vec4 0 0 0 1)))
        (let z (+ (mat2) (mat2x2f)))
        (let z3 (mat3)) (let z4 (mat4x4f))
        (let xy (* (+ m2 z) v.xy))
        (let rgb (* (+ m3 z3) (vec3f xy v.z)))
        (return (* (+ m4 z4) (+ (vec4 rgb (f32 splat.x)) zero)))))
        (on render (context) (draw context))`);
      globalThis.constructorTest = { runtime, errors };
    });
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => constructorTest.errors), []);
    const image = PNG.sync.read(await page.locator('#constructor-test').screenshot());
    const pixel = [...image.data.subarray(0, 4)];
    [64, 128, 191, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 1, `pixel: ${pixel}`));
    await page.evaluate(() => constructorTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('every f32, i32, and u32 vector dimension crosses uniforms with family-preserving guards and swizzles', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'all-vector-types'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [], runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      globalThis.allVectorTypes = { runtime, errors };
    });
    for (const size of [2, 3, 4]) for (const suffix of ['f', 'i', 'u']) {
      await page.evaluate(({ size, suffix }) => {
        const type = suffix === "f" ? `vec${size}` : `vec${size}${suffix}`, scalar = suffix === 'i' ? 'i32' : 'u32';
        const value = suffix === 'f' ? 0.25 : suffix === 'i' ? 2147483647 : 4294967295;
        const color = suffix === 'f' ? '(* x.x 4)' : `(/ (f32 (% x.x (${scalar} 256))) 255)`;
        allVectorTypes.runtime.setScene(`(let draw (sh (value:${type})
          (let x (${type} value))
          (return (vec4f ${color} (f32 (${type}? x)) (f32 (vec4${suffix}? x.xxxx)) 1))))
          (on render (context) (draw context (${type} ${value})))`);
      }, { size, suffix });
      await page.waitForTimeout(90);
      assert.deepEqual(await page.evaluate(() => allVectorTypes.errors), [], `vec${size}${suffix}`);
      const image = PNG.sync.read(await page.locator('#all-vector-types').screenshot());
      assert.deepEqual([...image.data.subarray(0, 4)], [255, 255, 255, 255], `vec${size}${suffix}`);
    }
    await page.evaluate(() => allVectorTypes.runtime.destroy());
  } finally { await browser.close(); }
});

test('full-width signed and unsigned scalars, vectors, and mixed structs render without f32 precision loss', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'numeric-type-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const state = { errors: [] };
      const runtime = new Aioli({ onError: error => state.errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`
        (struct Item n:i32 u:u32 p:vec3u signed:vec4i matrix:mat3x3f enabled:bool)
        (let rows (many (Item) (Item n -2147483648 u 4294967295
          p (vec3u 16777217 4294967295 1) signed (vec4i -1 -2 -3 -4)
          matrix (mat3x3f 1 0 0 0 1 0 0 0 1) enabled true)))
        (let draw (sh (rows:many<Item> unsigned:u32 i:i32 value:vec4u s:vec3i f:f32)
          (let row rows.0)
          (let converted (vec2i (vec2f -1.9 2.9)))
          (let wrapped (u32 (- f 2)))
          (let overflow (+ (vec2u 4294967295) (vec2u 1)))
          (let sum (+ (u32 4294967295) (u32 1)))
          (let a (- row.u unsigned))
          (let b (- row.n i))
          (let c (- row.p.x (u32 16777216)))
          (let d (+ row.signed.x converted.y))
          (let red (+ (% value.x (u32 256)) a (u32 b)))
          (let green (+ c (% wrapped (u32 256))))
          (let blue (+ d s.x))
          (return (vec4f (/ (f32 red) 255) (/ (f32 green) 256) (/ (f32 blue) 2) (* (f32 row.enabled) (f32 (not (bool overflow.x))) (f32 (not (bool sum))) (f32 (u32? (f32 1))) (f32 (not (f32? (u32 4294967295)))))))))
        (on render (context)
          (draw context rows 4294967295 -2147483648 (vec4u 4294967295) (vec3i 1) (f32 1)))`);
      state.runtime = runtime; globalThis.numericTypeTest = state;
    });
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => numericTypeTest.errors), []);
    const image = PNG.sync.read(await page.locator('#numeric-type-test').screenshot());
    assert.deepEqual([...image.data.subarray(0, 4)], [255, 255, 255, 255]);
    await page.evaluate(() => numericTypeTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('bool fields, nested bool collections, uniforms, and mutation cross WebGPU safely', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const { get, put } = await import(new URL('/engine/data.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'bool-struct-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const state = { errors: [], get, put };
      const runtime = new Aioli({ bindings: { expose: items => { state.items = items; } }, onError: error => state.errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`
        (struct Inner flag:bool vector:vec3f matrix:mat3x3f)
        (struct S nested:Inner flags:array<bool,3> choices:many<bool,3>)
        (let items (array (S)
          (S nested (Inner flag true vector (vec3f 0.25 0.5 0.75) matrix (mat3x3f 1 0 0 0 1 0 0 0 1))
            flags (array (bool 3) false true) choices (many (bool 3) false))))
        (let flags (array (bool) true false))
        (let choices (many (bool) true false))
        (expose items)
        (let draw (sh (items:array<S> flags:array<bool> choices:many<bool> enabled:bool)
          (let s items.0)
          (set s.flags.0 enabled)
          (insert s.choices true)
          (remove s.choices 0)
          (let local (S nested (Inner flag false vector (vec3f 0) matrix (mat3x3f))
            flags (array (bool 3) true) choices (many (bool 3) false)))
          (set local.nested.flag choices.0)
          (if s.nested.flag
            (return (vec4f (f32 s.flags.0) (f32 s.choices.0) (f32 local.nested.flag) 1)))
          (return (vec4f (f32 flags.1) (f32 (get flags 9)) (f32 choices.1) 1))))
        (on render (context) (draw context items flags choices true))`);
      state.runtime = runtime; globalThis.boolStructTest = state;
    });
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => boolStructTest.errors), []);
    let image = PNG.sync.read(await page.locator('#bool-struct-test').screenshot());
    assert.deepEqual([...image.data.subarray(0, 4)], [255, 255, 255, 255]);
    await page.evaluate(() => boolStructTest.put(boolStructTest.get(boolStructTest.get(boolStructTest.items, 0), 'nested'), 'flag', false));
    await page.waitForTimeout(150);
    image = PNG.sync.read(await page.locator('#bool-struct-test').screenshot());
    assert.deepEqual([...image.data.subarray(0, 4)], [0, 0, 0, 255]);
    assert.deepEqual(await page.evaluate(() => boolStructTest.errors), []);
    await page.evaluate(() => boolStructTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('many growth, removal, lengths, and bounded local shader edits render on WebGPU', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const { insert, remove, get } = await import(new URL('/engine/data.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'many-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const state = { errors: [], insert, remove, get };
      const runtime = new Aioli({ bindings: { expose: (values, shapes) => Object.assign(state, { values, shapes }) }, onError: error => state.errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`
        (struct P position:vec3f matrix:mat3x3f)
        (struct S points:many<P,4>)
        (let shapes (many (S 2) (S points (many (P 4) (P position (vec3f 0.2 0.4 0.6) matrix (mat3x3f 1 0 0 0 1 0 0 0 1))))))
        (let values (many (f32) 0.25))
        (expose values shapes)
        (let draw (sh (values:many<f32> shapes:many<S,2>)
          (let s shapes.0)
          (insert s.points (P position (vec3f 0.5) matrix (mat3x3f 1 0 0 0 1 0 0 0 1)))
          (remove s.points 0)
          (set s.points.0.position.y 0.75)
          (return (vec4f values.0 s.points.0.position.y (/ (len values) (cap values)) (* (f32 (bool s.points)) (/ (cap s.points) 4))))))
        (on render (context) (draw context values shapes))`);
      state.runtime = runtime; globalThis.manyTest = state;
    });
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => manyTest.errors), []);
    let image = PNG.sync.read(await page.locator('#many-test').screenshot());
    let pixel = [...image.data.subarray(0, 4)];
    [64, 191, 255, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `pixel: ${pixel}`));
    await page.evaluate(() => {
      manyTest.insert(manyTest.values, 0.5); manyTest.insert(manyTest.values, 0.75);
      manyTest.remove(manyTest.values, 0);
    });
    await page.waitForTimeout(150);
    image = PNG.sync.read(await page.locator('#many-test').screenshot());
    pixel = [...image.data.subarray(0, 4)];
    [128, 191, 128, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `updated pixel: ${pixel}`));
    assert.deepEqual(await page.evaluate(() => manyTest.errors), []);
    await page.evaluate(() => manyTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('bounded arrays nested in structs render padding, lengths, local writes, and updated field uploads', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const { get, put } = await import(new URL('/engine/data.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'array-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const state = { errors: [], get, put };
      const runtime = new Aioli({ bindings: { expose: shape => { state.shape = shape; } }, onError: error => state.errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`
        (struct Point position:vec3f transform:mat3x3f)
        (struct Shape points:array<Point,2> weights:array<f32,4> grid:array<array<f32,2>,2>)
        (let shape (Shape
          points (array (Point 2) (Point position (vec3f 0.2 0.3 0.4) transform (mat3x3f 1 0 0 0 1 0 0 0 1)))
          weights (array (f32 4) 0.75)
          grid (array (array<f32,2> 2) (array (f32 2) 0.1 0.2))))
        (expose shape)
        (let shapes (array (Shape 2) shape))
        (let draw (sh (shapes:array<Shape,2> weights:array<f32,4>)
          (let local shapes.0)
          (set local.points.0.position.y 0.5)
          (set local.grid.0.0 0.2)
          (let alpha (array (f32 2) 1))
          (let first (fn (a:array<f32,2>) (return a.0)))
          (return (vec4f local.grid.0.0 local.points.0.position.y weights.0 (* (/ (len local.points) 2) (first alpha) (f32 (bool local.grid)))))))
        (on render (context) (draw context shapes shape.weights))`);
      state.runtime = runtime; globalThis.arrayTest = state;
    });
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => arrayTest.errors), []);
    let image = PNG.sync.read(await page.locator('#array-test').screenshot());
    let pixel = [...image.data.subarray(0, 4)];
    [51, 128, 191, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `pixel: ${pixel}`));
    await page.evaluate(() => arrayTest.put(arrayTest.get(arrayTest.shape, 'weights'), 0, 0.4));
    await page.waitForTimeout(100);
    image = PNG.sync.read(await page.locator('#array-test').screenshot());
    pixel = [...image.data.subarray(0, 4)];
    [51, 128, 102, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `updated pixel: ${pixel}`));
    assert.deepEqual(await page.evaluate(() => arrayTest.errors), []);
    await page.evaluate(() => arrayTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('shader if elif else renders scoped branches, early returns, and optional fallbacks', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'conditional-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const state = { mode: 0, errors: [] };
      const runtime = new Aioli({ bindings: { mode: () => state.mode }, onError: error => state.errors.push(error.message) });
      await runtime.attach(canvas);
      runtime.setScene(`(let draw (sh (mode:f32)
        (let gain (fn (enabled:bool)
          (if enabled (return 1) else (return 0.5))))
        (let color (vec4f 0 0 1 1))
        (if mode (set color (vec4f 1 0 0 1))
          elif (% (- xy.x 0.5) 2) (return (vec4f 0 1 0 1))
          else { (let color (vec4f 0 0 1 1)) (return color) })
        (if false (return (vec4f 0)))
        (return (* color (gain true)))))
        (on render (context) (draw context (mode)))`);
      state.runtime = runtime; globalThis.conditionalTest = state;
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => conditionalTest.errors), []);
    const pixels = async () => PNG.sync.read(await page.locator('#conditional-test').screenshot());
    let image = await pixels();
    assert.deepEqual([...image.data.subarray(0, 4)], [0, 0, 255, 255]);
    assert.deepEqual([...image.data.subarray(4, 8)], [0, 255, 0, 255]);
    await page.evaluate(() => { conditionalTest.mode = 1; });
    await page.waitForTimeout(100);
    image = await pixels();
    assert.deepEqual([...image.data.subarray(0, 8)], [255, 0, 0, 255, 255, 0, 0, 255]);
    assert.deepEqual(await page.evaluate(() => conditionalTest.errors), []);
    assert.equal(await page.evaluate(() => conditionalTest.runtime.graphics.stats.shaderCompilations), 1);
    await page.evaluate(() => conditionalTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('numeric vector and matrix dot reads and writes render on real WebGPU', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.id = 'matrix-index-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [];
      const runtime = new Aioli({ onError: error => errors.push(error.message) });
      await runtime.attach(canvas);
      runtime.setScene(`(struct Example transform:mat2x2f)
        (let data (array (Example 1) (Example transform (mat2x2f))))
        (set data.0.transform.0 (vec2f 0.2 0.4))
        (set data.0.transform.1.0 0.6)
        (on render (context)
          ((sh (data:array<Example>)
            (let row (get data 0))
            (set row.transform.0.1 0.5)
            (let v (vec4f 0))
            (set v.0 row.transform.0.0)
            (set v.1 row.transform.0.1)
            (set v.2 row.transform.1.x)
            (set v.3 1)
            (return v)) context data))`);
      globalThis.matrixIndexTest = { runtime, errors };
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => matrixIndexTest.errors), []);
    const image = PNG.sync.read(await page.locator('#matrix-index-test').screenshot());
    const pixel = [...image.data.subarray(0, 4)];
    [51, 128, 153, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `pixel: ${pixel}`));
    await page.evaluate(() => matrixIndexTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('lifecycle context dictionaries expose timing and resized canvas dimensions', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
      document.body.append(canvas);
      const updates = [], renders = [], errors = [];
      const runtime = new Aioli({ bindings: { record: (target, t, dt, w, h) => (target === 'update' ? updates : renders).push({ t, dt, w, h }) }, onError: error => errors.push(error.message) });
      await runtime.attach(canvas);
      runtime.setScene(`(on update (context:dict) (record "update" context.t context.dt context.w context.h))
        (on render (context:dict)
          (record "render" context.t context.dt context.w context.h)
          ((sh () (return (vec4f 0.25 0.5 0.75 1))) context))`);
      globalThis.contextTest = { runtime, canvas, updates, renders, errors };
    });
    await page.waitForFunction(() => contextTest.updates.length >= 2 && contextTest.renders.length >= 2);
    const initial = await page.evaluate(() => ({ updates: contextTest.updates, renders: contextTest.renders, errors: contextTest.errors }));
    assert.deepEqual(initial.errors, []);
    assert.equal(initial.renders[0].t, 0); assert.equal(initial.renders[0].dt, 0);
    assert.equal(initial.updates[0].dt, 1 / 60); assert.equal(initial.updates[0].t, 1 / 60);
    assert.equal(initial.renders[0].w, 32); assert.equal(initial.renders[0].h, 24);
    await page.evaluate(() => { contextTest.canvas.width = 64; contextTest.canvas.height = 48; });
    await page.waitForFunction(() => contextTest.updates.at(-1).w === 64 && contextTest.renders.at(-1).h === 48);
    assert.deepEqual(await page.evaluate(() => contextTest.errors), []);
    await page.evaluate(() => contextTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('struct arrays render quoted fields, dot assignments, and per-call snapshots on real WebGPU', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas');
      canvas.id = 'layout-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [];
      const runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`
        (struct Example "a string key":vec2f gain:f32 matrix:mat3x3f)
        (let points (array (Example 1) (Example "a string key" (vec2f 0) gain 0 matrix (mat3x3f))))
        (put points 0 (Example "a string key" (vec2f 0.2 0.6) gain 1 matrix (mat3x3f 1 0 0 0 1 0 0 0 1)))
        (let draw (sh (points:array<Example>)
          (let row (get points 0))
          (set row."a string key".xy row."a string key".yx)
          (return (vec4f (* row."a string key" (get row "gain")) 0 1))))
        (let blend (sh (a:texture2d b:texture2d)
          (let uv (/ xy (vec2f w h)))
          (return (/ (+ (sample a uv) (sample b uv)) 2))))
        (on render (context)
          (set points.0."a string key" (vec2f 0.2 0.6))
          (let first (draw context points))
          (set points.0."a string key" (vec2f 0.4 0.8))
          (let second (draw context points))
          (blend context first second))`);
      globalThis.structTest = { runtime, errors };
    });
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => structTest.errors), []);
    const image = PNG.sync.read(await page.locator('#layout-test').screenshot());
    const pixel = [...image.data.subarray(0, 4)];
    [179, 77, 0, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `pixel: ${pixel}`));
    assert.equal(await page.evaluate(() => structTest.runtime.graphics.stats.shaderCompilations), 2);
    await page.evaluate(() => structTest.runtime.setScene(`
      (let values (array (f32)))
      (on render (context)
        ((sh (values:array<f32>)
          (return (vec4f (get values 0) (len values) 0.5 1))) context values))`, { trace: false }));
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => structTest.errors), []);
    const emptyImage = PNG.sync.read(await page.locator('#layout-test').screenshot());
    const emptyPixel = [...emptyImage.data.subarray(0, 4)];
    [0, 0, 128, 255].forEach((value, i) => assert.ok(Math.abs(emptyPixel[i] - value) <= 2, `empty buffer pixel: ${emptyPixel}`));
    await page.evaluate(() => structTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('numeric shader selectors render lazy results with captured locals and helper parameters', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas');
      canvas.id = 'selector-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [];
      const runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`(let draw (sh (gain:f32)
        (let choose (fn (value:f32)
          (let local 0.5)
          (return (or value (and local 0.25)))))
        (let red (or 0 gain))
        (let green (choose 0))
        (let color (or (vec4f red green 0.75 1) (vec4f 0)))
        (let transform (and (mat2x2f 1 0 0 1) (mat2x2f 2 0 0 2)))
        (let xy (* transform color.xy))
        (return (vec4f (* xy 0.5) color.zw))))
        (on render (context) (draw context (or nil 0.5)))`);
      globalThis.selectorTest = { runtime, errors };
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => selectorTest.errors), []);
    const image = PNG.sync.read(await page.locator('#selector-test').screenshot());
    const pixel = [...image.data.subarray(0, 4)];
    [128, 64, 191, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `pixel: ${pixel}`));
    await page.evaluate(() => selectorTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('boolean logic and scalar remainder validate and render on real WebGPU', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas');
      canvas.id = 'logical-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [];
      const runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      runtime.setScene(`(let draw (sh (enabled:bool value:f32 divisor:f32)
        (let gate (fn (flag:bool) (return (or flag false))))
        (let ready (and (gate enabled) (or false (not false))
          (bool value) (not (bool 0)) (bool (vec2f 0)) (bool (mat2x2f))))
        (set ready (not ready))
        (let copied (copy (ready : bool)))
        (return (vec4f (/ (% value divisor) 3) (+ (% -7 divisor) 1.5)
          (+ (* (f32 enabled) 0.25) (f32 false)) 1))))
        (on render (context) (draw context (and (bool (dict "active" nil)) (not (bool nil))) 7.5 2))`);
      globalThis.logicalTest = { runtime, errors };
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => logicalTest.errors), []);
    const image = PNG.sync.read(await page.locator('#logical-test').screenshot());
    const pixel = [...image.data.subarray(0, 4)];
    [128, 128, 64, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `pixel: ${pixel}`));
    await page.evaluate(() => logicalTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('all vector swizzles validate in real WebGPU and dot access renders reordered channels', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const canvas = document.createElement('canvas');
      canvas.id = 'swizzle-test'; canvas.width = 16; canvas.height = 16;
      document.body.append(canvas);
      const errors = [];
      const runtime = new Aioli({ onError: error => errors.push(formatTrace(error)) });
      await runtime.attach(canvas);
      const body = [];
      let index = 0;
      for (const size of [2, 3, 4]) {
        body.push(`(let v${size} (vec${size}f ${[0.2, 0.4, 0.6, 1].slice(0, size).join(' ')}))`);
        let names = [''];
        for (let length = 1; length <= 4; length++) {
          names = names.flatMap(prefix => [...'xyzw'.slice(0, size)].map(letter => prefix + letter));
          for (const name of names) body.push(`(let s${index++} v${size}.${name})`);
        }
      }
      runtime.setScene(`(on render (context) ((sh () ${body.join(' ')} (return v4.zyxw)) context))`);
      globalThis.swizzleTest = { runtime, errors };
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => swizzleTest.errors), []);
    const image = PNG.sync.read(await page.locator('#swizzle-test').screenshot());
    const pixel = [...image.data.subarray(0, 4)];
    [153, 102, 51, 255].forEach((value, i) => assert.ok(Math.abs(pixel[i] - value) <= 2, `pixel: ${pixel}`));
    await page.evaluate(() => swizzleTest.runtime.destroy());
  } finally { await browser.close(); }
});

test('mutable square matrices cross into real WebGPU with column padding and cached pipelines', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    for (const dimension of [2, 3, 4]) {
      await page.evaluate(async dimension => {
        const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
        const { matrixBindings } = await import(new URL('/engine/types.js', location.href).href);
        const { put } = await import(new URL('/engine/data.js', location.href).href);
        const canvas = document.createElement('canvas');
        canvas.id = 'matrix-test'; canvas.width = 16; canvas.height = 16;
        document.body.append(canvas);
        const transform = matrixBindings[`mat${dimension}`]();
        put(transform, 0, 0.2); put(transform, 1, 0.1); put(transform, dimension + 1, 0.4);
        const errors = [];
        const runtime = new Aioli({ bindings: { 'matrix-value': () => transform },
          onError: error => errors.push(formatTrace(error)) });
        await runtime.attach(canvas);
        runtime.setScene(`
          (let draw (sh (transform:mat${dimension} tint:vec${dimension}f gain:f32)
            (let make (fn (m:mat${dimension}) (return (* (mat${dimension} ${Array.from({ length: dimension * dimension }, (_, i) => i % (dimension + 1) === 0 ? 1 : 0).join(" ")}) m))))
            (let combined (+ (make (copy transform)) (mat${dimension}x${dimension}f)))
            (let applied (* combined tint))
            (return (vec4f (* applied.x gain) applied.y 0 1))))
          (on render (context) (draw context (matrix-value) (vec${dimension}f 1) 1))`,
        { trace: dimension !== 3 });
        globalThis.matrixTest = { runtime, transform, put, errors, canvas };
      }, dimension);
      const pixels = async () => {
        const image = PNG.sync.read(await page.locator('#matrix-test').screenshot());
        return [...image.data.subarray(0, 4)];
      };
      await page.waitForTimeout(150);
      assert.deepEqual(await page.evaluate(() => matrixTest.errors), []);
      const before = await pixels();
      [51, 128, 0, 255].forEach((value, i) => assert.ok(Math.abs(before[i] - value) <= 2, `mat${dimension}x${dimension}f before: ${before}`));
      await page.evaluate(() => matrixTest.put(matrixTest.transform, 0, 0.6));
      await page.waitForTimeout(100);
      const after = await pixels();
      [153, 128, 0, 255].forEach((value, i) => assert.ok(Math.abs(after[i] - value) <= 2, `mat${dimension}x${dimension}f after: ${after}`));
      assert.equal(await page.evaluate(() => matrixTest.runtime.graphics.stats.shaderCompilations), 1);
      assert.deepEqual(await page.evaluate(() => matrixTest.errors), []);
      await page.evaluate(() => { matrixTest.runtime.destroy(); matrixTest.canvas.remove(); });
    }
  } finally { await browser.close(); }
});

test('real WebGPU gradients, cached shaders, uniforms, and automatic presentation', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.waitForFunction(() => !document.getElementById('run').disabled || document.getElementById('error').textContent);
    assert.equal(await page.locator('#error').textContent(), '');
    await page.locator('#run').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#error').textContent(), '');
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const make = id => {
        const canvas = document.createElement('canvas');
        canvas.id = id; canvas.width = 64; canvas.height = 48;
        document.body.append(canvas); return canvas;
      };
      const errors = [];
      const options = { onError: e => errors.push(formatTrace(e)), bindings: { print() {} } };
      const a = new Aioli(options), b = new Aioli(options);
      await a.attach(make('test-gradient')); await b.attach(make('test-uniform'));
      a.setScene('(on render (context) ((sh () (let gradient (fn (uv:vec2f) (return (vec4f uv 0 1)))) (return (gradient (/ xy (vec2f w h))))) context))');
      const state = { a, b, errors, gain: 0.2 };
      b.bindings.level = () => state.gain;
      b.setScene('(let fill (sh (gain:f32) (let color (fn () (let red (fn (x:f32) (set x (* x 2)) (return x))) (return (vec4f (red (/ gain 2)) 0 0 1)))) (return (color)))) (on render (context) (fill context 0.1) (fill context (level)) (print "after"))', { trace: false });
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
    assert.match(errors[0], /parameter gain: expected f32/);
    assert.doesNotMatch(errors[0], /source:1:/); // Fast mode keeps native runtime errors.
    await page.evaluate(() => {
      shaderTest.a.setScene('(on render (context) ((sh (gain:f32) (return (vec4f gain 0 0 1))) context "bad"))');
    });
    await page.waitForTimeout(100);
    const traceErrors = await page.evaluate(() => shaderTest.errors);
    assert.equal(traceErrors.length, 2);
    assert.match(traceErrors[1], /source:1:/);
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
    await page.goto(process.env.AIOLI_URL || 'http://localhost:3000/index.html');
    await page.waitForFunction(() => !document.getElementById('run').disabled || document.getElementById('error').textContent);
    await page.evaluate(async () => {
      const { Aioli, formatTrace } = await import(new URL('/aioli.js', location.href).href);
      const make = id => { const c = document.createElement('canvas'); c.id = id; c.width = 32; c.height = 24; document.body.append(c); return c; };
      const state = { errors: [], saved: null };
      const options = { onError: error => state.errors.push(formatTrace(error)) };
      state.a = new Aioli({ ...options, bindings: { remember: image => { state.saved = image; return image; } } });
      state.b = new Aioli(options);
      await state.a.attach(make('test-composition')); await state.b.attach(make('test-foreign'));
      state.a.setScene(`
        (let gradient (sh () (return (vec4f (/ xy (vec2f w h)) 0.4 1))))
        (let tint (sh (image:texture2d color:vec4f)
          (let apply (fn (input:texture2d shade:vec4f)
            (return (* (sample input (/ xy (vec2f w h))) shade))))
          (return (apply image color))))
        (let composite (fn (context image:texture2d)
          (return (tint context image (vec4f 0.5 1 0.25 1)))))
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
      const source = '(let copy (sh (image:texture2d) (return (sample image (/ xy (vec2f w h)))))) (on render (context) (copy context (previous)))';
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
