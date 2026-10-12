import { Data } from './data.js';
import { Structures } from './structures.js';
const __shaderBindings__ = new WeakMap();

function __bindTextShader__(shader, labels, parameterCount) {
  const hidden = labels.flatMap((label) => {
    const origin = Data.get(label, 'origin');
    if (Data.dataKind(origin) !== 'dict' || Data.get(label, 'texture') === null)
      throw new TypeError(
        'Hoisted shader text requires a text renderer supplying a texture and bounds',
      );
    return [
      Data.get(label, 'texture'),
      Data.vector(
        4,
        ['w', 'h', 'baseline', 'lines'].map((key) => Data.get(label, key)),
      ),
      Data.vector(
        2,
        ['x', 'y'].map((key) => Data.get(origin, key)),
      ),
    ];
  });
  const bound = (context, ...args) => {
    if (args.length !== parameterCount)
      throw new TypeError(`Shader expects ${parameterCount} parameter arguments`);
    return shader(context, ...args, ...hidden);
  };
  __shaderBindings__.set(bound, { shader, hidden, parameterCount });
  return bound;
}

const __fontWeights__ = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};
const __resolutions__ = { half: 0.5, standard: 1, double: 2 };
const __textNamedOptions__ = {
  resolution: Object.keys(__resolutions__),
  weight: Object.keys(__fontWeights__),
  'h-align': ['left', 'center', 'right'],
  'v-align': ['top', 'center', 'bottom'],
  'line-join': ['round', 'bevel', 'miter'],
  'line-cap': ['butt', 'round', 'square'],
};
const __textOperations__ = new Set([
  'span',
  'line',
  'font',
  'size',
  'weight',
  'italic',
  'offset',
  'fill',
  'stroke',
  'line-width',
  'line-join',
  'miter-limit',
  'line-cap',
  'line-dash',
  'line-height',
  'width',
  'height',
  'padding',
  'h-align',
  'v-align',
  'resolution',
  'wrap',
]);
function __validateTextArity__(operation, count, ErrorType = SyntaxError) {
  if (operation === 'fill' || operation === 'stroke') {
    if (![1, 3, 4].includes(count))
      throw new ErrorType(
        `${operation} expects a scalar, vec3f, vec4f, three or four channels, or nil`,
      );
  } else if (operation === 'italic' ? count > 1 : count !== (operation === 'line' ? 0 : 1)) {
    throw new ErrorType(
      `${operation} expects ${operation === 'italic' ? 'zero or one argument' : operation === 'line' ? 'no arguments' : 'one argument'}`,
    );
  }
}
const __copyStyle__ = (style) => ({
  ...style,
  offset: [...style.offset],
  fill: style.fill && [...style.fill],
  stroke: style.stroke && [...style.stroke],
  lineDash: [...style.lineDash],
});
function __createTextBuilder__() {
  return {
    runs: [],
    style: {
      font: 'sans-serif',
      size: 16,
      weight: 400,
      italic: false,
      fill: [1, 1, 1, 1],
      stroke: null,
      offset: [0, 0],
      lineWidth: 1,
      lineJoin: 'miter',
      miterLimit: 10,
      lineCap: 'butt',
      lineDash: [],
    },
    width: null,
    height: null,
    padding: [0, 0],
    hAlign: 'left',
    vAlign: 'top',
    lineHeight: null,
    resolution: 1,
    wrap: true,
    closed: false,
  };
}
function __textOperation__(builder, operation, ...args) {
  if (builder.closed) throw new Error('Text builder has already finished');
  __validateTextArity__(operation, args.length, TypeError);
  if (operation === 'fill' || operation === 'stroke') {
    let channels = args;
    if (args.length === 1) {
      const value = args[0];
      if (value === null) {
        builder.style[operation] = null;
        return null;
      }
      if (typeof value === 'number') channels = [value, value, value];
      else if (['vec3f', 'vec4f'].includes(Data.dataKind(value)))
        channels = [...Data.values(value)];
      else
        throw new TypeError(
          `${operation} expects a scalar, vec3f, vec4f, three or four channels, or nil`,
        );
    }
    if (
      channels.some(
        (channel) =>
          typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1,
      )
    )
      throw new TypeError(`${operation} channels must be finite numbers between 0 and 1`);
    builder.style[operation] = channels.length === 3 ? [...channels, 1] : [...channels];
    return null;
  }
  const value = operation === 'italic' && args.length === 0 ? true : args[0];
  if (operation === 'span' || operation === 'line') {
    if (operation === 'span' && typeof value !== 'string')
      throw new TypeError('span expects str; use str to convert other values');
    builder.runs.push({
      text: operation === 'line' ? '\n' : value.replace(/\r\n?/g, '\n'),
      ...__copyStyle__(builder.style),
    });
  } else if (operation === 'offset') {
    if (
      Data.dataKind(value) !== 'vec2f' ||
      Data.values(value).some((component) => !Number.isFinite(component))
    )
      throw new TypeError('offset expects a finite vec2f');
    builder.style.offset = [...Data.values(value)];
  } else if (operation === 'resolution') {
    const resolution =
      typeof value === 'string' && Object.hasOwn(__resolutions__, value)
        ? __resolutions__[value]
        : value;
    if (typeof resolution !== 'number' || !Number.isFinite(resolution) || resolution <= 0)
      throw new TypeError(
        'resolution expects a positive finite multiplier or half, standard, double',
      );
    builder.resolution = resolution;
  } else if (operation === 'weight') {
    const weight =
      typeof value === 'string' && Object.hasOwn(__fontWeights__, value)
        ? __fontWeights__[value]
        : value;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000)
      throw new TypeError('weight expects a number from 1 to 1000 or a named font weight');
    builder.style.weight = weight;
  } else if (operation === 'italic') {
    if (typeof value !== 'boolean') throw new TypeError('italic expects bool');
    builder.style.italic = value;
  } else if (operation === 'wrap') {
    if (typeof value !== 'boolean') throw new TypeError('wrap expects bool');
    builder.wrap = value;
  } else if (operation === 'line-join' || operation === 'line-cap') {
    if (!__textNamedOptions__[operation].includes(value))
      throw new TypeError(`${operation} expects ${__textNamedOptions__[operation].join(', ')}`);
    builder.style[operation === 'line-join' ? 'lineJoin' : 'lineCap'] = value;
  } else if (operation === 'line-dash') {
    const kind = Data.dataKind(value),
      info = Structures.collectionInfo(value);
    if (kind !== 'list' && kind !== 'array')
      throw new TypeError('line-dash expects a list or numeric array');
    const dash =
      kind === 'list'
        ? [...Data.values(value)]
        : Array.from({ length: info.length }, (_, i) => Data.get(value, i));
    if (
      dash.some(
        (segment) => typeof segment !== 'number' || !Number.isFinite(segment) || segment < 0,
      )
    )
      throw new TypeError('line-dash expects finite nonnegative lengths');
    builder.style.lineDash = dash.length % 2 ? [...dash, ...dash] : dash;
  } else if (operation === 'font') {
    if (typeof value !== 'string' || !value.trim())
      throw new TypeError('font expects a nonempty CSS font family string');
    builder.style.font = value;
  } else if (operation === 'padding') {
    const padding =
      typeof value === 'number'
        ? [value, value]
        : Data.dataKind(value) === 'vec2f'
          ? [...Data.values(value)]
          : null;
    if (!padding || padding.some((component) => !Number.isFinite(component) || component < 0))
      throw new TypeError('padding expects a finite nonnegative scalar or vec2f');
    builder.padding = padding;
  } else if (operation === 'h-align' || operation === 'v-align') {
    if (!__textNamedOptions__[operation].includes(value))
      throw new TypeError(`${operation} expects ${__textNamedOptions__[operation].join(', ')}`);
    builder[operation === 'h-align' ? 'hAlign' : 'vAlign'] = value;
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      throw new TypeError(`${operation} expects a positive finite number`);
    if (operation === 'size') builder.style.size = value;
    else if (operation === 'width') builder.width = value;
    else if (operation === 'height') builder.height = value;
    else if (operation === 'line-height') builder.lineHeight = value;
    else if (operation === 'line-width') builder.style.lineWidth = value;
    else if (operation === 'miter-limit') builder.style.miterLimit = value;
    else throw new TypeError(`Unknown text operation: ${operation}`);
  }
  return null;
}
function __finishTextBuilder__(builder) {
  builder.closed = true;
  return {
    runs: builder.runs.map(__copyStyle__),
    width: builder.width,
    height: builder.height,
    padding: [...builder.padding],
    hAlign: builder.hAlign,
    vAlign: builder.vAlign,
    lineHeight: builder.lineHeight,
    resolution: builder.resolution,
    wrap: builder.wrap,
    defaultStyle: __copyStyle__(builder.style),
  };
}
// Compiler-only execution can inspect text without requiring a canvas or a GPU.
function __textDescription__(text) {
  return Data.dict(
    'content',
    text.runs.map((run) => run.text).join(''),
    'runs',
    Data.list(
      ...text.runs.map((run) =>
        Data.dict(
          'text',
          run.text,
          'font',
          run.font,
          'size',
          run.size,
          'weight',
          run.weight,
          'italic',
          run.italic,
          'offset',
          Data.vector(2, run.offset),
          'fill',
          run.fill && Data.list(...run.fill),
          'stroke',
          run.stroke && Data.list(...run.stroke),
          'line-width',
          run.lineWidth,
          'line-join',
          run.lineJoin,
          'miter-limit',
          run.miterLimit,
          'line-cap',
          run.lineCap,
          'line-dash',
          Data.list(...run.lineDash),
        ),
      ),
    ),
  );
}

