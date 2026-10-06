import { rgba } from './shader.js';

export const GLYPH_WIDTH = 8,
  GLYPH_HEIGHT = 18;
const copy = (s) => ({ ...s, color: [...s.color], offset: [...s.offset], clip: [...s.clip] });
const vector = (v, n = 2) => {
  if (!Array.isArray(v) || v.length !== n || !v.every(Number.isFinite))
    throw new Error(`Drawing requires a finite ${n}D vector`);
  return v;
};
/**
 * Immediate drawing state and an ordered command stream for the editor quad.
 * Commands are five vec4 fields (80 bytes) mirrored by Command in gpu.js:
 * bounds=[x,y,w,h], color=RGBA, detail=shape/glyph data,
 * meta=[kind, extra, blendMode, reserved], clip=[x,y,w,h].
 * Kinds: 0 rectangle, 1 circle, 2 line, 3 glyph, 4 game, 5 generated image,
 * 6 asset preview, 7 theme-tinted icon mask, 8 nested GPU pixel material,
 * 9 application pixel buffer.
 */
export class DrawList {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // Host identity is transient and must not appear in serialized command snapshots.
    Object.defineProperties(this, {
      historyKey: { value: null, writable: true },
      historyAdvance: { value: true, writable: true },
    });
    this.commands = [];
    this.stack = [];
    this.state = {
      color: [1, 1, 1, 1],
      offset: [0, 0],
      opacity: 1,
      mode: 0,
      scale: 1,
      clip: [0, 0, width, height],
    };
  }
  scope() {
    this.stack.push(copy(this.state));
  }
  restore() {
    if (!this.stack.length) throw new Error('Drawing scope underflow');
    this.state = this.stack.pop();
  }
  fill(color) {
    const c = typeof color === 'string' ? rgba(color) : vector(color, color?.length);
    if (![3, 4].includes(c.length)) throw new Error('Fill needs RGB or RGBA');
    this.state.color = [...c.slice(0, 3), c[3] ?? 1];
  }
  point(p) {
    vector(p);
    return p.map((v, i) => v * this.state.scale + this.state.offset[i]);
  }
  // Capture settings now; subsequent fill/transform changes must not alter an
  // earlier command. The GPU preserves this painter order within every tile.
  emit(kind, bounds, detail = [0, 0, 0, 0], extra = 0) {
    if (this.commands.length >= 12000) throw new Error('Editor draw budget exceeded');
    if (!bounds.every(Number.isFinite) || !detail.every(Number.isFinite))
      throw new Error('Non-finite drawing bounds');
    if (bounds[2] <= 0 || bounds[3] <= 0) return;
    const s = this.state;
    this.commands.push({
      bounds,
      color: [...s.color.slice(0, 3), s.color[3] * s.opacity],
      detail,
      meta: [kind, extra, s.mode, 0],
      clip: [...s.clip],
    });
  }
  rect(origin, size) {
    const p = this.point(origin);
    vector(size);
    this.emit(0, [...p, ...size.map((v) => v * this.state.scale)]);
  }
  circle(center, radius) {
    const p = this.point(center),
      r = radius * this.state.scale;
    if (!Number.isFinite(r) || r < 0) throw new Error('Invalid circle radius');
    this.emit(1, [p[0] - r, p[1] - r, r * 2, r * 2]);
  }
  line(a, b, width) {
    a = this.point(a);
    b = this.point(b);
    width *= this.state.scale;
    if (!Number.isFinite(width) || width <= 0) throw new Error('Invalid line width');
    const pad = width / 2;
    this.emit(
      2,
      [
        Math.min(a[0], b[0]) - pad,
        Math.min(a[1], b[1]) - pad,
        Math.abs(a[0] - b[0]) + width,
        Math.abs(a[1] - b[1]) + width,
      ],
      [...a, ...b],
      width,
    );
  }
  // Glyph cells reference the fixed atlas created by GPUHost; this creates
  // coverage commands, not DOM text or geometry for each character.
  text(origin, value) {
    let [x, y] = this.point(origin),
      start = x;
    const scale = this.state.scale;
    for (const char of String(value).slice(0, 12000)) {
      if (char === '\n') {
        x = start;
        y += GLYPH_HEIGHT * scale;
        continue;
      }
      if (char === '\t') {
        x += GLYPH_WIDTH * 4 * scale;
        continue;
      }
      let code = char.charCodeAt(0);
      if (code < 32 || code > 126) code = 63;
      const glyph = code - 32;
      this.emit(
        3,
        [x, y, GLYPH_WIDTH * scale, GLYPH_HEIGHT * scale],
        [
          (glyph % 16) * GLYPH_WIDTH,
          Math.floor(glyph / 16) * GLYPH_HEIGHT,
          GLYPH_WIDTH,
          GLYPH_HEIGHT,
        ],
      );
      x += GLYPH_WIDTH * scale;
    }
  }
  clip(origin, size) {
    const p = this.point(origin);
    vector(size);
    size = size.map((value) => value * this.state.scale);
    const old = this.state.clip,
      x = Math.max(old[0], p[0]),
      y = Math.max(old[1], p[1]);
    this.state.clip = [
      x,
      y,
      Math.max(0, Math.min(old[0] + old[2], p[0] + size[0]) - x),
      Math.max(0, Math.min(old[1] + old[3], p[1] + size[1]) - y),
    ];
  }
  surface(origin, size, kind = 4) {
    const p = this.point(origin);
    vector(size);
    if (kind === 4 || kind === 5) {
      this.scope();
      this.fill('#000000');
      this.emit(0, [...p, ...size]);
      this.restore();
    } else this.emit(kind, [...p, ...size]);
  }
  /** Place an application's private command stream inside a host surface. */
  rasterComposite(list, origin, size) {
    const scale = Math.min(size[0] / list.width, size[1] / list.height);
    const previous = this.commands.length;
    this.emit(
      9,
      [...origin, list.width * scale, list.height * scale],
      [list.width, list.height, 0, 0],
    );
    if (this.commands.length > previous) this.commands.at(-1).surface = list;
  }

  /** Transform geometry directly, for previews that do not have a pixel canvas. */
  composite(list, origin, size) {
    const scale = Math.min(size[0] / list.width, size[1] / list.height);
    const point = (x, y) => [origin[0] + x * scale, origin[1] + y * scale];
    for (const command of list.commands) {
      const [x, y, w, h] = command.bounds;
      const [cx, cy, cw, ch] = command.clip;
      const left = Math.max(origin[0], origin[0] + cx * scale, this.state.clip[0]);
      const top = Math.max(origin[1], origin[1] + cy * scale, this.state.clip[1]);
      const right = Math.min(
        origin[0] + size[0],
        origin[0] + (cx + cw) * scale,
        this.state.clip[0] + this.state.clip[2],
      );
      const bottom = Math.min(
        origin[1] + size[1],
        origin[1] + (cy + ch) * scale,
        this.state.clip[1] + this.state.clip[3],
      );
      this.commands.push({
        ...command,
        bounds: [...point(x, y), w * scale, h * scale],
        meta:
          command.meta[0] === 2
            ? [2, command.meta[1] * scale, ...command.meta.slice(2)]
            : [...command.meta],
        detail:
          command.meta[0] === 2
            ? [...point(...command.detail.slice(0, 2)), ...point(...command.detail.slice(2))]
            : [...command.detail],
        clip: [left, top, Math.max(0, right - left), Math.max(0, bottom - top)],
      });
    }
  }
  pixels(program) {
    // The full logical canvas is a material surface. Scope/clip can bound it.
    const origin = this.point([0, 0]);
    const previous = this.commands.length;
    this.emit(
      8,
      [...origin, this.width * this.state.scale, this.height * this.state.scale],
      [this.width, this.height, this.state.opacity, 0],
    );
    if (this.commands.length > previous) this.commands.at(-1).pixel = program;
  }
  primitives() {
    return (this.api ??= {
      background: (color) => {
        this.scope();
        this.state.offset = [0, 0];
        this.state.scale = 1;
        this.fill(color);
        this.rect([0, 0], [this.width, this.height]);
        this.restore();
      },
      fill: (c) => this.fill(c),
      rect: (p, s) => this.rect(p, s),
      circle: (p, r) => this.circle(p, r),
      line: (a, b, w) => this.line(a, b, w),
      text: (p, s) => this.text(p, s),
      clip: (p, s) => this.clip(p, s),
      translate: (p) => {
        vector(p);
        this.state.offset = this.state.offset.map((v, i) => v + p[i] * this.state.scale);
      },
      scale: (n) => {
        if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid drawing scale');
        this.state.scale *= n;
      },
      opacity: (n) => {
        if (!Number.isFinite(n)) throw new Error('Invalid opacity');
        this.state.opacity = Math.min(1, Math.max(0, n));
      },
      blend: (mode) => {
        const modes = { over: 0, add: 1, multiply: 2 };
        if (!(mode in modes)) throw new Error('Invalid blend mode');
        this.state.mode = modes[mode];
      },
    });
  }
}

