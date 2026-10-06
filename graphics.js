import { vertexWGSL } from './shader.js';
import { locate } from './diagnostics.js';
import { assertType, registerTexture } from './types.js';

export async function createGraphics(canvas, reportError = console.error) {
  if (!navigator.gpu) throw new Error('WebGPU is required but unavailable in this browser.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU could not obtain a GPU adapter.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
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
  const pools = [[], []], slots = [], cache = new WeakMap();
  const handles = new WeakMap();
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const stats = { shaderCompilations: 0 };
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
  };
  const resize = () => {
    if (width === canvas.width && height === canvas.height) return;
    if (!canvas.width || !canvas.height || canvas.width > device.limits.maxTextureDimension2D || canvas.height > device.limits.maxTextureDimension2D) {
      throw new RangeError('Canvas dimensions must be positive and within WebGPU texture limits.');
    }
    resetTextures();
    width = canvas.width; height = canvas.height;
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

  const createShader = descriptor => {
    if (cache.has(descriptor)) return cache.get(descriptor);
    let pipeline = null, failure = null;
    const resources = descriptor.uniforms.filter(parameter => parameter.type === 'texture2d');
    const numeric = descriptor.uniforms.filter(parameter => parameter.type !== 'texture2d');
    const hasSampler = descriptor.hasSampler ?? resources.length > 0;
    const shader = (frameContext, ...values) => {
      available();
      if (!activeFrame || frameContext !== activeFrame.context) throw new Error('Shader calls require the current render context.');
      if (values.length !== descriptor.uniforms.length) throw new TypeError(`Shader expects ${descriptor.uniforms.length} parameter arguments`);
      const inputs = [];
      for (let i = 0; i < values.length; i++) {
        const parameter = descriptor.uniforms[i], value = values[i];
        assertType(value, parameter.type, `Shader parameter ${parameter.name}`);
        if (parameter.type === 'texture2d') {
          const handle = handles.get(value);
          if (!handle || handle.frame !== activeFrame) throw new TypeError(`Shader parameter ${parameter.name}: texture must come from this runtime's current frame`);
          inputs.push(handle.texture);
        } else {
          const components = parameter.type === 'float' ? [value] : value;
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
          const layout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ...resources.map((parameter, i) => ({ binding: i + 1,
              visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } })),
            ...(hasSampler ? [{ binding: resources.length + 1, visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: 'filtering' } }] : []),
          ] });
          pipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
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
      const frame = activeFrame, index = frame.count++;
      const size = 16 * (1 + numeric.length);
      if (!slots[index] || slots[index].size < size) {
        slots[index]?.buffer.destroy();
        slots[index] = { size, buffer: device.createBuffer({
          size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }), groups: new Map() };
      }
      const slot = slots[index];
      const data = new Float32Array(size / 4);
      data.set([width, height, frame.t, frame.dt]);
      let uniformIndex = 0;
      descriptor.uniforms.forEach((parameter, i) => {
        if (parameter.type === 'texture2d') return;
        data.set(parameter.type === 'float' ? [values[i]] : values[i], 4 + uniformIndex++ * 4);
      });
      device.queue.writeBuffer(slot.buffer, 0, data);
      let cached = slot.groups.get(pipeline);
      if (!cached || inputs.some((texture, i) => texture !== cached.inputs[i])) {
        cached = { inputs, group: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: slot.buffer } },
            ...inputs.map((texture, i) => ({ binding: i + 1, resource: texture.createView() })),
            ...(hasSampler ? [{ binding: resources.length + 1, resource: sampler }] : []),
          ],
        }) };
        slot.groups.set(pipeline, cached);
      }
      const texture = target(frame.pool, index);
      pass(frame.encoder, texture, pipeline, cached.group);
      frame.output = texture;
      const handle = registerTexture(Object.freeze({}));
      handles.set(handle, { texture, frame });
      return handle;
    };
    cache.set(descriptor, shader);
    return shader;
  };

  const render = (callback, dt = 0, t = 0) => {
    available(); resize();
    if (activeFrame) throw new Error('Cannot start a render frame inside another frame.');
    const frame = { context: Object.freeze({}), encoder: device.createCommandEncoder(),
      pool: completed ? 1 - completed.pool : 0, count: 0, output: null, dt, t };
    activeFrame = frame;
    try {
      callback?.(frame.context);
      present(frame.encoder, frame.output || completed?.texture);
      device.queue.submit([frame.encoder.finish()]);
      if (frame.output) completed = { texture: frame.output, pool: frame.pool };
    } catch (error) {
      // Discard recorded passes and keep the last completed image visible.
      const encoder = device.createCommandEncoder();
      present(encoder, completed?.texture);
      device.queue.submit([encoder.finish()]);
      throw error;
    } finally { activeFrame = null; }
  };
  const fill = createShader({ uniforms: ['red', 'green', 'blue'].map(name => ({ name, type: 'float' })),
    wgsl: `${vertexWGSL}
      struct Frame { data: vec4f, values: array<vec4f, 3>, }
      @group(0) @binding(0) var<uniform> frame: Frame;
      @fragment fn fragment() -> @location(0) vec4f {
        return vec4f(frame.values[0].x, frame.values[1].x, frame.values[2].x, 1);
      }`, source: '', start: 0, end: 0 });
  const clear = (...color) => {
    if (color.length !== 3) throw new TypeError('clear expects red, green, blue');
    for (let i = 0; i < color.length; i++) {
      if (typeof color[i] !== 'number' || !Number.isFinite(color[i]) || color[i] < 0 || color[i] > 1) {
        throw new TypeError(`clear: channel ${i + 1} must be a finite number between 0 and 1`);
      }
    }
    if (activeFrame) return fill(activeFrame.context, ...color);
    render(frame => fill(frame, ...color));
  };
  render(null);
  return { bindings: { clear }, createShader, render, stats,
    resetScene() { for (const slot of slots) slot.groups.clear(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resetTextures();
      for (const slot of slots) slot.buffer.destroy();
      context.unconfigure(); device.destroy();
    },
  };
}
