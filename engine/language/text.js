import { dataKind, dict, list, get, vector } from './data.js';
import { collectionInfo } from './structures.js';

export function bindTextShader(shader, labels, parameterCount) {
  const hidden = labels.flatMap(label => {
    const origin = get(label, 'origin');
    if (dataKind(origin) !== 'dict' || get(label, 'texture') === null) throw new TypeError('Hoisted shader text requires a text renderer supplying a texture and bounds');
    return [get(label, 'texture'), vector(4, ['w', 'h', 'baseline', 'lines'].map(key => get(label, key))),
      vector(2, ['x', 'y'].map(key => get(origin, key)))];
  });
  return (context, ...args) => {
    if (args.length !== parameterCount) throw new TypeError(`Shader expects ${parameterCount} parameter arguments`);
    return shader(context, ...args, ...hidden);
  };
}

const fontWeights = { thin: 100, extralight: 200, light: 300, normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const resolutions = { half: 0.5, standard: 1, double: 2 };
export const textNamedOptions = { resolution: Object.keys(resolutions), weight: Object.keys(fontWeights), 'h-align': ['left', 'center', 'right'], 'v-align': ['top', 'center', 'bottom'], 'line-join': ['round', 'bevel', 'miter'], 'line-cap': ['butt', 'round', 'square'] };
export const textOperations = new Set(['span', 'line', 'font', 'size', 'weight', 'italic', 'offset', 'fill', 'stroke', 'line-width', 'line-join', 'miter-limit', 'line-cap', 'line-dash', 'line-height', 'width', 'height', 'padding', 'h-align', 'v-align', 'resolution', 'wrap']);
export function validateTextArity(operation, count, ErrorType = SyntaxError) {
  if (operation === 'fill' || operation === 'stroke') {
    if (![1, 3, 4].includes(count)) throw new ErrorType(`${operation} expects a scalar, vec3f, vec4f, three or four channels, or nil`);
  } else if (operation === 'italic' ? count > 1 : count !== (operation === 'line' ? 0 : 1)) {
    throw new ErrorType(`${operation} expects ${operation === 'italic' ? 'zero or one argument' : operation === 'line' ? 'no arguments' : 'one argument'}`);
  }
}
const copyStyle = style => ({ ...style, offset: [...style.offset], fill: style.fill && [...style.fill], stroke: style.stroke && [...style.stroke], lineDash: [...style.lineDash] });
export function createTextBuilder() {
  return { runs: [], style: { font: 'sans-serif', size: 16, weight: 400, italic: false, fill: [1, 1, 1, 1], stroke: null,
    offset: [0, 0], lineWidth: 1, lineJoin: 'miter', miterLimit: 10, lineCap: 'butt', lineDash: [] },
    width: null, height: null, padding: [0, 0], hAlign: 'left', vAlign: 'top', lineHeight: null, resolution: 1, wrap: true, closed: false };
}
export function textOperation(builder, operation, ...args) {
  if (builder.closed) throw new Error('Text builder has already finished');
  validateTextArity(operation, args.length, TypeError);
  if (operation === 'fill' || operation === 'stroke') {
    let channels = args;
    if (args.length === 1) {
      const value = args[0];
      if (value === null) { builder.style[operation] = null; return null; }
      if (typeof value === 'number') channels = [value, value, value];
      else if (['vec3f', 'vec4f'].includes(dataKind(value))) channels = [...value.values];
      else throw new TypeError(`${operation} expects a scalar, vec3f, vec4f, three or four channels, or nil`);
    }
    if (channels.some(channel => typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1)) throw new TypeError(`${operation} channels must be finite numbers between 0 and 1`);
    builder.style[operation] = channels.length === 3 ? [...channels, 1] : [...channels];
    return null;
  }
  const value = operation === 'italic' && args.length === 0 ? true : args[0];
  if (operation === 'span' || operation === 'line') {
    if (operation === 'span' && typeof value !== 'string') throw new TypeError('span expects str; use str to convert other values');
    builder.runs.push({ text: operation === 'line' ? '\n' : value.replace(/\r\n?/g, '\n'),
      ...copyStyle(builder.style) });
  } else if (operation === 'offset') {
    if (dataKind(value) !== 'vec2f' || value.values.some(component => !Number.isFinite(component))) throw new TypeError('offset expects a finite vec2f');
    builder.style.offset = [...value.values];
  } else if (operation === 'resolution') {
    const resolution = typeof value === 'string' && Object.hasOwn(resolutions, value) ? resolutions[value] : value;
    if (typeof resolution !== 'number' || !Number.isFinite(resolution) || resolution <= 0) throw new TypeError('resolution expects a positive finite multiplier or half, standard, double');
    builder.resolution = resolution;
  } else if (operation === 'weight') {
    const weight = typeof value === 'string' && Object.hasOwn(fontWeights, value) ? fontWeights[value] : value;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000) throw new TypeError('weight expects a number from 1 to 1000 or a named font weight');
    builder.style.weight = weight;
  } else if (operation === 'italic') {
    if (typeof value !== 'boolean') throw new TypeError('italic expects bool');
    builder.style.italic = value;
  } else if (operation === 'wrap') {
    if (typeof value !== 'boolean') throw new TypeError('wrap expects bool');
    builder.wrap = value;
  } else if (operation === 'line-join' || operation === 'line-cap') {
    if (!textNamedOptions[operation].includes(value)) throw new TypeError(`${operation} expects ${textNamedOptions[operation].join(', ')}`);
    builder.style[operation === 'line-join' ? 'lineJoin' : 'lineCap'] = value;
  } else if (operation === 'line-dash') {
    const kind = dataKind(value), info = collectionInfo(value);
    if (kind !== 'list' && kind !== 'array') throw new TypeError('line-dash expects a list or numeric array');
    const dash = kind === 'list' ? [...value.values] : Array.from({ length: info.length }, (_, i) => get(value, i));
    if (dash.some(segment => typeof segment !== 'number' || !Number.isFinite(segment) || segment < 0)) throw new TypeError('line-dash expects finite nonnegative lengths');
    builder.style.lineDash = dash.length % 2 ? [...dash, ...dash] : dash;
  } else if (operation === 'font') {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('font expects a nonempty CSS font family string');
    builder.style.font = value;
  } else if (operation === 'padding') {
    const padding = typeof value === 'number' ? [value, value] : dataKind(value) === 'vec2f' ? [...value.values] : null;
    if (!padding || padding.some(component => !Number.isFinite(component) || component < 0)) throw new TypeError('padding expects a finite nonnegative scalar or vec2f');
    builder.padding = padding;
  } else if (operation === 'h-align' || operation === 'v-align') {
    if (!textNamedOptions[operation].includes(value)) throw new TypeError(`${operation} expects ${textNamedOptions[operation].join(', ')}`);
    builder[operation === 'h-align' ? 'hAlign' : 'vAlign'] = value;
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new TypeError(`${operation} expects a positive finite number`);
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
export function finishTextBuilder(builder) {
  builder.closed = true;
  return { runs: builder.runs.map(copyStyle),
    width: builder.width, height: builder.height, padding: [...builder.padding], hAlign: builder.hAlign, vAlign: builder.vAlign, lineHeight: builder.lineHeight, resolution: builder.resolution, wrap: builder.wrap,
    defaultStyle: copyStyle(builder.style) };
}
// Compiler-only execution can inspect text without requiring a canvas or a GPU.
export function textDescription(text) {
  return dict('content', text.runs.map(run => run.text).join(''), 'runs', list(...text.runs.map(run =>
    dict('text', run.text, 'font', run.font, 'size', run.size, 'weight', run.weight, 'italic', run.italic, 'offset', vector(2, run.offset),
      'fill', run.fill && list(...run.fill), 'stroke', run.stroke && list(...run.stroke),
      'line-width', run.lineWidth, 'line-join', run.lineJoin, 'miter-limit', run.miterLimit,
      'line-cap', run.lineCap, 'line-dash', list(...run.lineDash)))));
}

const fontKey = run => `${run.italic ? 'italic' : 'normal'} ${run.weight} ${run.size}px ${run.font}`;
function groups(runs) {
  const result = [];
  for (const run of runs) {
    if (!run.text) continue;
    let group = result.at(-1);
    if (!group || group.font !== fontKey(run)) { group = { font: fontKey(run), size: run.size, text: '', spans: [] }; result.push(group); }
    group.spans.push({ start: group.text.length, end: group.text.length + run.text.length, ...copyStyle(run) });
    group.text += run.text;
  }
  return result;
}
function measure(context, runs, fallback) {
  let width = 0, left = 0, right = 0, ascent = 0, descent = 0;
  const shaped = groups(runs);
  for (const group of shaped.length ? shaped : [{ font: fontKey(fallback), size: fallback.size, text: '', spans: [] }]) {
    context.font = group.font;
    const metrics = context.measureText(group.text);
    group.x = width; group.width = metrics.width;
    group.ascent = Math.max(metrics.fontBoundingBoxAscent ?? group.size * 0.8, metrics.actualBoundingBoxAscent || 0);
    group.descent = Math.max(metrics.fontBoundingBoxDescent ?? group.size * 0.2, metrics.actualBoundingBoxDescent || 0);
    group.spans.forEach((span, i) => {
      span.left = i === 0 ? -(metrics.actualBoundingBoxLeft || 0) : context.measureText(group.text.slice(0, span.start)).width;
      span.right = i === group.spans.length - 1 ? (metrics.actualBoundingBoxRight || metrics.width) : context.measureText(group.text.slice(0, span.end)).width;
    });
    left = Math.min(left, width - (metrics.actualBoundingBoxLeft || 0));
    right = Math.max(right, width + (metrics.actualBoundingBoxRight || metrics.width));
    width += metrics.width;
    ascent = Math.max(ascent, metrics.fontBoundingBoxAscent ?? group.size * 0.8, metrics.actualBoundingBoxAscent || 0);
    descent = Math.max(descent, metrics.fontBoundingBoxDescent ?? group.size * 0.2, metrics.actualBoundingBoxDescent || 0);
  }
  return { groups: shaped, width, left, right: Math.max(right, width), ascent, descent };
}

export function rasterizeText(text, { maxSize = 8192 } = {}) {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required to render text');
  context.textBaseline = 'alphabetic'; context.direction = 'ltr';
  const content = text.runs.map(run => run.text).join('');
  const [padX, padY] = text.padding;
  const innerWidth = text.width === null ? null : Math.max(0, text.width - 2 * padX);
  const slices = (start, end) => {
    let offset = 0;
    return text.runs.flatMap(run => {
      const from = Math.max(0, start - offset), to = Math.min(run.text.length, end - offset);
      offset += run.text.length;
      return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
    });
  };
  const lines = [];
  let start = 0, end = 0;
  const styleAt = index => {
    let offset = 0;
    for (const run of text.runs) { offset += run.text.length; if (index < offset) return run; }
    return text.defaultStyle;
  };
  const appendLine = () => { lines.push(measure(context, slices(start, end), styleAt(start))); start = end; };
  // Break opportunities are independent of style spans. Oversized words stay intact.
  if (text.wrap === false) {
    // Explicit newlines only; fixed dimensions clip long lines without reflow.
    for (const match of content.matchAll(/\n/gu)) {
      end = match.index; appendLine(); start = end = match.index + 1;
    }
    end = content.length;
  } else for (const match of content.matchAll(/\n|[^\S\n]+|[^\s]+/gu)) {
    const token = match[0], next = match.index + token.length;
    if (token === '\n') { end = match.index; appendLine(); start = end = next; continue; }
    const candidate = measure(context, slices(start, next), text.defaultStyle);
    if (innerWidth !== null && end > start && !/^\s+$/u.test(token) && candidate.width > innerWidth) {
      // Discard spaces at a soft wrap, while retaining explicit newline/blank lines.
      const trimmed = content.slice(start, end).replace(/\s+$/u, '');
      end = start + trimmed.length; appendLine(); start = match.index;
    }
    end = next;
  }
  appendLine();
  const blockWidth = innerWidth ?? Math.max(0, ...lines.map(line => line.width));
  let previous = null, minX = 0, maxX = blockWidth, minY = 0, maxY = 0;
  for (const line of lines) {
    line.x = text.hAlign === 'center' ? (blockWidth - line.width) / 2 : text.hAlign === 'right' ? blockWidth - line.width : 0;
    line.baseline = previous ? previous.baseline + (text.lineHeight ?? (previous.ascent + previous.descent) * 1.2) : line.ascent;
    minX = Math.min(minX, line.x + line.left); maxX = Math.max(maxX, line.x + line.right);
    maxY = Math.max(maxY, line.baseline + line.descent);
    minY = Math.min(minY, line.baseline - line.ascent);
    for (const group of line.groups) for (const span of group.spans) {
      const [dx, dy] = span.offset;
      minX = Math.min(minX, line.x + group.x + span.left + dx);
      maxX = Math.max(maxX, line.x + group.x + span.right + dx);
      minY = Math.min(minY, line.baseline - group.ascent + dy);
      maxY = Math.max(maxY, line.baseline + group.descent + dy);
    }
    previous = line;
  }
  const strokeExtent = Math.max(0, ...text.runs.map(run => run.stroke ? run.lineWidth / 2 * Math.max(run.lineJoin === 'miter' ? run.miterLimit : 1, run.lineCap === 'square' ? Math.SQRT2 : 1) : 0));
  const padding = 1 + Math.ceil(strokeExtent);
  const naturalTop = Math.min(0, ...lines.map(line => line.baseline - line.ascent));
  const naturalHeight = Math.max(...lines.map(line => line.baseline + line.descent)) - naturalTop;
  const spareHeight = text.height === null ? 0 : Math.max(0, text.height - 2 * padY) - naturalHeight;
  const vertical = text.vAlign === 'center' ? spareHeight / 2 : text.vAlign === 'bottom' ? spareHeight : 0;
  const offsetX = text.width === null ? padding + padX - Math.floor(minX) : padX;
  const offsetY = text.height === null ? padding + padY - Math.floor(minY) : padY - naturalTop + vertical;
  const width = text.width === null ? Math.max(1, Math.ceil(maxX - Math.floor(minX) + 2 * (padding + padX))) : Math.ceil(text.width);
  const height = text.height === null ? Math.max(1, Math.ceil(maxY - Math.floor(minY) + 2 * (padding + padY))) : Math.ceil(text.height);
  if (width > maxSize || height > maxSize) throw new RangeError('Text exceeds GPU texture dimension limit');
  const scale = text.resolution;
  const rasterWidth = Math.max(1, Math.ceil(width * scale)), rasterHeight = Math.max(1, Math.ceil(height * scale));
  if (rasterWidth > maxSize || rasterHeight > maxSize) throw new RangeError('Text raster exceeds dimension limit');
  canvas.width = rasterWidth; canvas.height = rasterHeight;
  if (scale !== 1) context.setTransform(scale, 0, 0, scale, 0, 0);
  context.textBaseline = 'alphabetic'; context.direction = 'ltr';
  for (const line of lines) for (const group of line.groups) {
    context.font = group.font;
    const x = offsetX + line.x + group.x, y = offsetY + line.baseline;
    // Shape the whole same-font run, even when its paint changes mid-word.
    for (let i = 0; i < group.spans.length; i++) {
      const span = group.spans[i];
      const paintX = x + span.offset[0], paintY = y + span.offset[1];
      const left = i === 0 ? -width : context.measureText(group.text.slice(0, span.start)).width;
      const right = i === group.spans.length - 1 ? width * 2 : context.measureText(group.text.slice(0, span.end)).width;
      context.save(); context.beginPath(); context.rect(paintX + left, 0, right - left, height); context.clip();
      const paint = color => `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3]})`;
      if (span.stroke) {
        context.strokeStyle = paint(span.stroke); context.lineWidth = span.lineWidth;
        context.lineJoin = span.lineJoin; context.miterLimit = span.miterLimit; context.lineCap = span.lineCap;
        context.setLineDash(span.lineDash);
        context.strokeText(group.text, paintX, paintY);
      }
      if (span.fill) { context.fillStyle = paint(span.fill); context.fillText(group.text, paintX, paintY); }
      context.restore();
    }
  }
  let output = canvas;
  if (scale !== 1) {
    output = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    output.width = width; output.height = height;
    const outputContext = output.getContext('2d');
    if (!outputContext) throw new Error('Canvas 2D is required to resample text');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(canvas, 0, 0, width * scale, height * scale, 0, 0, width, height);
  }
  return { canvas: output, width, height, baseline: offsetY + lines[0].baseline, offsetX, offsetY, lineCount: lines.length };
}
