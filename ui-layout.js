import { GLYPH_WIDTH, GLYPH_HEIGHT } from './drawing.js';

const dimension = (value, fallback = 0) => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0)
    throw new Error('UI dimensions must be finite and nonnegative');
  return value;
};
const padding = (value = 0) => {
  const values = Array.isArray(value) ? value : [value, value, value, value];
  if (values.length !== 4) throw new Error('UI padding needs [top right bottom left]');
  return values.map((entry) => dimension(entry));
};

/** Measure and arrange an ephemeral component tree. Callbacks are never run by layout. */
export function layoutUI(root, origin, size, state = {}) {
  if (
    origin.length !== 2 ||
    size.length !== 2 ||
    ![...origin, ...size].every(Number.isFinite) ||
    size.some((n) => n < 0)
  )
    throw new Error('Invalid UI root bounds');
  const measured = new Map();
  const naturalHeights = new Map();
  const ids = new Set();
  let count = 0;
  function measure(node, depth = 0) {
    if (node === null || node === false) return [0, 0];
    if (!node || typeof node !== 'object' || !node.type) throw new Error('Expected a UI component');
    if (
      ![
        'row',
        'column',
        'panel',
        'scroll',
        'label',
        'button',
        'toggle',
        'slider',
        'code',
        'spacer',
        'custom',
      ].includes(node.type)
    )
      throw new Error(`Unknown UI component ${node.type}`);
    if (++count > 512 || depth > 32) throw new Error('UI tree exceeds 512 components or 32 levels');
    if (node.id !== undefined) {
      if (ids.has(node.id)) throw new Error(`Duplicate UI control ${node.id}`);
      ids.add(node.id);
    }
    const opts = node.options ?? {},
      children = (node.children ?? []).filter(Boolean),
      pad = padding(opts.padding),
      gap = dimension(opts.gap, 8);
    let natural;
    if (['row', 'column', 'panel', 'scroll'].includes(node.type)) {
      const sizes = children.map((child) => measure(child, depth + 1));
      const row = node.type === 'row';
      natural = [0, 0];
      for (const child of sizes) {
        natural[row ? 0 : 1] += child[row ? 0 : 1];
        natural[row ? 1 : 0] = Math.max(natural[row ? 1 : 0], child[row ? 1 : 0]);
      }
      natural[row ? 0 : 1] += Math.max(0, sizes.length - 1) * gap;
      natural[0] += pad[1] + pad[3];
      natural[1] += pad[0] + pad[2];
    } else {
      const text = String(node.label ?? '');
      natural =
        node.type === 'button' || node.type === 'toggle'
          ? [text.length * GLYPH_WIDTH + 24, 34]
          : node.type === 'code'
            ? [80, 32]
            : node.type === 'slider'
              ? [160, 52]
              : node.type === 'spacer'
                ? [0, 0]
                : node.type === 'custom'
                  ? [0, 0]
                  : [text.length * GLYPH_WIDTH, GLYPH_HEIGHT];
    }
    const result = [dimension(opts.width, natural[0]), dimension(opts.height, natural[1])];
    naturalHeights.set(node, natural[1]);
    measured.set(node, result);
    return result;
  }
  measure(root);
  const entries = [];
  function arrange(node, point, bounds, inheritedClip) {
    if (!node) return;
    const opts = node.options ?? {};
    const clip = [
      Math.max(point[0], inheritedClip[0]),
      Math.max(point[1], inheritedClip[1]),
      Math.min(point[0] + bounds[0], inheritedClip[0] + inheritedClip[2]),
      Math.min(point[1] + bounds[1], inheritedClip[1] + inheritedClip[3]),
    ];
    clip[2] = Math.max(0, clip[2] - clip[0]);
    clip[3] = Math.max(0, clip[3] - clip[1]);
    entries.push([node, point, bounds, clip, naturalHeights.get(node)]);
    if (!['row', 'column', 'panel', 'scroll'].includes(node.type)) return;
    const pad = padding(opts.padding),
      gap = dimension(opts.gap, 8),
      row = node.type === 'row';
    const axis = row ? 0 : 1,
      cross = 1 - axis;
    const content = [
      Math.max(0, bounds[0] - pad[1] - pad[3]),
      Math.max(0, bounds[1] - pad[0] - pad[2]),
    ];
    const start = [point[0] + pad[3], point[1] + pad[0]];
    if (node.type === 'scroll') {
      content[0] = Math.max(0, content[0] - 16);
      start[1] -= Math.max(
        0,
        Math.min(Number(state[node.key]) || 0, naturalHeights.get(node) - bounds[1]),
      );
    }
    const children = (node.children ?? []).filter(Boolean);
    let fixed = Math.max(0, children.length - 1) * gap,
      weights = 0;
    for (const child of children) {
      const weight = dimension(child.options?.grow);
      if (weight) weights += weight;
      else fixed += measured.get(child)[axis];
    }
    const remaining = Math.max(0, content[axis] - fixed);
    let cursor = start[axis];
    for (const child of children) {
      const childOpts = child.options ?? {},
        weight = dimension(childOpts.grow);
      const extent = weight ? (remaining * weight) / weights : measured.get(child)[axis];
      const align = childOpts.align ?? opts.align ?? 'stretch';
      const crossSize =
        align === 'stretch' && childOpts[row ? 'height' : 'width'] === undefined
          ? content[cross]
          : Math.min(content[cross], measured.get(child)[cross]);
      const offset =
        align === 'center'
          ? (content[cross] - crossSize) / 2
          : align === 'end'
            ? content[cross] - crossSize
            : 0;
      const childPoint = [...start],
        childSize = [...content];
      childPoint[axis] = cursor;
      childPoint[cross] += offset;
      childSize[axis] = extent;
      childSize[cross] = crossSize;
      arrange(child, childPoint, childSize, clip);
      cursor += extent + gap;
    }
  }
  arrange(root, origin, size, [...origin, ...size]);
  return entries;
}
