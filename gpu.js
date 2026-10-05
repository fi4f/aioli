import { rgba, pixelCoverageWGSL } from './shader.js';
import { binCommands, GLYPH_WIDTH, GLYPH_HEIGHT } from './drawing.js';

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
${quad}
${pixelCoverageWGSL}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = floor(pos.xy);
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
      let scenePosition = clamp(vec2i(relative / command.bounds.zw * vec2f(320, 240)), vec2i(0), vec2i(319, 239));
      if (kind == 4u) { paint = textureLoad(scene, scenePosition, 0); }
      else { paint = textureLoad(image, scenePosition, 0); }
    }
    if (kind == 6u) {
      let dimensions = textureDimensions(asset);
      let coordinate = clamp(vec2u(relative / command.bounds.zw * vec2f(dimensions)), vec2u(0), dimensions - vec2u(1));
      paint = textureLoad(asset, vec2i(coordinate), 0);
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
    // Rasterization is a host font service. Visible text is evaluated by WebGPU.
    const atlas = document.createElement('canvas');
    atlas.width = 16 * GLYPH_WIDTH;
    atlas.height = 6 * GLYPH_HEIGHT;
    const ctx = atlas.getContext('2d');
    ctx.font = '13px Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'white';
    for (let i = 0; i < 95; i++)
      ctx.fillText(
        String.fromCharCode(i + 32),
        (i % 16) * GLYPH_WIDTH,
        Math.floor(i / 16) * GLYPH_HEIGHT + 1,
      );
    r.atlas = device.createTexture({
      size: [atlas.width, atlas.height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: atlas }, { texture: r.atlas }, [
      atlas.width,
      atlas.height,
    ]);
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
      ],
    });
    r.uiPipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [r.uiLayout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: r.format }] },
    });
    return r;
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
  draw(drawList, time, state) {
    // Pass 1 renders the game texture. Pass 2 samples it among editor commands.
    const device = this.device,
      width = drawList.width,
      height = drawList.height;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const floats = new Float32Array(Math.max(20, drawList.commands.length * 20));
    drawList.commands.forEach((c, i) =>
      floats.set([...c.bounds, ...c.color, ...c.detail, ...c.meta, ...c.clip], i * 20),
    );
    const binned = binCommands(drawList.commands, width, height);
    device.queue.writeBuffer(this.buffer('commandBuffer', floats.byteLength), 0, floats);
    device.queue.writeBuffer(this.buffer('binBuffer', binned.data.byteLength), 0, binned.data);
    device.queue.writeBuffer(this.screen, 0, new Float32Array([width, height, binned.columns, 0]));
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
        ],
      });
      this.bindDirty = false;
    }
    const encoder = device.createCommandEncoder();
    // Independent uniforms/textures prevent an image recipe from replacing the
    // game shader. Both previews are evaluated by their own fullscreen quad.
    for (const [pipeline, shader, texture, uniform, bind, clock] of [
      [this.scenePipeline, this.shader, this.sceneTexture, this.uniform, this.sceneBind, time],
      [
        this.imagePipeline,
        this.imageShader,
        this.imageTexture,
        this.imageUniform,
        this.imageBind,
        0,
      ],
    ]) {
      if (!pipeline) continue;
      const uniforms = new Float32Array(256);
      uniforms.set([clock, 320, 240, 0]);
      shader.params.forEach(({ key, kind }, i) => {
        if (kind === 'color') uniforms.set(rgba(state[key]), (i + 1) * 4);
        else {
          const v = Number(state[key]);
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
    // 320 RGBA pixels = 1280 bytes, already aligned to WebGPU's 256-byte rows.
    const buffer = this.device.createBuffer({
        size: 1280 * 240,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: generated ? this.imageTexture : this.sceneTexture },
      { buffer, bytesPerRow: 1280 },
      { width: 320, height: 240 },
    );
    this.device.queue.submit([encoder.finish()]);
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8ClampedArray(buffer.getMappedRange().slice(0));
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      canvas.getContext('2d').putImageData(new ImageData(pixels, 320, 240), 0, 0);
      return await new Promise((resolve) => canvas.toBlob(resolve));
    } finally {
      buffer.unmap();
      buffer.destroy();
    }
  }
}
