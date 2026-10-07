import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphics } from '../engine/graphics.js';
import { compile } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { bindings } from '../engine/bindings.js';
import { list, dict, get, copy, put, deserializeData, serializeData } from '../engine/data.js';
import { vectorBindings, matrixBindings } from '../engine/types.js';
import { createZeroArray, createMany } from '../engine/structures.js';

test('graphics snapshots mutable numeric data extracted from collections and rejects lists', async t => {
  const writes = [];
  const texture = () => ({ createView: () => ({}), destroy() {} });
  const pipeline = { getBindGroupLayout: () => ({}) };
  const device = {
    lost: new Promise(() => {}), addEventListener() {}, destroy() {},
    limits: { maxTextureDimension2D: 1024, maxStorageBufferBindingSize: 1024 },
    createShaderModule: () => ({}), createRenderPipelineAsync: async () => pipeline,
    createRenderPipeline: () => pipeline, createSampler: () => ({}),
    createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
    createBindGroup: () => ({}), createBuffer: () => ({ destroy() {} }),
    createTexture: texture, pushErrorScope() {}, popErrorScope: async () => null,
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }), finish: () => ({}),
    }),
    queue: { writeBuffer: (createZeroArray, offset, values) => writes.push([...values]), submit() {} },
  };
  const globals = {
    navigator: { gpu: { requestAdapter: async () => ({ requestDevice: async () => device }), getPreferredCanvasFormat: () => 'rgba8unorm' } },
    GPUShaderStage: { FRAGMENT: 1 }, GPUTextureUsage: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 },
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const context = { configure() {}, unconfigure() {}, getCurrentTexture: texture };
  const graphics = await createGraphics({ width: 32, height: 24, getContext: () => context });
  t.after(() => graphics.destroy());
  for (const trace of [true, false]) {
    const program = compile(`(let settings (dict "color" (vec4f 0.5 1 0.25 1)))
      (on render (context)
        ((sh (color:vec4f gain:f32) (return (* color gain))) context (get settings "color") 0.5))`,
    bindings, forms, { scene: true, trace });
    const scene = program.run(program.shaders.map(shader => graphics.createShader(shader)));
    graphics.render(frame => {
      assert.deepEqual([get(frame, 't'), get(frame, 'dt'), get(frame, 'w'), get(frame, 'h')], [2, 0.25, 32, 24]);
      scene.render(frame);
    }, 0.25, 2);
    assert.deepEqual(writes.at(-1), [32, 24, 2, 0.25, 0.5, 1, 0.25, 1, 0.5, 0, 0, 0]);
    const shader = graphics.createShader(program.shaders[0]);
    let saved;
    graphics.render(frame => {
      saved = frame;
      assert.throws(() => shader(copy(frame), vectorBindings.vec4f(1), 1), /current render context/);
      assert.throws(() => shader(dict('t', 0, 'dt', 0, 'w', 32, 'h', 24), vectorBindings.vec4f(1), 1), /current render context/);
    });
    assert.throws(() => shader(saved, vectorBindings.vec4f(1), 1), /current render context/);
    const color = deserializeData(serializeData(vectorBindings.vec4f(1)));
    graphics.render(frame => shader(frame, color, 1));
    graphics.render(frame => {
      shader(frame, color, 1);
      put(color, 0, 0.25);
      shader(frame, color, 1);
    });
    assert.equal(writes.at(-2)[4], 1);
    assert.equal(writes.at(-1)[4], 0.25);
    assert.throws(() => graphics.render(frame => shader(frame, list(1, 1, 1, 1), 1)), /expected vec4f/);
    assert.throws(() => graphics.render(frame => shader(frame, vectorBindings.vec4f(Infinity), 1)), /finite f32/);
  }
  for (const dimension of [2, 3, 4]) {
    const shaderProgram = compile(`(sh (offset:f32 transform:mat${dimension}x${dimension}f after:vec2f)
      (return (vec4f 1)))`, {}, forms);
    const shader = graphics.createShader(shaderProgram.shaders[0]);
    const values = Array.from({ length: dimension * dimension }, (_, i) => i + 1);
    const transform = matrixBindings[`mat${dimension}x${dimension}f`](...values);
    const expected = [32, 24, 0, 0, 0.5, 0, 0, 0];
    for (let column = 0; column < dimension; column++) {
      expected.push(...values.slice(column * dimension, (column + 1) * dimension), ...Array(4 - dimension).fill(0));
    }
    expected.push(2, 3, 0, 0);
    graphics.render(frame => {
      shader(frame, 0.5, transform, vectorBindings.vec2f(2, 3));
      put(transform, 0, 99);
      shader(frame, 0.5, transform, vectorBindings.vec2f(2, 3));
    });
    assert.deepEqual(writes.at(-2), expected);
    expected[8] = 99;
    assert.deepEqual(writes.at(-1), expected);
    assert.throws(() => graphics.render(frame => shader(frame, 0.5, matrixBindings[`mat${dimension}x${dimension}f`](...Array(dimension * dimension).fill(Infinity)), vectorBindings.vec2f(1))), /finite f32/);
  }
  const booleanProgram = compile('(sh (enabled:bool gain:f32) (let active (and enabled (not false))) (return (vec4f gain)))', {}, forms);
  const booleanShader = graphics.createShader(booleanProgram.shaders[0]);
  for (const value of [true, false]) {
    graphics.render(frame => booleanShader(frame, value, 0.5));
    assert.deepEqual(writes.at(-1), [32, 24, 0, 0, Number(value), 0, 0, 0, 0.5, 0, 0, 0]);
  }
  assert.throws(() => graphics.render(frame => booleanShader(frame, 1, 0.5)), /expected bool/);
  const buffersProgram = compile('(sh (values:array<f32>) (return (vec4f (get values 0))))', {}, forms);
  const bufferShader = graphics.createShader(buffersProgram.shaders[0]);
  const data = createZeroArray('f32', 3); put(data, 0, 0.25);
  graphics.render(frame => bufferShader(frame, data));
  const uploads = writes.filter(value => value.length === 3).length;
  graphics.render(frame => bufferShader(frame, data));
  assert.equal(writes.filter(value => value.length === 3).length, uploads);
  graphics.render(frame => {
    bufferShader(frame, data);
    put(data, 0, 0.5);
    bufferShader(frame, data);
  });
  assert.deepEqual(writes.filter(value => value.length === 3).at(-1), [0.5, 0, 0]);
  assert.throws(() => graphics.render(frame => bufferShader(frame, list(1, 2, 3))), /array element/);
  assert.throws(() => graphics.render(frame => bufferShader(frame, createZeroArray('vec2f', 3))), /array element/);
  const boundedProgram = compile('(sh (values:array<f32,3>) (return (vec4f values.0)))', {}, forms);
  const boundedShader = graphics.createShader(boundedProgram.shaders[0]);
  graphics.render(frame => boundedShader(frame, data));
  assert.throws(() => graphics.render(frame => boundedShader(frame, createZeroArray('f32', 2))), /capacity 3/);
  const manyProgram = compile('(sh (values:many<f32>) (return (vec4f values.0)))', {}, forms);
  const manyShader = graphics.createShader(manyProgram.shaders[0]);
  const many = createMany('f32', undefined, 0.25);
  graphics.render(frame => manyShader(frame, many));
  assert.deepEqual(writes.at(-1).slice(4, 6), [1, 1]);
  bindings.insert(many, 0.5); bindings.insert(many, 0.75);
  graphics.render(frame => manyShader(frame, many));
  assert.deepEqual(writes.at(-1).slice(4, 6), [3, 4]);
  assert.throws(() => graphics.render(frame => manyShader(frame, data)), /collection kind/);
  assert.throws(() => graphics.render(frame => bufferShader(frame, many)), /collection kind/);
});
