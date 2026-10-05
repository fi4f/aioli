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
@group(0) @binding(4) var scene: texture_2d<f32>;
@group(0) @binding(5) var image: texture_2d<f32>;
@group(0) @binding(6) var asset: texture_2d<f32>;
@group(0) @binding(7) var icons: texture_2d<f32>;
@group(0) @binding(8) var iconSampler: sampler;
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
    if (kind == 4u || kind == 5u) {
      let dimensions = select(textureDimensions(image), textureDimensions(scene), kind == 4u);
      let scenePosition = clamp(vec2i(relative / command.bounds.zw * vec2f(dimensions)), vec2i(0), vec2i(dimensions) - vec2i(1));
      if (kind == 4u) { paint = textureLoad(scene, scenePosition, 0); }
      else { paint = textureLoad(image, scenePosition, 0); }
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
    r.canvas = canvas;
    r.context = canvas.getContext('webgpu');
    r.format = navigator.gpu.getPreferredCanvasFormat();
    r.context.configure({ device, format: r.format, alphaMode: 'opaque' });
    device.lost.then((info) =>
      onError(`WebGPU device lost: ${info.message || info.reason}. Reload to reconnect.`, true),
    );
    device.addEventListener('uncapturederror', (e) => onError(e.error.message));
    r.sceneTexture = device.createTexture({
      size: [320, 240],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    r.imageTexture = device.createTexture({
      size: [320, 240],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    // A valid placeholder binding exists before any project image is opened.
    r.assetTexture = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    r.imageUniform = device.createBuffer({
      size: 1024,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    r.uniform = device.createBuffer({
      size: 1024,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    r.sceneLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    r.sceneBind = device.createBindGroup({
      layout: r.sceneLayout,
      entries: [{ binding: 0, resource: { buffer: r.uniform } }],
    });
    r.imageBind = device.createBindGroup({
      layout: r.sceneLayout,
      entries: [{ binding: 0, resource: { buffer: r.imageUniform } }],
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
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
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
    this.atlas?.destroy();
    this.atlas = texture;
    this.atlasDensity = density;
    this.bindDirty = true;
  }
  setIcons(images) {
    this.iconImages = images;
    this.iconDensity = null;
    this.bindDirty = true;
  }
  updateIconAtlas(metrics) {
    if (this.iconDensity === metrics.density) return;
    const cell = Math.ceil(16 * metrics.density) + 2;
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
    this.iconAtlas?.destroy();
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
  async prepare(shader) {
    // A rejected live shader is a normal edit error, not a lost device. Capture
    // validation locally so it cannot poison the active program's error state.
    this.device.pushErrorScope('validation');
    const module = this.device.createShaderModule({ code: shader.code }),
      scope = this.device.popErrorScope();
    const info = await module.getCompilationInfo(),
      validation = await scope;
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length)
      throw new Error('WGSL: ' + errors.map((e) => `line ${e.lineNum}: ${e.message}`).join('\n'));
    if (validation) throw new Error('WGSL: ' + validation.message);
    return this.device.createRenderPipelineAsync({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.sceneLayout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    });
  }
  commit(pipeline, shader) {
    this.scenePipeline = pipeline;
    this.shader = shader;
  }
  commitImage(pipeline, shader) {
    this.imagePipeline = pipeline;
    this.imageShader = shader;
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
  resizeScene(width, height) {
    if (this.sceneTexture.width === width && this.sceneTexture.height === height) return;
    const previous = this.sceneTexture;
    this.sceneTexture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.bindDirty = true;
    previous.destroy();
  }
  draw(drawList, time, state, imageState = state) {
    // Pass 1 renders the game texture. Pass 2 samples it among editor commands.
    const device = this.device,
      metrics = displayMetrics(
        drawList.width,
        drawList.height,
        globalThis.devicePixelRatio,
        device.limits.maxTextureDimension2D,
      ),
      { width, height } = metrics;
    this.updateAtlas(metrics);
    this.updateIconAtlas(metrics);
    const commands = deviceCommands(drawList.commands, metrics);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
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
          { binding: 4, resource: this.sceneTexture.createView() },
          { binding: 5, resource: this.imageTexture.createView() },
          { binding: 6, resource: this.assetTexture.createView() },
          { binding: 7, resource: this.iconAtlas.createView() },
          { binding: 8, resource: this.iconSampler },
        ],
      });
      this.bindDirty = false;
    }
    const encoder = device.createCommandEncoder();
    // Independent uniforms/textures prevent an image recipe from replacing the
    // game shader. Both previews are evaluated by their own fullscreen quad.
    for (const [pipeline, shader, texture, uniform, bind, clock, parameters] of [
      [
        this.scenePipeline,
        this.shader,
        this.sceneTexture,
        this.uniform,
        this.sceneBind,
        time,
        state,
      ],
      [
        this.imagePipeline,
        this.imageShader,
        this.imageTexture,
        this.imageUniform,
        this.imageBind,
        0,
        imageState,
      ],
    ]) {
      if (!pipeline) continue;
      const uniforms = new Float32Array(256);
      uniforms.set([clock, texture.width, texture.height, 0]);
      shader.params.forEach(({ key, kind }, i) => {
        if (kind === 'color') uniforms.set(rgba(parameters[key]), (i + 1) * 4);
        else {
          const v = Number(parameters[key]);
          if (!Number.isFinite(v)) throw new Error(`Invalid shader parameter :${key}`);
          uniforms[(i + 1) * 4] = v;
        }
      });
      device.queue.writeBuffer(uniform, 0, uniforms);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(6);
      pass.end();
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.uiPipeline);
    pass.setBindGroup(0, this.uiBind);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  async snapshot(generated = false) {
    const texture = generated ? this.imageTexture : this.sceneTexture;
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
    }
  }
}
