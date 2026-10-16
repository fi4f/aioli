import { Shader } from './shader.js';
import { Trace } from './trace.js';
import { Types } from './types.js';
import { Data } from './data.js';
import { Structures } from './structures.js';
import { NumericTypes } from './numeric-types.js';
import { Text } from './text.js';

async function __createGraphics__(
  innerCanvas,
  reportError = console.error,
  { prepare, present: painted, needsPresent = () => true, shared = null } = {},
) {
  const service = { innerCanvas, reportError, prepare, painted, needsPresent };
  service.ownsDevice = !shared;
  if (shared) {
    __available__(shared);
    service.adapter = shared.adapter;
    service.device = shared.device;
    service.context = null;
    service.format = shared.format;
  } else {
    if (!navigator.gpu) throw new Error('WebGPU is required but unavailable in this browser.');
    service.adapter = await navigator.gpu.requestAdapter();
    if (!service.adapter) throw new Error('WebGPU could not obtain a GPU adapter.');
    service.device = await service.adapter.requestDevice();
    service.context = service.innerCanvas.getContext('webgpu');
    if (!service.context) {
      service.device.destroy();
      throw new Error('Unable to create the WebGPU canvas context.');
    }
    service.format = navigator.gpu.getPreferredCanvasFormat();
    service.context.configure({
      device: service.device,
      format: service.format,
      alphaMode: 'opaque',
    });
  }
  service.presentModule = service.device.createShaderModule({
    code: `${Shader.vertexWGSL}
    @group(0) @binding(0) var image: texture_2d<f32>;
    @fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
      return textureLoad(image, vec2i(p.xy), 0);
    }`,
  });
  service.presentPipeline = undefined;
  try {
    if (service.context) service.presentPipeline = await service.device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: service.presentModule, entryPoint: 'vertex' },
      fragment: {
        module: service.presentModule,
        entryPoint: 'fragment',
        targets: [{ format: service.format }],
      },
    });
  } catch (error) {
    service.context?.unconfigure();
    if (service.ownsDevice) service.device.destroy();
    throw error;
  }
  service.destroyed = false;
  service.lost = false;
  service.activeFrame = null;
  service.completed = null;
  service.width = 0;
  service.height = 0;
  service.blackTexture = null;
  service.pools = [[], []];
  service.slots = [];
  service.cache = new WeakMap();
  service.__layers__ = new WeakMap();
  service.__replaceTarget__ = { format: service.format };
  service.__layerTarget__ = {
    format: service.format,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
  };
  service.handles = new WeakMap();
  service.__views__ = new WeakMap();
  service.__presentGroups__ = new WeakMap();
  service.textCache = new Map();
  service.__images__ = new Map();
  service.persistentTextures = new Set();
  service.textCacheBytes = 0;
  service.textLineCache = { measure: new Map(), paint: new Map() };
  service.invalidateFonts = () => __invalidateFonts__(service);
  globalThis.document?.fonts?.addEventListener?.('loadingdone', service.invalidateFonts);
  service.textureFinalizer = new FinalizationRegistry((texture) => {
    service.persistentTextures.delete(texture);
    if (!service.destroyed) texture.destroy();
  });
  service.sampler = service.device.createSampler({
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
  });
  service.stats = { shaderCompilations: 0, textRasterizations: 0 };
  // Device loss is a promise, so clear its subscription target on disposal.
  // A shared device may outlive many embedded runtimes.
  const loss = service.loss = { target: service };
  service.device.lost.then((info) => {
    const target = loss.target;
    if (!target) return;
    target.lost = true;
    target.reportError(new Error(`WebGPU device lost: ${info.message || info.reason}`));
  });
  service.uncapturedError = (event) => service.reportError(event.error);
  service.device.addEventListener('uncapturederror', service.uncapturedError);
  service.bindings = {
    clear: (...color) => __clear__(service, ...color),
    layer: (context, bounds, shader, ...values) =>
      __layer__(service, context, bounds, shader, values),
    'layer-regions': (context, regions, shader, ...values) =>
      __layerRegions__(service, context, regions, shader, values),
  };
  __render__(service, null);
  return service;
}

function __invalidateFonts__(service) {
  service.textCache.clear();
  service.textCacheBytes = 0;
  service.textLineCache.measure.clear();
  service.textLineCache.paint.clear();
}

