import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lisp.js';
import { gridRayShader } from '../grid-ray.js';
import { compilePixelShader } from '../shader.js';
import { engineServices } from '../engine-services.js';
import { GPUHost } from '../gpu.js';

test('GPU grid ray maps are rectangular, bounded and material digits only', () => {
  for (const rows of [[], [''], ['10', '1'], ['ab'], Array(65).fill('1'), ['1'.repeat(65)]])
    assert.throws(() => gridRayShader(rows), /grid-ray/);
  const helper = gridRayShader(['111', '102', '111']);
  assert.match(helper.code, /for \(var i/);
  assert.match(helper.code, /return vec4f\(distance, side, f32\(material\)/);
  assert.throws(() => compilePixelShader(parse('(grid-ray [0 0 0] [1 0] ["11"])')), /vec2f/);
});

test('GPU helper assembly retains different grids and deduplicates shared grids', () => {
  const runtime = engineServices().create({});
  runtime.load(
    parse(`(defn maze [] ["1111" "1001" "1001" "1111"])
    (defdraw render [] (let [grid (maze)]
      (pixels [p time] (let [hit (grid-ray [1.5 1.5] [1 0] grid)] (/ hit.x 4)))
      (pixels [p time] (let [hit (grid-ray [1.5 1.5] [0 1] grid)] (/ hit.x 4)))
      (pixels [p time] (let [hit (grid-ray [1.5 1.5] [1 0] ["1111" "1021" "1001" "1111"])] (/ hit.x 4)))))`),
  );
  const draw = runtime.drawFrame();
  const source = GPUHost.prototype.pixelSource.call({}, draw).source;
  assert.equal((source.match(/fn gridRay_/g) ?? []).length, 2);
  assert.equal(draw.commands[0].pixel.shader.extraHelpers.length, 1);
});

test('grid capture rejects CPU effects inside pixels', () => {
  const state = {};
  const runtime = engineServices().create(state);
  runtime.load(
    parse(
      '(defdraw render [] (pixels [p time] (grid-ray [0 0] [1 0] (do (set! :changed 1) ["11"]))))',
    ),
  );
  assert.throws(() => runtime.drawFrame(), /bind grid data outside pixels/);
  assert.equal(state.changed, undefined);
});