const __fontKey__ = (run) =>
  `${run.italic ? 'italic' : 'normal'} ${run.weight} ${run.size}px ${run.font}`;
function __groups__(runs) {
  const result = [];
  for (const run of runs) {
    if (!run.text) continue;
    let group = result.at(-1);
    if (!group || group.font !== __fontKey__(run)) {
      group = { font: __fontKey__(run), size: run.size, text: '', spans: [] };
      result.push(group);
    }
    group.spans.push({
      start: group.text.length,
      end: group.text.length + run.text.length,
      ...__copyStyle__(run),
    });
    group.text += run.text;
  }
  return result;
}
function __measure__(context, runs, fallback) {
  let width = 0,
    left = 0,
    right = 0,
    ascent = 0,
    descent = 0;
  const shaped = __groups__(runs);
  for (const group of shaped.length
    ? shaped
    : [{ font: __fontKey__(fallback), size: fallback.size, text: '', spans: [] }]) {
    context.font = group.font;
    const metrics = context.measureText(group.text);
    group.x = width;
    group.width = metrics.width;
    group.ascent = Math.max(
      metrics.fontBoundingBoxAscent ?? group.size * 0.8,
      metrics.actualBoundingBoxAscent || 0,
    );
    group.descent = Math.max(
      metrics.fontBoundingBoxDescent ?? group.size * 0.2,
      metrics.actualBoundingBoxDescent || 0,
    );
    group.spans.forEach((span, i) => {
      span.left =
        i === 0
          ? -(metrics.actualBoundingBoxLeft || 0)
          : context.measureText(group.text.slice(0, span.start)).width;
      span.right =
        i === group.spans.length - 1
          ? metrics.actualBoundingBoxRight || metrics.width
          : context.measureText(group.text.slice(0, span.end)).width;
    });
    left = Math.min(left, width - (metrics.actualBoundingBoxLeft || 0));
    right = Math.max(right, width + (metrics.actualBoundingBoxRight || metrics.width));
    width += metrics.width;
    ascent = Math.max(
      ascent,
      metrics.fontBoundingBoxAscent ?? group.size * 0.8,
      metrics.actualBoundingBoxAscent || 0,
    );
    descent = Math.max(
      descent,
      metrics.fontBoundingBoxDescent ?? group.size * 0.2,
      metrics.actualBoundingBoxDescent || 0,
    );
  }
  return { groups: shaped, width, left, right: Math.max(right, width), ascent, descent };
}