function __available__(service) {
  if (service.destroyed) throw new Error('Graphics runtime has been destroyed.');
  if (service.lost)
    throw new Error('WebGPU device is lost. Reload the page to reinitialize graphics.');
}

function __resetTextures__(service) {
  for (const pool of service.pools) {
    for (const texture of pool) texture.destroy();
    pool.length = 0;
  }
  service.completed = null;
  service.blackTexture?.destroy();
  service.blackTexture = null;
}

function __resize__(service) {
  if (service.width === service.innerCanvas.width && service.height === service.innerCanvas.height)
    return;
  if (
    !service.innerCanvas.width ||
    !service.innerCanvas.height ||
    service.innerCanvas.width > service.device.limits.maxTextureDimension2D ||
    service.innerCanvas.height > service.device.limits.maxTextureDimension2D
  ) {
    throw new RangeError('Canvas dimensions must be positive and within WebGPU texture limits.');
  }
  __resetTextures__(service);
  service.width = service.innerCanvas.width;
  service.height = service.innerCanvas.height;
}

function __target__(service, pool, index) {
  service.pools[pool][index] ??= service.device.createTexture({
    size: [service.width, service.height],
    format: service.format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  return service.pools[pool][index];
}

function __pass__(service, encoder, output, pipeline, group, clearValue = [0, 0, 0, 1]) {
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: __view__(service, output),
        clearValue,
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  if (pipeline) {
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, group);
    renderPass.draw(3);
  }
  renderPass.end();
}

function __view__(service, texture) {
  if (!service.__views__.has(texture)) service.__views__.set(texture, texture.createView());
  return service.__views__.get(texture);
}

function __encoder__(service, frame) {
  return (frame.encoder ??= service.device.createCommandEncoder());
}

function __present__(service, encoder, texture) {
  if (!service.context) return;
  if (texture && !service.__presentGroups__.has(texture))
    service.__presentGroups__.set(
      texture,
      service.device.createBindGroup({
        layout: service.presentPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: __view__(service, texture) }],
      }),
    );
  const group = texture ? service.__presentGroups__.get(texture) : null;
  __pass__(
    service,
    encoder,
    service.context.getCurrentTexture(),
    texture ? service.presentPipeline : null,
    group,
  );
}

