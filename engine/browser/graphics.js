import { vertexWGSL } from '../compiler/shader.js';
import { locate } from '../language/trace.js';
import { assertType, registerTexture } from '../language/types.js';
import { dict, dataKind, reCopy, get, put, vector } from '../language/data.js';
import { collectionInfo, sameElement, packCollection } from '../language/structures.js';
import { scalarTypes, vectorInfo, matrixSize } from '../language/numeric-types.js';
import { rasterizeText } from '../language/text.js';

export async function createGraphics(innerCanvas, reportError = console.error, { prepare, present: painted } = {}) {
  if (!navigator.gpu) throw new Error('WebGPU is required but unavailable in this browser.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU could not obtain a GPU adapter.');
  const device = await adapter.requestDevice();
  const context = innerCanvas.getContext('webgpu');
  if (!context) { device.destroy(); throw new Error('Unable to create the WebGPU canvas context.'); }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const presentModule = device.createShaderModule({ code: `${vertexWGSL}
    @group(0) @binding(0) var image: texture_2d<f32>;
    @fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
      return textureLoad(image, vec2i(p.xy), 0);
    }` });
  let presentPipeline;
  try {
    presentPipeline = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module: presentModule, entryPoint: 'vertex' },
      fragment: { module: presentModule, entryPoint: 'fragment', targets: [{ format }] },
    });
  } catch (error) { context.unconfigure(); device.destroy(); throw error; }

  let destroyed = false, lost = false, activeFrame = null, completed = null;
  let width = 0, height = 0;
  let blackTexture = null;
  const pools = [[], []], slots = [], cache = new WeakMap();
  const handles = new WeakMap();
  const textCache = new Map(), persistentTextures = new Set();
  const textureFinalizer = new FinalizationRegistry(texture => {
    persistentTextures.delete(texture);
    if (!destroyed) texture.destroy();
  });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const stats = { shaderCompilations: 0, textRasterizations: 0 };
  device.lost.then(info => {
    lost = true;
    if (!destroyed) reportError(new Error(`WebGPU device lost: ${info.message || info.reason}`));
  });
  device.addEventListener('uncapturederror', event => reportError(event.error));
  const available = () => {
    if (destroyed) throw new Error('Graphics runtime has been destroyed.');
    if (lost) throw new Error('WebGPU device is lost. Reload the page to reinitialize graphics.');
  };
  const resetTextures = () => {
    for (const pool of pools) {
      for (const texture of pool) texture.destroy();
      pool.length = 0;
    }
    completed = null;
    blackTexture?.destroy(); blackTexture = null;
  };
  const resize = () => {
    if (width === innerCanvas.width && height === innerCanvas.height) return;
    if (!innerCanvas.width || !innerCanvas.height || innerCanvas.width > device.limits.maxTextureDimension2D || innerCanvas.height > device.limits.maxTextureDimension2D) {
      throw new RangeError('Canvas dimensions must be positive and within WebGPU texture limits.');
    }
    resetTextures();
    width = innerCanvas.width; height = innerCanvas.height;
  };
  const target = (pool, index) => {
    pools[pool][index] ??= device.createTexture({
      size: [width, height], format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return pools[pool][index];
  };
  const pass = (encoder, output, pipeline, group) => {
    const renderPass = encoder.beginRenderPass({ colorAttachments: [{
      view: output.createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store',
    }] });
    if (pipeline) {
      renderPass.setPipeline(pipeline);
      renderPass.setBindGroup(0, group);
      renderPass.draw(3);
    }
    renderPass.end();
  };
  const present = (encoder, texture) => {
    const group = texture ? device.createBindGroup({
      layout: presentPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: texture.createView() }],
    }) : null;
    pass(encoder, context.getCurrentTexture(), texture ? presentPipeline : null, group);
  };
  const initialBefore = () => {
    if (!blackTexture) {
      blackTexture = device.createTexture({ size: [width, height], format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      const encoder = device.createCommandEncoder();
      pass(encoder, blackTexture, null, null);
      device.queue.submit([encoder.finish()]);
    }
    return blackTexture;
  };

  const createShader = descriptor => {
    if (cache.has(descriptor)) return cache.get(descriptor);
    let pipeline = null, failure = null;
    const resources = descriptor.uniforms.filter(parameter => parameter.type === 'texture2d' || parameter.kind === 'storage');
    const numeric = descriptor.uniforms.filter(parameter => parameter.type !== 'texture2d');
    const expected = descriptor.uniforms.filter(parameter => !parameter.automatic).length;
    const hasAutomatic = descriptor.uniforms.some(parameter => parameter.automatic);
    const hasSampler = descriptor.hasSampler ?? resources.some(parameter => parameter.type === 'texture2d');
    const shader = (frameContext, ...values) => {
      available();
      if (!activeFrame || frameContext !== activeFrame.context) throw new Error('Shader calls require the current render context.');
      if (values.length !== expected) throw new TypeError(`Shader expects ${expected} parameter arguments`);
      if (hasAutomatic) {
        let supplied = 0;
        values = descriptor.uniforms.map(parameter => parameter.automatic ? get(frameContext, parameter.name) : values[supplied++]);
      }
      const inputs = [];
      for (let i = 0; i < values.length; i++) {
        const parameter = descriptor.uniforms[i], value = values[i];
        if (parameter.kind === 'storage') {
          const state = collectionInfo(value);
          if (!state || dataKind(value) !== (parameter.collection || 'array') || !sameElement(state.element, parameter.element)) throw new TypeError(`Shader parameter ${parameter.name}: wrong array element struct/type or collection kind`);
          if (parameter.capacity !== undefined && (!state.bounded || state.capacity !== parameter.capacity)) throw new TypeError(`Shader parameter ${parameter.name}: expected array capacity ${parameter.capacity}`);
          const bytes = Math.max(state.stride * 4, state.capacity * state.stride * 4);
          if (state.length > 16777216) throw new RangeError('Buffer length exceeds exact f32 indexing range');
          if (bytes > device.limits.maxStorageBufferBindingSize) throw new RangeError('Buffer exceeds GPU storage binding limit');
          inputs.push({ state, value, bytes });
        } else if (parameter.type === 'texture2d') {
          assertType(value, parameter.type, `Shader parameter ${parameter.name}`);
          const handle = handles.get(value);
          if (!handle || !handle.persistent && handle.frame !== activeFrame) throw new TypeError(`Shader parameter ${parameter.name}: texture must come from this runtime's current frame or its persistent resources`);
          inputs.push(handle.texture);
        } else {
          assertType(parameter.type === 'f32' && typeof value === 'number' ? Math.fround(value) : value, parameter.type, `Shader parameter ${parameter.name}`);
          const components = (parameter.type === 'bool') ? [Number(value)] : scalarTypes.includes(parameter.type) ? [value] : value.values;
          if (Array.from(components).some(component => !Number.isFinite(Math.fround(component)))) {
            throw new TypeError(`Shader parameter ${parameter.name}: components must be finite f32 numbers`);
          }
        }
      }
      if (failure) throw failure;
      if (!pipeline) {
        device.pushErrorScope('validation');
        try {
          const module = device.createShaderModule({ code: descriptor.wgsl });
          const bindGroupLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ...resources.map((parameter, i) => parameter.kind === 'storage' ? { binding: i + 1,
              visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } } : { binding: i + 1,
              visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }),
            ...(hasSampler ? [{ binding: resources.length + 1, visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: 'filtering' } }] : []),
          ] });
          pipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: { module, entryPoint: 'vertex' },
            fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
          });
          stats.shaderCompilations++;
        } finally {
          device.popErrorScope().then(error => {
            if (error) {
              failure = locate(new Error(`Shader compilation failed: ${error.message}`), descriptor.source, descriptor.start, descriptor.end);
              if (!destroyed) reportError(failure);
            }
          });
        }
      }
      const frame = activeFrame, index = frame.drawCount++;
      const size = 16 * (1 + numeric.reduce((slots, parameter) => slots + (parameter.type.startsWith('mat') ? matrixSize(parameter.type) : 1), 0));
      if (!slots[index] || slots[index].size < size) {
        slots[index]?.buffer.destroy();
        if (slots[index]) for (const storage of slots[index].storage.values()) storage.buffer.destroy();
        slots[index] = { size, buffer: device.createBuffer({
          size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }), groups: new Map(), storage: new Map() };
      }
      const slot = slots[index];
      for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
        if (resources[resourceIndex].kind !== 'storage') continue;
        const input = inputs[resourceIndex];
        let cached = slot.storage.get(resourceIndex);
        if (!cached || cached.bytes < input.bytes) {
          cached?.buffer.destroy();
          cached = { bytes: input.bytes, buffer: device.createBuffer({ size: input.bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }) };
          slot.storage.set(resourceIndex, cached);
        }
        if (cached.value !== input.value || cached.revision !== input.state.revision) {
          const data = packCollection(input.state);
          if (data.length) device.queue.writeBuffer(cached.buffer, 0, data);
          cached.value = input.value; cached.revision = input.state.revision;
        }
        inputs[resourceIndex] = cached.buffer;
      }
      const data = new Float32Array(size / 4);
      const integerData = new DataView(data.buffer);
      data.set([width, height, frame.t, frame.dt]);
      let uniformIndex = 0;
      descriptor.uniforms.forEach((parameter, i) => {
        if (parameter.type === 'texture2d') return;
        if (parameter.kind === 'storage') { const state = collectionInfo(values[i]); data.set([state.length, state.capacity], 4 + uniformIndex++ * 4); return; }
        if (parameter.type.startsWith('mat')) {
          const dimension = matrixSize(parameter.type);
          for (let column = 0; column < dimension; column++) {
            data.set(values[i].values.slice(column * dimension, (column + 1) * dimension), 4 + uniformIndex++ * 4);
          }
        } else {
          const component = vectorInfo(parameter.type)?.scalar || parameter.type;
          const components = parameter.type === 'bool' ? [Number(values[i])] : scalarTypes.includes(parameter.type) ? [values[i]] : values[i].values;
          const offset = 4 + uniformIndex++ * 4;
          if (component === 'i32' || component === 'u32') components.forEach((value, index) => integerData[component === 'i32' ? 'setInt32' : 'setUint32']((offset + index) * 4, value, true));
          else data.set(components, offset);
        }
      });
      device.queue.writeBuffer(slot.buffer, 0, data);
      let cached = slot.groups.get(pipeline);
      if (!cached || inputs.some((texture, i) => texture !== cached.inputs[i])) {
        cached = { inputs, group: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: slot.buffer } },
            ...inputs.map((input, i) => ({ binding: i + 1, resource: resources[i].kind === 'storage' ? { buffer: input } : input.createView() })),
            ...(hasSampler ? [{ binding: resources.length + 1, resource: sampler }] : []),
          ],
        }) };
        slot.groups.set(pipeline, cached);
      }
      const texture = target(frame.pool, index);
      pass(frame.encoder, texture, pipeline, cached.group);
      frame.output = texture;
      const handle = registerTexture(Object.freeze({}), width, height);
      handles.set(handle, { texture, frame });
      put(frame.context, 'before', handle);
      return handle;
    };
    cache.set(descriptor, shader);
    return shader;
  };

  const render = (callback, dt = 0, t = 0) => {
    available();
    if (activeFrame) throw new Error('Cannot start a render frame inside another frame.');
    prepare?.(device.limits.maxTextureDimension2D);
    resize();
    const frame = { context: dict('t', t, 'dt', dt, 'w', width, 'h', height), encoder: device.createCommandEncoder(),
      pool: completed ? 1 - completed.pool : 0, drawCount: 0, output: null, dt, t };
    const before = registerTexture(Object.freeze({}), width, height);
    handles.set(before, { texture: completed?.texture || initialBefore(), frame });
    put(frame.context, 'before', before);
    activeFrame = frame;
    try {
      callback?.(frame.context);
      present(frame.encoder, frame.output || completed?.texture);
      device.queue.submit([frame.encoder.finish()]);
      if (frame.output) completed = { texture: frame.output, pool: frame.pool };
      painted?.();
    } catch (error) {
      // Discard recorded passes and keep the last completed image visible.
      const encoder = device.createCommandEncoder();
      present(encoder, completed?.texture);
      device.queue.submit([encoder.finish()]);
      painted?.();
      throw error;
    } finally { activeFrame = null; }
  };
  const fill = createShader({ uniforms: ['red', 'green', 'blue', 'alpha'].map(name => ({ name, type: 'f32' })),
    wgsl: `${vertexWGSL}
      struct Frame { data: vec4f, values: array<vec4f, 4>, }
      @group(0) @binding(0) var<uniform> frame: Frame;
      @fragment fn fragment() -> @location(0) vec4f {
        return vec4f(frame.values[0].x, frame.values[1].x, frame.values[2].x, frame.values[3].x);
      }`, source: '', start: 0, end: 0 });
  const clear = (...color) => {
    if (color.length === 0) color = [0, 0, 0];
    if (color.length === 1) {
      const value = color[0];
      if (typeof value === 'number') color = [value, value, value];
      else if (['vec3f', 'vec4f'].includes(dataKind(value))) color = [...value.values];
      else throw new TypeError('clear expects a numeric scalar, vec3f, vec4f, or three or four numeric channels');
    }
    if (color.length !== 3 && color.length !== 4) throw new TypeError('clear expects a numeric scalar, vec3f, vec4f, or three or four numeric channels');
    if (color.length === 3) color.push(1);
    for (let i = 0; i < color.length; i++) {
      if (typeof color[i] !== 'number' || !Number.isFinite(color[i]) || color[i] < 0 || color[i] > 1) {
        throw new TypeError(`clear: channel ${i + 1} must be a finite number between 0 and 1`);
      }
    }
    if (activeFrame) return fill(activeFrame.context, ...color);
    render(frame => fill(frame, ...color));
  };
  const createText = text => {
    available();
    const fontState = text.runs.map(run => globalThis.document?.fonts?.check(`${run.size}px ${run.font}`) ?? true);
    const key = JSON.stringify([text, fontState]);
    if (textCache.has(key)) {
      const cached = textCache.get(key);
      textCache.delete(key); textCache.set(key, cached);
      return reCopy(dict(...cached));
    }
    const raster = rasterizeText(text, { maxSize: device.limits.maxTextureDimension2D });
    const texture = device.createTexture({ size: [raster.width, raster.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    try {
      // Store straight alpha so ordinary shader color multiplication remains useful.
      device.queue.copyExternalImageToTexture({ source: raster.canvas }, { texture, premultipliedAlpha: false }, [raster.width, raster.height]);
    } catch (error) { texture.destroy(); throw error; }
    const handle = registerTexture(Object.freeze({}), raster.width, raster.height);
    handles.set(handle, { texture, persistent: true });
    persistentTextures.add(texture); textureFinalizer.register(handle, texture);
    stats.textRasterizations++;
    const fields = ['texture', handle, 'w', raster.width, 'h', raster.height, 'wh', vector(2, [raster.width, raster.height]), 'baseline', raster.baseline,
      'origin', dict('x', raster.offsetX, 'y', raster.offsetY), 'lines', raster.lineCount, 'content', text.runs.map(run => run.text).join('')];
    textCache.set(key, fields);
    if (textCache.size > 128) textCache.delete(textCache.keys().next().value);
    return reCopy(dict(...fields));
  };
  render(null);
  return { bindings: { clear }, createShader, createText, render, stats,
    resetScene() { for (const slot of slots) slot.groups.clear(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      textCache.clear();
      for (const texture of persistentTextures) texture.destroy();
      persistentTextures.clear();
      resetTextures();
      for (const slot of slots) { slot.buffer.destroy(); for (const storage of slot.storage.values()) storage.buffer.destroy(); }
      context.unconfigure(); device.destroy();
    },
  };
}
