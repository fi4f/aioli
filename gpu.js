import { rgba, pixelCoverageWGSL } from './shader.js';
import { binCommands, GLYPH_WIDTH, GLYPH_HEIGHT } from './drawing.js';

// Lisp layout and input stay in CSS pixels; only the renderer uses device pixels.
export function displayMetrics(width, height, ratio = 1, limit = 8192) {
  const density = Math.min(
    Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
    limit / Math.max(1, width, height),
  );
  const physicalWidth = Math.max(1, Math.round(width * density));
  const physicalHeight = Math.max(1, Math.round(height * density));
  return {
    width: physicalWidth,
    height: physicalHeight,
    scaleX: physicalWidth / Math.max(1, width),
    scaleY: physicalHeight / Math.max(1, height),
    density,
    glyphWidth: Math.ceil(GLYPH_WIDTH * density),
    glyphHeight: Math.ceil(GLYPH_HEIGHT * density),
  };
}

export function deviceCommands(commands, metrics) {
  const { scaleX: sx, scaleY: sy, glyphWidth, glyphHeight } = metrics;
  const bounds = (b) => [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy];
  return commands.map((c) => {
    const kind = c.meta[0];
    const detail =
      kind === 3
        ? [
            (c.detail[0] / GLYPH_WIDTH) * glyphWidth,
            (c.detail[1] / GLYPH_HEIGHT) * glyphHeight,
            GLYPH_WIDTH * metrics.density,
            GLYPH_HEIGHT * metrics.density,
          ]
        : kind === 2
          ? bounds(c.detail)
          : c.detail;
    return {
      ...c,
      bounds: bounds(c.bounds),
      clip: bounds(c.clip),
      detail,
      meta: kind === 2 ? [kind, c.meta[1] * Math.min(sx, sy), ...c.meta.slice(2)] : c.meta,
    };
  });
}

const quad = `@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
  );
  return vec4f(corners[index], 0, 1);
}`;
// Commands and bins mirror drawing.js. Only a fullscreen quad is submitted;
// shape coverage, glyph lookup, and game texture sampling happen per pixel.
const uiShader = `
struct Command { bounds: vec4f, color: vec4f, detail: vec4f, flags: vec4f, clip: vec4f }
@group(0) @binding(0) var<storage,read> commands: array<Command>;
@group(0) @binding(1) var<storage,read> bins: array<u32>;
@group(0) @binding(2) var<uniform> screen: vec4f;
@group(0) @binding(3) var glyphs: texture_2d<f32>;
@group(0) @binding(6) var asset: texture_2d<f32>;
@group(0) @binding(7) var icons: texture_2d<f32>;
@group(0) @binding(8) var iconSampler: sampler;
@group(0) @binding(9) var<storage,read> pixelData: array<vec4f>;
@group(0) @binding(10) var surfaces: texture_2d_array<f32>;
// PIXEL_FUNCTIONS
${quad}
${pixelCoverageWGSL}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = pos.xy;
  let tile = vec2u(p / 32.0);
  let bin = (tile.y * u32(screen.z) + tile.x) * 2u;
  let offset = bins[bin];
  let count = bins[bin + 1u];
  var color = vec4f(0, 0, 0, 1);

  // Each tile's index list retains painter order from the Lisp draw stream.
  for (var i = 0u; i < count; i++) {
    let command = commands[bins[offset + i]];
    if (any(p < command.clip.xy) || any(p >= command.clip.xy + command.clip.zw) ||
        any(p < command.bounds.xy) || any(p >= command.bounds.xy + command.bounds.zw)) {
      continue;
    }
    let relative = p - command.bounds.xy;
    var paint = command.color;
    let kind = u32(command.flags.x);

    if (kind == 1u) {
      let center = command.bounds.xy + command.bounds.zw * 0.5;
      if (cover_circle(p, center, command.bounds.z * 0.5) < 0.5) { continue; }
    }
    if (kind == 2u) {
      if (cover_line(p, command.detail.xy, command.detail.zw, command.flags.y) < 0.5) { continue; }
    }
    if (kind == 3u) {
      let glyphPosition = vec2i(command.detail.xy + floor(relative / command.bounds.zw * command.detail.zw));
      paint.a *= textureLoad(glyphs, glyphPosition, 0).a;
    }
    if (kind == 6u) {
      let dimensions = textureDimensions(asset);
      let coordinate = clamp(vec2u(relative / command.bounds.zw * vec2f(dimensions)), vec2u(0), dimensions - vec2u(1));
      paint = textureLoad(asset, vec2i(coordinate), 0);
    }

    if (kind == 7u) {
      let dimensions = vec2f(textureDimensions(icons));
      let cell = screen.w;
      let slot = u32(command.detail.x);
      let atlasPosition = vec2f(f32(slot % 16u) * cell + 1.0, f32(slot / 16u) * cell + 1.0) + relative / command.bounds.zw * (cell - 2.0);
      paint.a *= textureSampleLevel(icons, iconSampler, atlasPosition / dimensions, 0.0).a;
    }

    if (kind == 8u) {
      let localPosition = relative / command.bounds.zw * command.detail.xy;
      // PIXEL_DISPATCH
      paint.a *= command.detail.z;
    }
    if (kind == 9u) {
      let coordinate = clamp(vec2i(relative / command.bounds.zw * command.detail.xy), vec2i(0), vec2i(command.detail.xy) - vec2i(1));
      paint = textureLoad(surfaces, coordinate, i32(command.detail.z), 0);
    }
    let alpha = clamp(paint.a, 0.0, 1.0);
    var rgb = mix(color.rgb, paint.rgb, alpha);
    if (command.flags.z == 1.0) {
      rgb = color.rgb + paint.rgb * alpha;
    } else if (command.flags.z == 2.0) {
      rgb = mix(color.rgb, color.rgb * paint.rgb, alpha);
    }
    color = vec4f(rgb, alpha + color.a * (1.0 - alpha));
  }
  return color;
}`;