function __initialBefore__(service) {
  if (!service.blackTexture) {
    service.blackTexture = service.device.createTexture({
      size: [service.width, service.height],
      format: service.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const encoder = service.device.createCommandEncoder();
    __pass__(service, encoder, service.blackTexture, null, null);
    service.device.queue.submit([encoder.finish()]);
  }
  return service.blackTexture;
}

function __createShader__(service, descriptor) {
  for (const parameter of descriptor.uniforms)
    if (
      parameter.type === 'bool' ||
      (parameter.kind === 'storage' && !Structures.isHostShareable(parameter.element))
    )
      throw new TypeError(
        `Shader parameter ${parameter.name}: booleans cannot cross the host/GPU boundary`,
      );
  if (service.cache.has(descriptor)) return service.cache.get(descriptor);
  const pipelines = new Map();
  let failure = null;
  const resources = descriptor.uniforms.filter(
    (parameter) => parameter.type === 'texture2d' || parameter.kind === 'storage',
  );
  const numeric = descriptor.uniforms.filter((parameter) => parameter.type !== 'texture2d');
  const expected = descriptor.uniforms.filter((parameter) => !parameter.automatic).length;
  const hasAutomatic = descriptor.uniforms.some((parameter) => parameter.automatic);
  const hasSampler =
    descriptor.hasSampler ?? resources.some((parameter) => parameter.type === 'texture2d');
  const prepare = (frameContext, values, target) => {
    __available__(service);
    if (!service.activeFrame || frameContext !== service.activeFrame.context)
      throw new Error('Shader calls require the current render context.');
    if (values.length !== expected)
      throw new TypeError(`Shader expects ${expected} parameter arguments`);
    if (hasAutomatic) {
      let supplied = 0;
      values = descriptor.uniforms.map((parameter) =>
        parameter.automatic ? Data.get(frameContext, parameter.name) : values[supplied++],
      );
    }
    const inputs = [];
    for (let i = 0; i < values.length; i++) {
      const parameter = descriptor.uniforms[i],
        value = values[i];
      if (parameter.kind === 'storage') {
        const state = Structures.collectionInfo(value);
        if (
          !state ||
          Data.dataKind(value) !== (parameter.collection || 'array') ||
          !Structures.sameElement(state.element, parameter.element)
        )
          throw new TypeError(
            `Shader parameter ${parameter.name}: wrong array element struct/type or collection kind`,
          );
        if (
          parameter.capacity !== undefined &&
          (!state.bounded || state.capacity !== parameter.capacity)
        )
          throw new TypeError(
            `Shader parameter ${parameter.name}: expected array capacity ${parameter.capacity}`,
          );
        if (!Structures.isHostShareable(state.element))
          throw new TypeError(
            `Shader parameter ${parameter.name}: booleans cannot cross the host/GPU boundary`,
          );
        const bytes = Math.max(state.stride * 4, state.capacity * state.stride * 4);
        if (state.length > 16777216)
          throw new RangeError('Buffer length exceeds exact f32 indexing range');
        if (bytes > service.device.limits.maxStorageBufferBindingSize)
          throw new RangeError('Buffer exceeds GPU storage binding limit');
        inputs.push({ state, value, bytes });
      } else if (parameter.type === 'texture2d') {
        Types.assertType(value, parameter.type, `Shader parameter ${parameter.name}`);
        const handle = service.handles.get(value);
        if (!handle || (!handle.persistent && handle.frame !== service.activeFrame))
          throw new TypeError(
            `Shader parameter ${parameter.name}: texture must come from this runtime's current frame or its persistent resources`,
          );
        inputs.push(handle.texture);
      } else {
        Types.assertType(
          parameter.type === 'f32' && typeof value === 'number' ? Math.fround(value) : value,
          parameter.type,
          `Shader parameter ${parameter.name}`,
        );
        const components = NumericTypes.scalarTypes.includes(parameter.type)
          ? [value]
          : Data.values(value);
        if (Array.from(components).some((component) => !Number.isFinite(Math.fround(component)))) {
          throw new TypeError(
            `Shader parameter ${parameter.name}: components must be finite f32 numbers`,
          );
        }
      }
    }
    if (failure) throw failure;
    let pipeline = pipelines.get(target);
    if (!pipeline) {
      service.device.pushErrorScope('validation');
      try {
        const module = service.device.createShaderModule({ code: descriptor.wgsl });
        const bindGroupLayout = service.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            ...resources.map((parameter, i) =>
              parameter.kind === 'storage'
                ? {
                    binding: i + 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'read-only-storage' },
                  }
                : {
                    binding: i + 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                  },
            ),
            ...(hasSampler
              ? [
                  {
                    binding: resources.length + 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' },
                  },
                ]
              : []),
          ],
        });
        pipeline = service.device.createRenderPipeline({
          layout: service.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
          vertex: { module, entryPoint: 'vertex' },
          fragment: { module, entryPoint: 'fragment', targets: [target] },
        });
        pipelines.set(target, pipeline);
        service.stats.shaderCompilations++;
      } finally {
        service.device.popErrorScope().then((error) => {
          if (error) {
            failure = Trace.locate(
              new Error(`Shader compilation failed: ${error.message}`),
              descriptor.source,
              descriptor.start,
              descriptor.end,
            );
            if (!service.destroyed) service.reportError(failure);
          }
        });
      }
    }
    const frame = service.activeFrame,
      index = frame.drawCount++;
    const size =
      16 *
      (1 +
        numeric.reduce(
          (slots, parameter) =>
            slots +
            (parameter.type.startsWith('mat') ? NumericTypes.matrixSize(parameter.type) : 1),
          0,
        ));
    if (!service.slots[index] || service.slots[index].size < size) {
      service.slots[index]?.buffer.destroy();
      if (service.slots[index])
        for (const storage of service.slots[index].storage.values()) storage.buffer.destroy();
      service.slots[index] = {
        size,
        buffer: service.device.createBuffer({
          size,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        groups: new Map(),
        storage: new Map(),
        data: new Float32Array(size / 4),
      };
    }
    const slot = service.slots[index];
    for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
      if (resources[resourceIndex].kind !== 'storage') continue;
      const input = inputs[resourceIndex];
      let cached = slot.storage.get(resourceIndex);
      if (!cached || cached.bytes < input.bytes) {
        cached?.buffer.destroy();
        cached = {
          bytes: input.bytes,
          buffer: service.device.createBuffer({
            size: input.bytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          }),
        };
        slot.storage.set(resourceIndex, cached);
      }
      if (cached.value !== input.value || cached.revision !== input.state.revision) {
        const data = Structures.packCollection(input.state);
        if (data.length) service.device.queue.writeBuffer(cached.buffer, 0, data);
        cached.value = input.value;
        cached.revision = input.state.revision;
      }
      inputs[resourceIndex] = cached.buffer;
    }
    const data = slot.data;
    const integerData = (slot.__integers__ ??= new DataView(data.buffer));
    data.fill(0);
    data.set([service.width, service.height, frame.t, frame.dt]);
    let uniformIndex = 0;
    descriptor.uniforms.forEach((parameter, i) => {
      if (parameter.type === 'texture2d') return;
      if (parameter.kind === 'storage') {
        const state = Structures.collectionInfo(values[i]);
        data.set([state.length, state.capacity], 4 + uniformIndex++ * 4);
        return;
      }
      if (parameter.type.startsWith('mat')) {
        const dimension = NumericTypes.matrixSize(parameter.type);
        for (let column = 0; column < dimension; column++) {
          data.set(
            Data.values(values[i]).slice(column * dimension, (column + 1) * dimension),
            4 + uniformIndex++ * 4,
          );
        }
      } else {
        const component = NumericTypes.vectorInfo(parameter.type)?.scalar || parameter.type;
        const components = NumericTypes.scalarTypes.includes(parameter.type)
          ? [values[i]]
          : Data.values(values[i]);
        const offset = 4 + uniformIndex++ * 4;
        if (component === 'i32' || component === 'u32')
          components.forEach((value, index) =>
            integerData[component === 'i32' ? 'setInt32' : 'setUint32'](
              (offset + index) * 4,
              value,
              true,
            ),
          );
        else data.set(components, offset);
      }
    });
    service.device.queue.writeBuffer(slot.buffer, 0, data);
    let cached = slot.groups.get(pipeline);
    if (!cached || inputs.some((texture, i) => texture !== cached.inputs[i])) {
      cached = {
        inputs,
        group: service.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: slot.buffer } },
            ...inputs.map((input, i) => ({
              binding: i + 1,
              resource:
                resources[i].kind === 'storage' ? { buffer: input } : __view__(service, input),
            })),
            ...(hasSampler ? [{ binding: resources.length + 1, resource: service.sampler }] : []),
          ],
        }),
      };
      slot.groups.set(pipeline, cached);
    }
    return { pipeline, group: cached.group, inputs };
  };
  const shader = (frameContext, ...values) => {
    const draw = prepare(frameContext, values, service.__replaceTarget__);
    const frame = service.activeFrame;
    __finishLayers__(service, frame);
    const texture = __target__(service, frame.pool, frame.targetCount++);
    __pass__(service, __encoder__(service, frame), texture, draw.pipeline, draw.group);
    frame.output = texture;
    const handle = Types.textureHandle(service.width, service.height);
    service.handles.set(handle, { texture, frame });
    Data.put(frame.context, 'before', handle);
    return handle;
  };
  service.cache.set(descriptor, shader);
  service.__layers__.set(shader, { prepare, descriptor });
  return shader;
}

