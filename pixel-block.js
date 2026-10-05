import { isSym, print } from './lisp.js';
import { compilePixelShader } from './shader.js';
const sym = (name) => ({ type: 'symbol', name });
const vector = (items) => ({ type: 'vector', items });
const cache = new Map();
const shaderNames = new Set(['p', 'p.x', 'p.y', 'time', 'width', 'height', 'true', 'false']);

/** Capture only values: CPU code and side effects never execute inside a shader. */
export function pixelBlock(args, env, evaluate) {
  if (args[0]?.type !== 'vector' || print(args[0]) !== '[p time]' || args.length < 2)
    throw new Error('Use (pixels [p time] color-expression-or-drawing-body...)');
  const values = Object.create(null);
  let serial = 0;
  function capture(value) {
    if (Array.isArray(value)) {
      if (![2, 3, 4].includes(value.length) || !value.every(Number.isFinite))
        throw new Error('pixels captures require finite vectors of 2–4 numbers');
      return vector(value.map(capture));
    }
    if ((typeof value !== 'number' || !Number.isFinite(value)) && typeof value !== 'string')
      throw new Error('pixels captures require finite numbers, colors or numeric vectors');
    const key = `capture${serial++}`;
    values[key] = value;
    return [sym('param'), sym(':' + key)];
  }
  function walk(node, locals = new Set()) {
    if (isSym(node)) {
      if (shaderNames.has(node.name) || locals.has(node.name) || node.name.startsWith(':'))
        return node;
      if (node.name in env && typeof env[node.name] !== 'function') return capture(env[node.name]);
      // Vector components of captured drawable arguments, e.g. center.x.
      const match = /^(.*)\.([xyzw])$/.exec(node.name);
      if (match && Array.isArray(env[match[1]]))
        return capture(env[match[1]]['xyzw'.indexOf(match[2])]);
      return node;
    }
    if (node?.type === 'vector') return vector(node.items.map((n) => walk(n, locals)));
    if (!Array.isArray(node)) return node;
    const name = node[0]?.name;
    if (['set!', 'init!', 'play-sound', 'voice', 'start-scene', 'resource-url'].includes(name))
      throw new Error(`pixels: ${name} is a CPU operation; move it outside the pixel block`);
    if (name === 'get') {
      if (node.length !== 2 || !node[1]?.name?.startsWith(':'))
        throw new Error('pixels: use (get :state-key)');
      return capture(evaluate(node));
    }
    if (name === 'let' && node[1]?.type === 'vector') {
      const local = new Set(locals),
        items = [];
      for (let i = 0; i < node[1].items.length; i += 2) {
        const key = node[1].items[i];
        items.push(key, walk(node[1].items[i + 1], local));
        local.add(key?.name);
      }
      return [node[0], vector(items), ...node.slice(2).map((n) => walk(n, local))];
    }
    if (name === 'repeat') {
      const local = new Set(locals);
      local.add(node[2]?.name);
      return [node[0], node[1], node[2], ...node.slice(3).map((n) => walk(n, local))];
    }
    return [node[0], ...node.slice(1).map((n) => walk(n, locals))];
  }
  const forms = args.slice(1).map((node) => walk(node));
  const key =
    forms.map(print).join('\n') + JSON.stringify(Object.values(values).map((v) => typeof v));
  let shader = cache.get(key);
  if (!shader) {
    shader = compilePixelShader(forms, values);
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, shader);
  }
  return { shader, values };
}
