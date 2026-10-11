import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graphics } from "../graphics.js";
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Bindings } from "../bindings.js";
import { Data } from "../data.js";
import { Types } from "../types.js";
import { Structures } from "../structures.js";

test('graphics snapshots mutable numeric data extracted from collections and rejects lists', async t => {
  const writes = [], groups = [];
  const texture = () => {
    const result = { createView: () => ({ texture: result }), destroy() {} };
    return result;
  };
  const pipeline = { getBindGroupLayout: () => ({}) };
  const device = {
    lost: new Promise(() => {}), addEventListener() {}, destroy() {},
    limits: { maxTextureDimension2D: 1024, maxStorageBufferBindingSize: 1024 },
    createShaderModule: () => ({}), createRenderPipelineAsync: async () => pipeline,
    createRenderPipeline: () => pipeline, createSampler: () => ({}),
    createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
    createBindGroup: descriptor => { groups.push(descriptor); return {}; }, createBuffer: () => ({ destroy() {} }),
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
  const graphics = await Graphics.new({ width: 32, height: 24, getContext: () => context });
  t.after(() => Graphics.destroy(graphics));
  for (const trace of [true, false]) {
    const program = Compiler.compileScene(`(let settings (dict "color" (vec4f 0.5 1 0.25 1)))
      (on render (context)
        ((sh (color:vec4f gain:f32) (return (* color gain))) context (get settings."color") 0.5))`,
    Bindings, Forms, { trace });
    const scene = Compiler.run(program, program.shaders.map(shader => Graphics.createShader(graphics, shader)));
    Graphics.render(graphics, frame => {
      assert.deepEqual([Data.get(frame, 't'), Data.get(frame, 'dt'), Data.get(frame, 'w'), Data.get(frame, 'h')], [2, 0.25, 32, 24]);
      scene.render(frame);
    }, 0.25, 2);
    assert.deepEqual(writes.at(-1), [32, 24, 2, 0.25, 0.5, 1, 0.25, 1, 0.5, 0, 0, 0]);
    const shader = Graphics.createShader(graphics, program.shaders[0]);
    let saved;
    Graphics.render(graphics, frame => {
      saved = frame;
      assert.throws(() => shader(Data.copy(frame), Types.vectorBindings.vec4f(1), 1), /current render context/);
      assert.throws(() => shader(Data.dict('t', 0, 'dt', 0, 'w', 32, 'h', 24), Types.vectorBindings.vec4f(1), 1), /current render context/);
    });
    assert.throws(() => shader(saved, Types.vectorBindings.vec4f(1), 1), /current render context/);
    const decoded = Data.deserializeData(Data.serializeData(Types.vectorBindings.vec4f(1)));
    const color = Types.vectorBindings.vec4f(decoded.x, decoded.y, decoded.z, decoded.w);
    Graphics.render(graphics, frame => shader(frame, color, 1));
    Graphics.render(graphics, frame => {
      shader(frame, color, 1);
      Data.put(color, 0, 0.25);
      shader(frame, color, 1);
    });
    assert.equal(writes.at(-2)[4], 1);
    assert.equal(writes.at(-1)[4], 0.25);
    assert.throws(() => Graphics.render(graphics, frame => shader(frame, Data.list(1, 1, 1, 1), 1)), /expected vec4f/);
    assert.throws(() => Graphics.render(graphics, frame => shader(frame, Types.vectorBindings.vec4f(Infinity), 1)), /finite/);
  }
  for (const dimension of [2, 3, 4]) {
    const shaderProgram = Compiler.compile(`(sh (offset:f32 transform:mat${dimension}x${dimension}f after:vec2f)
      (return (vec4f 1)))`, {}, Forms);
    const shader = Graphics.createShader(graphics, shaderProgram.shaders[0]);
    const values = Array.from({ length: dimension * dimension }, (_, i) => i + 1);
    const transform = Types.matrixBindings[`mat${dimension}x${dimension}f`](...values);
    const expected = [32, 24, 0, 0, 0.5, 0, 0, 0];
    for (let column = 0; column < dimension; column++) {
      expected.push(...values.slice(column * dimension, (column + 1) * dimension), ...Array(4 - dimension).fill(0));
    }
    expected.push(2, 3, 0, 0);
    Graphics.render(graphics, frame => {
      shader(frame, 0.5, transform, Types.vectorBindings.vec2f(2, 3));
      Data.put(transform, 0, 99);
      shader(frame, 0.5, transform, Types.vectorBindings.vec2f(2, 3));
    });
    assert.deepEqual(writes.at(-2), expected);
    expected[8] = 99;
    assert.deepEqual(writes.at(-1), expected);
    assert.throws(() => Graphics.render(graphics, frame => shader(frame, 0.5, Types.matrixBindings[`mat${dimension}x${dimension}f`](...Array(dimension * dimension).fill(Infinity)), Types.vectorBindings.vec2f(1))), /finite/);
  }
  assert.throws(() => Compiler.compile('(sh (enabled:bool gain:f32) (let active (and enabled (not false))) (return (vec4f gain)))', {}, Forms), /booleans cannot cross the host\/GPU boundary/);
  assert.throws(() => Graphics.createShader(graphics, { uniforms: [{ name: 'enabled', type: 'bool', slot: 0 }], wgsl: '' }), /booleans cannot cross the host\/GPU boundary/);
  const buffersProgram = Compiler.compile('(sh (values:array<f32>) (return (vec4f (get values.0))))', {}, Forms);
  const bufferShader = Graphics.createShader(graphics, buffersProgram.shaders[0]);
  const data = Structures.createZeroArray('f32', 3); Data.put(data, 0, 0.25);
  Graphics.render(graphics, frame => bufferShader(frame, data));
  const uploads = writes.filter(value => value.length === 3).length;
  Graphics.render(graphics, frame => bufferShader(frame, data));
  assert.equal(writes.filter(value => value.length === 3).length, uploads);
  Graphics.render(graphics, frame => {
    bufferShader(frame, data);
    Data.put(data, 0, 0.5);
    bufferShader(frame, data);
  });
  assert.deepEqual(writes.filter(value => value.length === 3).at(-1), [0.5, 0, 0]);
  assert.throws(() => Graphics.render(graphics, frame => bufferShader(frame, Data.list(1, 2, 3))), /array element/);
  assert.throws(() => Graphics.render(graphics, frame => bufferShader(frame, Structures.createZeroArray('vec2f', 3))), /array element/);
  const boundedProgram = Compiler.compile('(sh (values:array<f32,3>) (return (vec4f values.0)))', {}, Forms);
  const boundedShader = Graphics.createShader(graphics, boundedProgram.shaders[0]);
  Graphics.render(graphics, frame => boundedShader(frame, data));
  assert.throws(() => Graphics.render(graphics, frame => boundedShader(frame, Structures.createZeroArray('f32', 2))), /capacity 3/);
  const manyProgram = Compiler.compile('(sh (values:many<f32>) (return (vec4f values.0)))', {}, Forms);
  const manyShader = Graphics.createShader(graphics, manyProgram.shaders[0]);
  const many = Structures.createMany('f32', undefined, 0.25);
  Graphics.render(graphics, frame => manyShader(frame, many));
  assert.deepEqual(writes.at(-1).slice(4, 6), [1, 1]);
  Bindings.insert(many, 0.5); Bindings.insert(many, 0.75);
  Graphics.render(graphics, frame => manyShader(frame, many));
  assert.deepEqual(writes.at(-1).slice(4, 6), [3, 4]);
  assert.throws(() => Graphics.render(graphics, frame => manyShader(frame, data)), /collection kind/);
  assert.throws(() => Graphics.render(graphics, frame => bufferShader(frame, many)), /collection kind/);
  const makeShader = source => Graphics.createShader(graphics, Compiler.compile(source, Bindings, Forms).shaders[0]);
  const automatic = makeShader('(sh () (return (sample before uv)))');
  const explicit = makeShader('(sh (image:texture2d) (return (sample image uv)))');
  const inputOfLastDraw = () => groups.at(-1).entries.find(entry => entry.binding === 1).resource.texture;
  let precedingTexture;
  Graphics.render(graphics, frame => {
    const initial = Data.get(frame, 'before');
    assert.equal(Data.get(initial, 'w'), 32); assert.equal(Data.get(initial, 'h'), 24);
    assert.deepEqual(Data.values(Data.get(initial, 'wh')), [32,24]);
    const first = automatic(frame);
    precedingTexture = inputOfLastDraw();
    assert.equal(Data.get(frame, 'before'), first); assert.notEqual(first, initial);
    for (const trace of [true, false]) {
      assert.deepEqual(Data.values(Compiler.run(Compiler.compile('(list image.w image.h image.wh)', { ...Bindings, image: first }, Forms, { trace }))).slice(0,2), [32,24]);
      assert.deepEqual(Data.values(Data.get(first, 'wh')), [32,24]);
      const dimensions = Data.get(first, 'wh'); Data.put(dimensions, 0, 99);
      assert.deepEqual(Data.values(Data.get(first, 'wh')), [32,24]);
      assert.throws(() => Compiler.run(Compiler.compile('(set image.w 99)', { ...Bindings, image: first }, Forms, { trace })), /Dot assignment/);
      assert.throws(() => Compiler.run(Compiler.compile('image.unknown', { ...Bindings, image: first }, Forms, { trace })), /Unknown texture field/);
    }
    const second = automatic(frame);
    const firstTexture = inputOfLastDraw();
    assert.notEqual(firstTexture, precedingTexture);
    assert.equal(Data.get(frame, 'before'), second);
    explicit(frame, first);
    assert.equal(inputOfLastDraw(), firstTexture);
    graphics.bindings.clear(0, 0, 1);
    const cleared = Data.get(frame, 'before');
    assert.notEqual(cleared, second);
    assert.deepEqual(writes.at(-1).slice(4), [0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0]);
    automatic(frame);
    const clearTexture = inputOfLastDraw();
    assert.notEqual(clearTexture, firstTexture);
    assert.throws(() => explicit(frame, Data.list()), /expected texture2d/);
    const after = Data.get(frame, 'before');
    assert.throws(() => explicit(frame, Data.list()), /expected texture2d/);
    assert.equal(Data.get(frame, 'before'), after);
  });
  for (const trace of [true, false]) {
    for (const [source, color] of [
      ['(clear)', [0,0,0,1]],
      ['(clear 1)', [1,1,1,1]], ['(clear 0.25)', [0.25,0.25,0.25,1]],
      ['(clear 0.25 0.5 0.75)', [0.25,0.5,0.75,1]],
      ['(clear 0.25 0.5 0.75 0.5)', [0.25,0.5,0.75,0.5]],
      ['(clear (vec3 0.25 0.5 0.75))', [0.25,0.5,0.75,1]],
      ['(clear (vec4 0.25 0.5 0.75 0))', [0.25,0.5,0.75,0]],
    ]) {
      const program = Compiler.compile(source, { ...Bindings, ...graphics.bindings }, Forms, { trace });
      Compiler.run(program);
      assert.deepEqual(writes.at(-1).slice(4), color.flatMap(channel => [channel,0,0,0]));
      Graphics.render(graphics, frame => {
        const previous = Data.get(frame, 'before');
        const result = Compiler.run(program);
        assert.equal(Data.get(frame, 'before'), result); assert.notEqual(result, previous);
        assert.deepEqual(writes.at(-1).slice(4), color.flatMap(channel => [channel,0,0,0]));
      });
    }
    for (const source of ['(clear 0 1)', '(clear 0 0 0 1 1)', '(clear nil)', '(clear (vec2))', '(clear (vec3i))', '(clear (list 0 0 0))', '(clear -1)', '(clear 0 0 0 2)', '(clear (vec4 0 0 0 -1))', '(clear bad)', '(clear 0 0 0 bad)']) {
      Graphics.render(graphics, frame => {
        const previous = Data.get(frame, 'before'), count = writes.length;
        assert.throws(() => Compiler.run(Compiler.compile(source, { ...Bindings, ...graphics.bindings, bad: Infinity }, Forms, { trace })), TypeError, source);
        assert.equal(Data.get(frame, 'before'), previous); assert.equal(writes.length, count);
      });
    }
  }
});