function __finishLayers__(service, frame) {
  frame.__layerPass__?.end();
  frame.__layerPass__ = null;
  if (frame.__clearColor__) {
    __pass__(service, __encoder__(service, frame), frame.output, null, null, frame.__clearColor__);
    frame.__clearColor__ = null;
  }
}

// Generic clipped shader composition. UI layout and paint policy stay in Lisp.
function __layer__(service, context, bounds, shader, values) {
  return __layerRegions__(service, context, [bounds], shader, values);
}

function __layerRegions__(service, context, regions, shader, values) {
  __available__(service);
  const frame = service.activeFrame;
  if (!frame || frame.context !== context)
    throw new Error('layer requires the current render context');
  Types.assertType(regions, 'list', 'layer-regions bounds');
  const bound = Text.shaderBinding(shader);
  if (bound) {
    if (values.length !== bound.parameterCount)
      throw new TypeError(`Shader expects ${bound.parameterCount} parameter arguments`);
    values = [...values, ...bound.hidden];
    shader = bound.shader;
  }
  const registered = service.__layers__.get(shader);
  if (!registered) throw new TypeError('layer expects a shader from this runtime');
  if (
    registered.descriptor.uniforms.some(
      (parameter) => parameter.automatic && parameter.name === 'before',
    )
  )
    throw new TypeError(
      'layer shaders cannot sample before; return a straight-alpha color instead',
    );
  const clips = [];
  for (const bounds of Data.values(regions)) {
    Types.assertType(bounds, 'vec4f', 'layer bounds');
    // Pixel centers decide coverage. Shared fractional boundaries must not overlap.
    const x = Math.max(0, Math.min(service.width, Math.ceil(bounds.x - 0.5)));
    const y = Math.max(0, Math.min(service.height, Math.ceil(bounds.y - 0.5)));
    const right = Math.max(
      x,
      Math.min(service.width, Math.ceil(bounds.x + Math.max(0, bounds.z) - 0.5)),
    );
    const bottom = Math.max(
      y,
      Math.min(service.height, Math.ceil(bounds.y + Math.max(0, bounds.w) - 0.5)),
    );
    if (right !== x && bottom !== y) clips.push([x, y, right - x, bottom - y]);
  }
  if (!clips.length) return null;
  const draw = registered.prepare(context, values, service.__layerTarget__);
  if (draw.inputs.includes(frame.output))
    throw new TypeError('layer cannot sample the texture it is painting');
  if (!frame.__layerPass__) {
    const existing = frame.output;
    frame.output ??= __target__(service, frame.pool, frame.targetCount++);
    frame.__layerPass__ = __encoder__(service, frame).beginRenderPass({
      colorAttachments: [
        {
          view: __view__(service, frame.output),
          clearValue: frame.__clearColor__ || [0, 0, 0, 0],
          loadOp: frame.__clearColor__ || !existing ? 'clear' : 'load',
          storeOp: 'store',
        },
      ],
    });
    frame.__clearColor__ = null;
    if (!existing) {
      const handle = Types.textureHandle(service.width, service.height);
      service.handles.set(handle, { texture: frame.output, frame });
      Data.put(frame.context, 'before', handle);
    }
  }
  const pass = frame.__layerPass__;
  pass.setPipeline(draw.pipeline);
  pass.setBindGroup(0, draw.group);
  for (const clip of clips) {
    pass.setScissorRect(...clip);
    pass.draw(3);
  }
  return null;
}

