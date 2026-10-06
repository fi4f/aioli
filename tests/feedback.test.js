import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lisp.js';
import { engineServices } from '../engine-services.js';
import { drawApplication } from '../application.js';
import { GPUHost } from '../gpu.js';

test('previous-pixel returns a typed RGBA value with local component access', () => {
  const runtime = engineServices().create({});
  runtime.load(
    parse(
      '(defdraw render [] (pixels [p time] (let [color (previous-pixel p)] (rgba color.x color.y color.z color.w))))',
    ),
  );
  const shader = runtime.drawFrame().commands[0].pixel.shader;
  assert.equal(shader.usesPrevious, true);
  assert.match(shader.pixelBody, /previousPixel\(d\.p, u\.data\[0\]\.yz\)/);
  for (const call of ['(previous-pixel)', '(previous-pixel p p)', '(previous-pixel 1)']) {
    runtime.load(parse(`(defdraw render [] (pixels [p time] ${call}))`));
    assert.throws(() => runtime.drawFrame(), /previous-pixel|vec2f/);
  }
  runtime.load(parse('(defdraw render [] (pixels [p time] (rgb 1 0 0)))'));
  assert.equal(runtime.drawFrame().commands[0].pixel.shader.usesPrevious, false);
  assert.throws(() => runtime.evaluate(parse('(previous-pixel [0 0])')[0]), /Unknown symbol/);
});

test('canvas identities persist across frames, isolate instances and follow the active scene', () => {
  const root = engineServices().create({}),
    scene = engineServices().create({});
  for (const runtime of [root, scene])
    runtime.load(parse('(defdraw render [] (pixels [p time] (previous-pixel p)))'));
  const first = root.drawFrame(),
    second = root.drawFrame();
  assert.equal(first.historyKey, second.historyKey);
  assert.notEqual(first.historyKey, scene.drawFrame().historyKey);
  assert.equal(
    drawApplication({ runtime: root, scene: { runtime: scene } }, [64, 48]).historyKey,
    scene,
  );
  assert.equal(drawApplication({ runtime: root }, [64, 48]).historyKey, root);
  assert.equal(Object.keys(first).includes('historyKey'), false);
  assert.equal(Object.keys(first).includes('historyAdvance'), false);
});

test('history cache bounds GPU allocations, protects active frames and keeps snapshots read-only', () => {
  const savedUsage = globalThis.GPUTextureUsage;
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
  try {
    const renderer = {
      histories: new Map(),
      device: {
        createTexture: () => ({
          destroyed: false,
          destroy() {
            this.destroyed = true;
          },
        }),
      },
    };
    const metrics = { width: 64, height: 48 },
      owners = Array.from({ length: 17 }, () => ({}));
    const frame = { advance: true, pending: new Map() };
    const list = (owner) => ({ width: 64, height: 48, historyKey: owner });
    const history = (owner, context = frame, size = metrics) =>
      GPUHost.prototype.historyFor.call(renderer, list(owner), size, 'rgba8unorm', context);
    assert.equal(history(owners[0], { advance: false }), null);
    const entries = owners.slice(0, 16).map((owner) => history(owner));
    history(owners[0]); // Recently used canvases survive eviction.
    history(owners[16]);
    assert.equal(renderer.histories.size, 16);
    assert.equal(entries[0].texture.destroyed, false);
    assert.equal(entries[1].texture.destroyed, true);
    assert.equal(entries[1].next.destroyed, true);
    const before = [...renderer.histories.keys()];
    assert.equal(history(owners[0], { advance: false }), entries[0]);
    assert.deepEqual([...renderer.histories.keys()], before);
    const active = {
      advance: true,
      pending: new Map(before.map((owner) => [owner, renderer.histories.get(owner)])),
    };
    assert.throws(() => history({}, active), /Maximum 16 feedback canvases/);
    assert.throws(
      () => history(owners[0], active, { width: 32, height: 24 }),
      /dimensions changed within one frame/,
    );
    assert.equal(entries[0].texture.destroyed, false);
  } finally {
    if (savedUsage === undefined) delete globalThis.GPUTextureUsage;
    else globalThis.GPUTextureUsage = savedUsage;
  }
});