// Bins keep pixel evaluation local. Command order remains painter's order.
export function binCommands(commands, width, height, tile = 32) {
  // Two uints per tile describe its offset/count in the following index payload.
  // Clip before binning so offscreen commands never add per-pixel work.
  const columns = Math.ceil(width / tile),
    rows = Math.ceil(height / tile),
    bins = Array.from({ length: columns * rows }, () => []);
  commands.forEach((c, index) => {
    const b = c.bounds,
      k = c.clip,
      x0 = Math.max(0, b[0], k[0]),
      y0 = Math.max(0, b[1], k[1]),
      x1 = Math.min(width, b[0] + b[2], k[0] + k[2]),
      y1 = Math.min(height, b[1] + b[3], k[1] + k[3]);
    if (x1 <= x0 || y1 <= y0) return;
    for (let y = Math.floor(y0 / tile); y <= Math.floor((y1 - 0.001) / tile); y++)
      for (let x = Math.floor(x0 / tile); x <= Math.floor((x1 - 0.001) / tile); x++)
        bins[y * columns + x].push(index);
  });
  const header = bins.length * 2,
    total = header + bins.reduce((sum, b) => sum + b.length, 0),
    data = new Uint32Array(total);
  let offset = header;
  bins.forEach((bin, i) => {
    data[i * 2] = offset;
    data[i * 2 + 1] = bin.length;
    data.set(bin, offset);
    offset += bin.length;
  });
  return { data, columns, rows };
}