function __render__(service, callback, dt = 0, t = 0) {
  __available__(service);
  if (service.activeFrame) throw new Error('Cannot start a render frame inside another frame.');
  service.prepare?.(service.device.limits.maxTextureDimension2D);
  __resize__(service);
  const frame = {
    context: Data.dict('t', t, 'dt', dt, 'w', service.width, 'h', service.height),
    encoder: null,
    pool: service.completed ? 1 - service.completed.pool : 0,
    drawCount: 0,
    targetCount: 0,
    output: null,
    dt,
    t,
  };
  const before = Types.textureHandle(service.width, service.height);
  service.handles.set(before, {
    texture: service.completed?.texture || __initialBefore__(service),
    frame,
  });
  Data.put(frame.context, 'before', before);
  service.activeFrame = frame;
  try {
    callback?.(frame.context);
    __finishLayers__(service, frame);
    if (!frame.output && service.completed && !service.needsPresent()) return;
    __present__(service, __encoder__(service, frame), frame.output || service.completed?.texture);
    service.device.queue.submit([frame.encoder.finish()]);
    if (frame.output) service.completed = { texture: frame.output, pool: frame.pool };
    service.painted?.();
  } catch (error) {
    __finishLayers__(service, frame);
    // Discard recorded passes and keep the last completed image visible.
    const encoder = service.device.createCommandEncoder();
    __present__(service, encoder, service.completed?.texture);
    service.device.queue.submit([encoder.finish()]);
    service.painted?.();
    throw error;
  } finally {
    service.activeFrame = null;
  }
}

