const textures = new WeakSet();
const vector = (value, size) => (Array.isArray(value) || ArrayBuffer.isView(value)) &&
  value.length === size && Array.from(value).every(item => typeof item === 'number');

export const typeNames = new Set(['number', 'float', 'string', 'boolean', 'function', 'vec2', 'vec3', 'vec4', 'texture2d']);

export function registerTexture(handle) { textures.add(handle); return handle; }

export function assertType(value, type, label = 'Value') {
  let matches;
  switch (type) {
    case 'number': case 'float': matches = typeof value === 'number'; break;
    case 'string': case 'boolean': case 'function': matches = typeof value === type; break;
    case 'vec2': case 'vec3': case 'vec4': matches = vector(value, Number(type.at(-1))); break;
    case 'texture2d': matches = textures.has(value); break;
    default: throw new TypeError(`Unknown type: ${type}`);
  }
  if (!matches) {
    const actual = value === null ? 'null' : typeof value;
    throw new TypeError(`${label}: expected ${type}, received ${actual}${actual === 'string' ? ` ${JSON.stringify(value)}` : ''}`);
  }
  return value;
}

export function parseParameters(nodes, { required = false, types = typeNames, fail } = {}) {
  const result = [];
  for (let i = 0; i < nodes.length;) {
    const node = nodes[i++];
    if (node.kind !== 'symbol') fail('Expected a parameter name', node);
    let annotation = null;
    if (nodes[i]?.kind === 'colon') {
      const colon = nodes[i++];
      annotation = nodes[i++];
      if (annotation?.kind !== 'symbol') fail(`Expected type after ${node.name}:`, annotation || colon);
      if (!types.has(annotation.name)) fail(`Unsupported parameter type: ${annotation.name}; expected ${[...types].join(', ')}`, annotation);
    } else if (required) fail(`Expected colon after parameter ${node.name}`, nodes[i] || node);
    result.push({ name: node.name, type: annotation?.name || null, node,
      start: node.start, end: annotation?.end || node.end });
  }
  return result;
}

export const vectorBindings = Object.fromEntries([2, 3, 4].map(size => [`vec${size}`, (...values) => {
  const components = values.flatMap(value => {
    if (typeof value === 'number') return [value];
    if ((Array.isArray(value) || ArrayBuffer.isView(value)) && value.length >= 2 && value.length <= 4) return Array.from(value);
    throw new TypeError(`vec${size}: expected numbers or numeric vectors`);
  });
  if (components.length === 1) components.push(...Array(size - 1).fill(components[0]));
  assertType(components, `vec${size}`, `vec${size} components`);
  return components;
}]));