function __rasterizeText__(text, { maxSize = 8192, cache } = {}) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required to render text');
  context.textBaseline = 'alphabetic';
  context.direction = 'ltr';
  const content = text.runs.map((run) => run.text).join('');
  const [padX, padY] = text.padding;
  const innerWidth = text.width === null ? null : Math.max(0, text.width - 2 * padX);
  // Index spans once. Scanning all spans for every line made viewport text quadratic.
  const runEnds = [];
  let runEnd = 0;
  for (const run of text.runs) runEnds.push((runEnd += run.text.length));
  const runAt = (index) => {
    let low = 0,
      high = runEnds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (runEnds[middle] <= index) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const slices = (start, end) => {
    const result = [];
    for (let i = runAt(start); i < text.runs.length; i++) {
      const offset = i ? runEnds[i - 1] : 0;
      if (offset >= end) break;
      const run = text.runs[i];
      const from = Math.max(0, start - offset),
        to = Math.min(run.text.length, end - offset);
      if (to > from) result.push({ ...run, text: run.text.slice(from, to) });
    }
    return result;
  };
  const lines = [];
  let start = 0,
    end = 0;
  const styleAt = (index) => {
    return text.runs[runAt(index)] ?? text.defaultStyle;
  };
  const appendLine = () => {
    const runs = slices(start, end),
      fallback = styleAt(start);
    const key = cache ? JSON.stringify([runs, __fontKey__(fallback)]) : null;
    let metrics = key && cache.measure.get(key);
    if (metrics) {
      cache.measure.delete(key);
      cache.measure.set(key, metrics);
    }
    if (!metrics) {
      metrics = __measure__(context, runs, fallback);
      if (cache) {
        cache.measure.set(key, metrics);
        if (cache.measure.size > 256) cache.measure.delete(cache.measure.keys().next().value);
      }
    }
    lines.push({ ...metrics, cacheKey: key });
    start = end;
  };
  // Break opportunities are independent of style spans. Oversized words stay intact.
  if (text.wrap === false) {
    // Explicit newlines only; fixed dimensions clip long lines without reflow.
    for (const match of content.matchAll(/\n/gu)) {
      end = match.index;
      appendLine();
      start = end = match.index + 1;
    }
    end = content.length;
  } else
    for (const match of content.matchAll(/\n|[^\S\n]+|[^\s]+/gu)) {
      const token = match[0],
        next = match.index + token.length;
      if (token === '\n') {
        end = match.index;
        appendLine();
        start = end = next;
        continue;
      }
      const candidate = __measure__(context, slices(start, next), text.defaultStyle);
      if (
        innerWidth !== null &&
        end > start &&
        !/^\s+$/u.test(token) &&
        candidate.width > innerWidth
      ) {
        // Discard spaces at a soft wrap, while retaining explicit newline/blank lines.
        const trimmed = content.slice(start, end).replace(/\s+$/u, '');
        end = start + trimmed.length;
        appendLine();
        start = match.index;
      }
      end = next;
    }
  appendLine();
  const blockWidth = innerWidth ?? Math.max(0, ...lines.map((line) => line.width));
  let previous = null,
    minX = 0,
    maxX = blockWidth,
    minY = 0,
    maxY = 0;
  for (const line of lines) {
    line.x =
      text.hAlign === 'center'
        ? (blockWidth - line.width) / 2
        : text.hAlign === 'right'
          ? blockWidth - line.width
          : 0;
    line.baseline = previous
      ? previous.baseline + (text.lineHeight ?? (previous.ascent + previous.descent) * 1.2)
      : line.ascent;
    minX = Math.min(minX, line.x + line.left);
    maxX = Math.max(maxX, line.x + line.right);
    maxY = Math.max(maxY, line.baseline + line.descent);
    minY = Math.min(minY, line.baseline - line.ascent);
    for (const group of line.groups)
      for (const span of group.spans) {
        const [dx, dy] = span.offset;
        minX = Math.min(minX, line.x + group.x + span.left + dx);
        maxX = Math.max(maxX, line.x + group.x + span.right + dx);
        minY = Math.min(minY, line.baseline - group.ascent + dy);
        maxY = Math.max(maxY, line.baseline + group.descent + dy);
      }
    previous = line;
  }
  const strokeExtent = Math.max(
    0,
    ...text.runs.map((run) =>
      run.stroke
        ? (run.lineWidth / 2) *
          Math.max(
            run.lineJoin === 'miter' ? run.miterLimit : 1,
            run.lineCap === 'square' ? Math.SQRT2 : 1,
          )
        : 0,
    ),
  );
  const padding = 1 + Math.ceil(strokeExtent);
  const naturalTop = Math.min(0, ...lines.map((line) => line.baseline - line.ascent));
  const naturalHeight = Math.max(...lines.map((line) => line.baseline + line.descent)) - naturalTop;
  const spareHeight =
    text.height === null ? 0 : Math.max(0, text.height - 2 * padY) - naturalHeight;
  const vertical =
    text.vAlign === 'center' ? spareHeight / 2 : text.vAlign === 'bottom' ? spareHeight : 0;
  const offsetX = text.width === null ? padding + padX - Math.floor(minX) : padX;
  const offsetY =
    text.height === null ? padding + padY - Math.floor(minY) : padY - naturalTop + vertical;
  const width =
    text.width === null
      ? Math.max(1, Math.ceil(maxX - Math.floor(minX) + 2 * (padding + padX)))
      : Math.ceil(text.width);
  const height =
    text.height === null
      ? Math.max(1, Math.ceil(maxY - Math.floor(minY) + 2 * (padding + padY)))
      : Math.ceil(text.height);
  if (width > maxSize || height > maxSize)
    throw new RangeError('Text exceeds GPU texture dimension limit');
  const scale = text.resolution;
  const rasterWidth = Math.max(1, Math.ceil(width * scale)),
    rasterHeight = Math.max(1, Math.ceil(height * scale));
  if (rasterWidth > maxSize || rasterHeight > maxSize)
    throw new RangeError('Text raster exceeds dimension limit');
  canvas.width = rasterWidth;
  canvas.height = rasterHeight;
  if (scale !== 1) context.setTransform(scale, 0, 0, scale, 0, 0);
  context.textBaseline = 'alphabetic';
  context.direction = 'ltr';
  const paintLine = (target, line, baseline, paintHeight) => {
    for (const group of line.groups) {
      target.font = group.font;
      const x = offsetX + line.x + group.x,
        y = baseline;
      // Shape the whole same-font run, even when its paint changes mid-word.
      for (let i = 0; i < group.spans.length; i++) {
        const span = group.spans[i];
        const paintX = x + span.offset[0],
          paintY = y + span.offset[1];
        const left = i === 0 ? -width : span.left;
        const right = i === group.spans.length - 1 ? width * 2 : span.right;
        target.save();
        target.beginPath();
        target.rect(paintX + left, 0, right - left, paintHeight);
        target.clip();
        const paint = (color) =>
          `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3]})`;
        if (span.stroke) {
          target.strokeStyle = paint(span.stroke);
          target.lineWidth = span.lineWidth;
          target.lineJoin = span.lineJoin;
          target.miterLimit = span.miterLimit;
          target.lineCap = span.lineCap;
          target.setLineDash(span.lineDash);
          target.strokeText(group.text, paintX, paintY);
        }
        if (span.fill) {
          target.fillStyle = paint(span.fill);
          target.fillText(group.text, paintX, paintY);
        }
        target.restore();
      }
    }
  };
  for (const line of lines) {
    const reusable =
      cache &&
      scale === 1 &&
      typeof context.drawImage === 'function' &&
      line.groups.every((group) =>
        group.spans.every((span) => !span.stroke && span.offset[0] === 0 && span.offset[1] === 0),
      );
    if (!reusable) {
      paintLine(context, line, offsetY + line.baseline, height);
      continue;
    }
    if (!line.groups.length) continue;
    const top = Math.floor(offsetY + line.baseline - line.ascent);
    const baseline = offsetY + line.baseline - top;
    const stripHeight = Math.ceil(line.ascent + line.descent) + 2;
    if (
      !Number.isFinite(stripHeight) ||
      stripHeight > maxSize ||
      width * stripHeight * 4 > 1024 * 1024
    ) {
      paintLine(context, line, offsetY + line.baseline, height);
      continue;
    }
    const key = JSON.stringify([line.cacheKey, width, offsetX, line.x, baseline]);
    let strip = cache.paint.get(key);
    if (strip) {
      cache.paint.delete(key);
      cache.paint.set(key, strip);
    }
    if (!strip) {
      strip =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, stripHeight)
          : document.createElement('canvas');
      strip.width = width;
      strip.height = stripHeight;
      const stripContext = strip.getContext('2d');
      stripContext.textBaseline = 'alphabetic';
      stripContext.direction = 'ltr';
      paintLine(stripContext, line, baseline, stripHeight);
      cache.paint.set(key, strip);
      if (cache.paint.size > 128) cache.paint.delete(cache.paint.keys().next().value);
    }
    context.drawImage(strip, 0, top);
  }
  let output = canvas;
  if (scale !== 1) {
    output =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d');
    if (!outputContext) throw new Error('Canvas 2D is required to resample text');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(canvas, 0, 0, width * scale, height * scale, 0, 0, width, height);
  }
  return {
    canvas: output,
    width,
    height,
    baseline: offsetY + lines[0].baseline,
    offsetX,
    offsetY,
    lineCount: lines.length,
  };
}

export const Text = {
  bindTextShader: __bindTextShader__,
  shaderBinding: (shader) => __shaderBindings__.get(shader),
  textNamedOptions: __textNamedOptions__,
  textOperations: __textOperations__,
  validateTextArity: __validateTextArity__,
  createTextBuilder: __createTextBuilder__,
  textOperation: __textOperation__,
  finishTextBuilder: __finishTextBuilder__,
  textDescription: __textDescription__,
  rasterizeText: __rasterizeText__,
};