function __clear__(service, ...color) {
  if (color.length === 0) color = [0, 0, 0];
  if (color.length === 1) {
    const value = color[0];
    if (typeof value === 'number') color = [value, value, value];
    else if (['vec3f', 'vec4f'].includes(Data.dataKind(value))) color = [...Data.values(value)];
    else
      throw new TypeError(
        'clear expects a numeric scalar, vec3f, vec4f, or three or four numeric channels',
      );
  }
  if (color.length !== 3 && color.length !== 4)
    throw new TypeError(
      'clear expects a numeric scalar, vec3f, vec4f, or three or four numeric channels',
    );
  if (color.length === 3) color.push(1);
  for (let i = 0; i < color.length; i++) {
    if (
      typeof color[i] !== 'number' ||
      !Number.isFinite(color[i]) ||
      color[i] < 0 ||
      color[i] > 1
    ) {
      throw new TypeError(`clear: channel ${i + 1} must be a finite number between 0 and 1`);
    }
  }
  if (service.activeFrame) return __clearFrame__(service, color);
  __render__(service, () => __clearFrame__(service, color));
}

function __clearFrame__(service, color) {
  const frame = service.activeFrame;
  __finishLayers__(service, frame);
  const texture = __target__(service, frame.pool, frame.targetCount++);
  frame.output = texture;
  // The first layer can consume this clear in its own pass. Ordinary shader reads flush it first.
  frame.__clearColor__ = color;
  const handle = Types.textureHandle(service.width, service.height);
  service.handles.set(handle, { texture, frame });
  Data.put(frame.context, 'before', handle);
  return handle;
}

function __createText__(service, text) {
  __available__(service);
  const fontAvailability = new Map();
  const fontState = text.runs.map((run) => {
    const font = `${run.size}px ${run.font}`;
    if (!fontAvailability.has(font))
      fontAvailability.set(font, globalThis.document?.fonts?.check(font) ?? true);
    return fontAvailability.get(font);
  });
  const key = JSON.stringify([text, fontState]);
  if (service.textCache.has(key)) {
    const cached = service.textCache.get(key);
    service.textCache.delete(key);
    service.textCache.set(key, cached);
    return Data.reCopy(Data.dict(...cached.fields));
  }
  const raster = Text.rasterizeText(text, {
    maxSize: service.device.limits.maxTextureDimension2D,
    cache: service.textLineCache,
  });
  const texture = service.device.createTexture({
    size: [raster.width, raster.height],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  try {
    // Store straight alpha so ordinary shader color multiplication remains useful.
    service.device.queue.copyExternalImageToTexture(
      { source: raster.canvas },
      { texture, premultipliedAlpha: false },
      [raster.width, raster.height],
    );
  } catch (error) {
    texture.destroy();
    throw error;
  }
  const handle = Types.textureHandle(raster.width, raster.height);
  service.handles.set(handle, { texture, persistent: true });
  service.persistentTextures.add(texture);
  service.textureFinalizer.register(handle, texture);
  service.stats.textRasterizations++;
  const fields = [
    'texture',
    handle,
    'w',
    raster.width,
    'h',
    raster.height,
    'wh',
    Data.vector(2, [raster.width, raster.height]),
    'baseline',
    raster.baseline,
    'ink',
    Data.dict('top', raster.inkTop, 'bottom', raster.inkBottom),
    'origin',
    Data.dict('x', raster.offsetX, 'y', raster.offsetY),
    'lines',
    raster.lineCount,
    'content',
    text.runs.map((run) => run.text).join(''),
  ];
  const bytes = raster.width * raster.height * 4;
  service.textCache.set(key, { fields, bytes });
  service.textCacheBytes += bytes;
  while (
    service.textCache.size > 1 &&
    (service.textCache.size > 128 || service.textCacheBytes > 32 * 1024 * 1024)
  ) {
    const oldest = service.textCache.keys().next().value;
    service.textCacheBytes -= service.textCache.get(oldest).bytes;
    service.textCache.delete(oldest);
  }
  return Data.reCopy(Data.dict(...fields));
}

async function __imageMips__(service, texture) {
  if (texture.mipLevelCount <= 1) return;
  // Average the exact source footprint, including odd dimensions and transparent texels.
  service.__imageMipPipeline__ ??= service.device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: service.presentModule, entryPoint: 'vertex' },
    fragment: {
      module: service.device.createShaderModule({
        code: `
        @group(0) @binding(0) var source: texture_2d<f32>;
        @fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
          let dimensions = textureDimensions(source, 0);
          let ratio = vec2f(dimensions) / vec2f(max(dimensions / vec2u(2u), vec2u(1u)));
          let low = floor(p.xy) * ratio;
          let high = low + ratio;
          let start = vec2i(floor(low));
          var color = vec4f(0f);
          for (var y = 0i; y < 3i; y++) {
            for (var x = 0i; x < 3i; x++) {
              let index = start + vec2i(x, y);
              let coverage = max(vec2f(0f), min(high, vec2f(index) + vec2f(1f)) - max(low, vec2f(index)));
              let weight = coverage.x * coverage.y;
              if (weight > 0f) {
                let pixel = textureLoad(source, index, 0);
                color += vec4f(pixel.rgb * pixel.a, pixel.a) * weight;
              }
            }
          }
          if (color.a > 0f) { return vec4f(color.rgb / color.a, color.a / (ratio.x * ratio.y)); }
          return vec4f(0f);
        }`,
      }),
      entryPoint: 'fragment',
      targets: [{ format: 'rgba8unorm' }],
    },
  });
  const pipeline = await service.__imageMipPipeline__;
  __available__(service);
  const encoder = service.device.createCommandEncoder();
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const group = service.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
  service.device.queue.submit([encoder.finish()]);
}