/** Native GPU resources; editor layout and widget behavior live in Lisp. */
export class GPUHost {
  static async create(canvas, onError) {
    if (!navigator.gpu)
      throw new Error(
        'WebGPU is unavailable. Use a browser with WebGPU support on localhost or HTTPS.',
      );
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const device = await adapter.requestDevice(),
      r = new GPUHost();
    r.device = device;
    r.onError = onError;
    r.pixelPipelines = new Map();
    r.pendingPixels = new Map();
    r.pixelFailures = new Map();
    r.canvas = canvas;
    r.context = canvas.getContext('webgpu');
    r.format = navigator.gpu.getPreferredCanvasFormat();
    r.context.configure({ device, format: r.format, alphaMode: 'opaque' });
    device.lost.then((info) =>
      onError(`WebGPU device lost: ${info.message || info.reason}. Reload to reconnect.`, true),
    );
    device.addEventListener('uncapturederror', (e) => onError(e.error.message));
    // A valid placeholder binding exists before any project image is opened.
    r.assetTexture = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    r.surfaceTextures = [];
    r.emptySurface = device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    r.screen = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    r.iconSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    r.updateAtlas(displayMetrics(1, 1, globalThis.devicePixelRatio));
    r.updateIconAtlas(displayMetrics(1, 1, globalThis.devicePixelRatio));
    const module = device.createShaderModule({ code: uiShader });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) throw new Error(errors.map((e) => e.message).join('\n'));
    r.uiLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        {
          binding: 10,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: '2d-array' },
        },
      ],
    });
    r.uiPipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [r.uiLayout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: r.format }] },
    });
    return r;
  }
  updateAtlas(metrics) {
    if (this.atlasDensity === metrics.density) return;
    this.glyphAtlases ??= new Map();
    const cached = this.glyphAtlases.get(metrics.density);
    if (cached) {
      this.atlas = cached;
      this.atlasDensity = metrics.density;
      this.bindDirty = true;
      return;
    }
    const { density, glyphWidth, glyphHeight } = metrics;
    const atlas = document.createElement('canvas');
    atlas.width = 16 * glyphWidth;
    atlas.height = 6 * glyphHeight;
    const ctx = atlas.getContext('2d');
    ctx.font = `${13 * density}px Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'white';
    for (let i = 0; i < 95; i++)
      ctx.fillText(
        String.fromCharCode(i + 32),
        (i % 16) * glyphWidth,
        Math.floor(i / 16) * glyphHeight + density,
      );
    const texture = this.device.createTexture({
      size: [atlas.width, atlas.height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: atlas }, { texture }, [
      atlas.width,
      atlas.height,
    ]);
    if (this.glyphAtlases.size >= 4) {
      const oldest = this.glyphAtlases.keys().next().value;
      this.glyphAtlases.get(oldest).destroy();
      this.glyphAtlases.delete(oldest);
    }
    this.glyphAtlases.set(density, texture);
    this.atlas = texture;
    this.atlasDensity = density;
    this.bindDirty = true;
  }
  setIcons(images) {
    for (const texture of this.iconAtlases?.values() ?? []) texture.destroy();
    this.iconAtlases = new Map();
    this.iconImages = images;
    this.iconDensity = null;
    this.bindDirty = true;
  }
  updateIconAtlas(metrics) {
    if (this.iconDensity === metrics.density) return;
    const cell = Math.ceil(16 * metrics.density) + 2;
    this.iconAtlases ??= new Map();
    const cached = this.iconAtlases.get(metrics.density);
    if (cached) {
      this.iconAtlas = cached;
      this.iconCell = cell;
      this.iconDensity = metrics.density;
      this.bindDirty = true;
      return;
    }
    const atlas = document.createElement('canvas');
    atlas.width = cell * 16;
    atlas.height = cell * Math.max(1, Math.ceil((this.iconImages?.length ?? 0) / 16));
    this.iconCell = cell;
    const context = atlas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    for (const [index, image] of (this.iconImages ?? []).entries())
      if (image)
        context.drawImage(
          image,
          (index % 16) * cell + 1,
          Math.floor(index / 16) * cell + 1,
          cell - 2,
          cell - 2,
        );
    const texture = this.device.createTexture({
      size: [atlas.width, atlas.height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: atlas }, { texture }, [
      atlas.width,
      atlas.height,
    ]);
    if (this.iconAtlases.size >= 4) {
      const oldest = this.iconAtlases.keys().next().value;
      this.iconAtlases.get(oldest).destroy();
      this.iconAtlases.delete(oldest);
    }
    this.iconAtlases.set(metrics.density, texture);
    this.iconAtlas = texture;
    this.iconDensity = metrics.density;
    this.bindDirty = true;
  }
  uploadAssetImage(bitmap) {
    const limit = this.device.limits.maxTextureDimension2D;
    if (bitmap.width > limit || bitmap.height > limit)
      throw new Error(`Image exceeds the GPU texture limit (${limit}px)`);
    const texture = this.device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [
      bitmap.width,
      bitmap.height,
    ]);
    this.assetTexture.destroy();
    this.assetTexture = texture;
    this.bindDirty = true;
  }
  buffer(name, size) {
    // Grow buffers geometrically and rebuild the bind group only when needed.
    if (!this[name] || this[name].size < size) {
      this[name]?.destroy();
      this[name] = this.device.createBuffer({
        size: Math.max(256, 2 ** Math.ceil(Math.log2(size))),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.bindDirty = true;
    }
    return this[name];
  }
  pixelSource(drawList) {
    const programs = [
      ...new Map(
        drawList.commands.filter((c) => c.pixel).map((c) => [c.pixel.shader.code, c.pixel.shader]),
      ).values(),
    ];
    if (programs.length > 32) throw new Error('Maximum 32 distinct pixel programs per frame');
    if (!programs.length) return { source: uiShader, programs };
    const signature = programs.map((program) => program.code).join('\0');
    this.pixelSources ??= new Map();
    if (this.pixelSources.has(signature)) return this.pixelSources.get(signature);
    const shader = programs[0];
    let helpers = shader.code
      .slice(shader.code.indexOf('struct Draw'), shader.code.indexOf('@vertex'))
      .replace(pixelCoverageWGSL, '');
    for (const helper of shader.extraHelpers ?? []) helpers = helpers.replace(helper, '');
    helpers +=
      '\n' + [...new Set(programs.flatMap((program) => program.extraHelpers ?? []))].join('\n');
    const functions = programs
      .map(
        (program, i) => `
      fn pixelEffect${i}(position: vec2f, base: u32) -> vec4f {
        var d=Draw(floor(position), vec4f(0.0), vec4f(1.0), 1.0, 0u);
        ${program.pixelBody.replace(/u\.data\[(\d+)\]/g, (_, slot) => `pixelData[base + ${slot}u]`)}
        return d.color;
      }`,
      )
      .join('\n');
    const dispatch = programs
      .map(
        (_, i) =>
          `if (u32(command.flags.y) == ${i}u) { paint = pixelEffect${i}(localPosition, u32(command.flags.w)); }`,
      )
      .join('\n');
    const result = {
      programs,
      source: uiShader
        .replace('// PIXEL_FUNCTIONS', helpers + functions)
        .replace('// PIXEL_DISPATCH', dispatch),
    };
    if (this.pixelSources.size >= 32)
      this.pixelSources.delete(this.pixelSources.keys().next().value);
    this.pixelSources.set(signature, result);
    return result;
  }
  async preparePixels(drawList, format = this.format) {
    for (const command of drawList.commands)
      if (command.surface) await this.preparePixels(command.surface, 'rgba8unorm');
    const { source, programs } = this.pixelSource(drawList);
    const key = format + source;
    if ((!programs.length && format === this.format) || this.pixelPipelines.has(key)) return;
    if (this.pixelFailures.has(key)) throw this.pixelFailures.get(key);
    if (this.pendingPixels.has(key)) return this.pendingPixels.get(key);
    const pending = (async () => {
      this.device.pushErrorScope('validation');
      const module = this.device.createShaderModule({ code: source });
      const validation = this.device.popErrorScope();
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === 'error');
      const error = await validation;
      if (errors.length || error)
        throw new Error(
          'pixels WGSL: ' + (errors.map((e) => e.message).join('\n') || error.message),
        );
      const pipeline = await this.device.createRenderPipelineAsync({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.uiLayout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      });
      if (this.pixelPipelines.size >= 32)
        this.pixelPipelines.delete(this.pixelPipelines.keys().next().value);
      this.pixelPipelines.set(key, pipeline);
    })();
    this.pendingPixels.set(key, pending);
    try {
      await pending;
    } catch (error) {
      if (this.pixelFailures.size >= 32)
        this.pixelFailures.delete(this.pixelFailures.keys().next().value);
      this.pixelFailures.set(key, error);
      throw error;
    } finally {
      this.pendingPixels.delete(key);
    }
  }
  draw(drawList, time, output = null, depth = 0) {
    // Composite shapes, assets, and nested pixel materials in drawing order.
    const device = this.device,
      metrics = displayMetrics(
        drawList.width,
        drawList.height,
        output ? 1 : globalThis.devicePixelRatio,
        device.limits.maxTextureDimension2D,
      ),
      { width, height } = metrics;
    const { source, programs } = this.pixelSource(drawList);
    const format = output?.format ?? this.format;
    const materialPipeline =
      !programs.length && format === this.format
        ? this.uiPipeline
        : this.pixelPipelines.get(format + source);
    if (!materialPipeline) {
      this.preparePixels(drawList, format).catch((e) => this.onError(e.message));
      return false;
    }
    // Each application gets actual logical pixels, independent of CSS size/DPR.
    // Layers let multiple surfaces keep their own painter order in the host.
    const surfaces = drawList.commands.filter((command) => command.surface);
    let surfaceTexture = this.emptySurface;
    if (surfaces.length) {
      const size = [
        Math.max(...surfaces.map((command) => command.surface.width)),
        Math.max(...surfaces.map((command) => command.surface.height)),
        surfaces.length,
      ];
      let cached = this.surfaceTextures[depth];
      if (!cached || size.some((value, index) => value !== cached.size[index])) {
        cached?.texture.destroy();
        cached = {
          size,
          texture: device.createTexture({
            size,
            format: 'rgba8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
          }),
        };
        this.surfaceTextures[depth] = cached;
      }
      surfaceTexture = cached.texture;
      for (let layer = 0; layer < surfaces.length; layer++) {
        const target = {
          format: 'rgba8unorm',
          createView: () =>
            surfaceTexture.createView({
              dimension: '2d',
              baseArrayLayer: layer,
              arrayLayerCount: 1,
            }),
        };
        if (!this.draw(surfaces[layer].surface, time, target, depth + 1)) return false;
      }
    }
    if (this.boundSurface !== surfaceTexture) {
      this.boundSurface = surfaceTexture;
      this.bindDirty = true;
    }
    // Child passes use density 1; restore the host's crisp UI glyph atlas.
    this.updateAtlas(metrics);
    this.updateIconAtlas(metrics);
    const pixelValues = [];
    const materialCommands = drawList.commands.map((command) => {
      if (command.surface)
        return {
          ...command,
          detail: [command.surface.width, command.surface.height, surfaces.indexOf(command), 0],
        };
      if (!command.pixel) return command;
      const { shader, values } = command.pixel;
      const base = pixelValues.length / 4;
      pixelValues.push(time, command.detail[0], command.detail[1], 0);
      for (const { key, kind } of shader.params)
        pixelValues.push(...(kind === 'color' ? rgba(values[key]) : [values[key], 0, 0, 0]));
      return {
        ...command,
        meta: [
          8,
          programs.findIndex((program) => program.code === shader.code),
          command.meta[2],
          base,
        ],
      };
    });
    device.queue.writeBuffer(
      this.buffer('pixelBuffer', Math.max(16, pixelValues.length * 4)),
      0,
      new Float32Array(pixelValues.length ? pixelValues : [0, 0, 0, 0]),
    );
    const commands = deviceCommands(materialCommands, metrics);
    if (!output && this.canvas.width !== width) this.canvas.width = width;
    if (!output && this.canvas.height !== height) this.canvas.height = height;
    const floats = new Float32Array(Math.max(20, commands.length * 20));
    commands.forEach((c, i) =>
      floats.set([...c.bounds, ...c.color, ...c.detail, ...c.meta, ...c.clip], i * 20),
    );
    const binned = binCommands(commands, width, height);
    device.queue.writeBuffer(this.buffer('commandBuffer', floats.byteLength), 0, floats);
    device.queue.writeBuffer(this.buffer('binBuffer', binned.data.byteLength), 0, binned.data);
    device.queue.writeBuffer(
      this.screen,
      0,
      new Float32Array([width, height, binned.columns, this.iconCell]),
    );
    if (this.bindDirty) {
      this.uiBind = device.createBindGroup({
        layout: this.uiLayout,
        entries: [
          { binding: 0, resource: { buffer: this.commandBuffer } },
          { binding: 1, resource: { buffer: this.binBuffer } },
          { binding: 2, resource: { buffer: this.screen } },
          { binding: 3, resource: this.atlas.createView() },
          { binding: 6, resource: this.assetTexture.createView() },
          { binding: 7, resource: this.iconAtlas.createView() },
          { binding: 8, resource: this.iconSampler },
          { binding: 9, resource: { buffer: this.pixelBuffer } },
          { binding: 10, resource: surfaceTexture.createView({ dimension: '2d-array' }) },
        ],
      });
      this.bindDirty = false;
    }
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: (output ?? this.context.getCurrentTexture()).createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(materialPipeline);
    pass.setViewport(0, 0, width, height, 0, 1);
    pass.setBindGroup(0, this.uiBind);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
    return true;
  }
  async snapshot(list, time = 0) {
    let output;
    if (list) {
      await this.preparePixels(list, 'rgba8unorm');
      output = this.device.createTexture({
        size: [list.width, list.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.draw(list, time, output);
    }
    const texture = output;
    const { width, height } = texture;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
    this.device.queue.submit([encoder.finish()]);
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(buffer.getMappedRange());
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++)
        pixels.set(
          mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4),
          row * width * 4,
        );
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
      return await new Promise((resolve) => canvas.toBlob(resolve));
    } finally {
      buffer.unmap();
      buffer.destroy();
      output?.destroy();
    }
  }
}