function __loadImage__(service, url, fetchSource = (...args) => globalThis.fetch(...args)) {
  __available__(service);
  if (typeof url !== 'string') throw new TypeError('image expects a URL string');
  if (service.__images__.has(url)) return service.__images__.get(url);
  const pending = (async () => {
    const response = await fetchSource(url);
    if (!response.ok) throw new Error(`Image request failed (${response.status}): ${url}`);
    const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none' });
    try {
      __available__(service);
      if (Math.max(bitmap.width, bitmap.height) > service.device.limits.maxTextureDimension2D)
        throw new RangeError('Image exceeds GPU texture dimension limit');
      const texture = service.device.createTexture({
        size: [bitmap.width, bitmap.height],
        mipLevelCount: 1 + Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))),
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      try {
        service.device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture, premultipliedAlpha: false },
          [bitmap.width, bitmap.height],
        );
        await __imageMips__(service, texture);
      } catch (error) {
        texture.destroy();
        throw error;
      }
      const handle = Types.textureHandle(bitmap.width, bitmap.height);
      service.handles.set(handle, { texture, persistent: true });
      service.persistentTextures.add(texture);
      service.textureFinalizer.register(handle, texture);
      return handle;
    } finally {
      bitmap.close();
    }
  })();
  service.__images__.set(url, pending);
  pending.catch(() => {
    if (service.__images__.get(url) === pending) service.__images__.delete(url);
  });
  return pending;
}

function __resetScene__(service) {
  for (const slot of service.slots) slot.groups.clear();
}

function __destroy__(service) {
  if (service.destroyed) return;
  service.destroyed = true;
  service.loss.target = null;
  service.textCache.clear();
  service.__images__.clear();
  service.textCacheBytes = 0;
  service.textLineCache.measure.clear();
  service.textLineCache.paint.clear();
  globalThis.document?.fonts?.removeEventListener?.('loadingdone', service.invalidateFonts);
  for (const texture of service.persistentTextures) texture.destroy();
  service.persistentTextures.clear();
  __resetTextures__(service);
  for (const slot of service.slots) {
    slot.buffer.destroy();
    for (const storage of slot.storage.values()) storage.buffer.destroy();
  }
  service.context?.unconfigure();
  service.device.removeEventListener('uncapturederror', service.uncapturedError);
  if (service.ownsDevice) service.device.destroy();
}

export const Graphics = {
  new: __createGraphics__,
  createShader: __createShader__,
  createText: __createText__,
  loadImage: __loadImage__,
  render: __render__,
  resetScene: __resetScene__,
  publish(service, destination, handle) {
    __available__(service);
    __available__(destination);
    if (service.device !== destination.device) throw new TypeError('Output requires a shared GPU device');
    destination.handles.set(handle, { texture: service.completed?.texture || __initialBefore__(service), persistent: true });
    Data.registerTextureSize(handle, service.width, service.height);
  },
  destroy: __destroy__,
  clear: __clear__,
  layer: (service, context, bounds, shader, ...values) =>
    __layer__(service, context, bounds, shader, values),
  layerRegions: (service, context, regions, shader, ...values) =>
    __layerRegions__(service, context, regions, shader, values),
};
