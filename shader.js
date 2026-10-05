import { isSym, print } from './lisp.js';
// Both GPU passes use these helpers so editor shapes match scene primitives.
export const pixelCoverageWGSL = `
fn cover_circle(p: vec2f, center: vec2f, radius: f32) -> f32 {
  return 1.0 - step(radius, length(p - center));
}
fn cover_rect(p: vec2f, origin: vec2f, size: vec2f) -> f32 {
  let relative = p - origin;
  return select(0.0, 1.0, all(relative >= vec2f(0.0)) && all(relative < size));
}
fn cover_line(p: vec2f, start: vec2f, end: vec2f, width: f32) -> f32 {
  let relative = p - start;
  let segment = end - start;
  let projection = clamp(dot(relative, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
  return 1.0 - step(width * 0.5, length(relative - segment * projection));
}
`;
const number = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));
export function rgba(value) {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))
    throw new Error(`Expected #RRGGBB or #RRGGBBAA, got ${value}`);
  return [0, 2, 4, 6].map((offset, i) =>
    i === 3 && value.length === 7 ? 1 : parseInt(value.slice(offset + 1, offset + 3), 16) / 255,
  );
}
/**
 * Compile the scene's restricted Lisp AST to a WGSL fragment program.
 * CPU functions are intentionally not evaluated here. Emitted expressions carry
 * their WGSL type; the browser validates the remaining GPU overload constraints.
 */
export function compileShader(forms, state = {}) {
  const def = forms.find((n) => Array.isArray(n) && isSym(n[0], 'defpixel'));
  if (!def || forms.length !== 1 || !isSym(def[1]) || def[2]?.type !== 'vector')
    throw new Error('Scene must contain one (defpixel name [p time] ...)');
  if (print(def[2]) !== '[p time]') throw new Error('Pixel program arguments must be [p time]');
  const params = [],
    paramMap = new Map();
  let serial = 0,
    primitives = 0,
    statements = 0;
  // Slot zero is time/width/height. Each state parameter gets one aligned vec4.
  function uniform(key) {
    if (!(key in state))
      throw new Error(
        `Unknown shader parameter :${key}; initialize it in main.lisp or the active scene`,
      );
    if (!paramMap.has(key)) {
      if (params.length >= 63) throw new Error('Maximum 63 shader parameters');
      const kind = typeof state[key] === 'string' ? 'color' : 'scalar';
      if (kind === 'color') rgba(state[key]);
      paramMap.set(key, params.length + 1);
      params.push({ key, kind });
    }
    const index = paramMap.get(key),
      kind = params[index - 1].kind;
    return {
      code: `u.data[${index}]${kind === 'scalar' ? '.x' : ''}`,
      type: kind === 'scalar' ? 'f32' : 'vec4f',
    };
  }
  /** Emit a value expression as {code, type}; locals map Lisp names to WGSL. */
  function expr(n, locals = {}) {
    if (typeof n === 'number') return { code: number(n), type: 'f32' };
    if (n?.type === 'string')
      return { code: `vec4f(${rgba(n.value).map(number).join(', ')})`, type: 'vec4f' };
    if (n?.type === 'vector') {
      const vals = n.items.map((x) => expr(x, locals));
      if (![2, 3, 4].includes(vals.length) || vals.some((x) => x.type !== 'f32'))
        throw new Error('Shader vector needs 2–4 scalar components');
      return {
        code: `vec${vals.length}f(${vals.map((x) => x.code).join(', ')})`,
        type: `vec${vals.length}f`,
      };
    }
    if (isSym(n)) {
      if (n.name in locals) return locals[n.name];
      const vars = {
        p: { code: 'd.p', type: 'vec2f' },
        'p.x': { code: 'd.p.x', type: 'f32' },
        'p.y': { code: 'd.p.y', type: 'f32' },
        time: { code: 'u.data[0].x', type: 'f32' },
        width: { code: 'u.data[0].y', type: 'f32' },
        height: { code: 'u.data[0].z', type: 'f32' },
      };
      if (vars[n.name]) return vars[n.name];
      throw new Error(`Unknown shader symbol ${n.name}`);
    }
    if (!Array.isArray(n) || !n.length) throw new Error('Invalid shader expression');
    const [head, ...args] = n,
      name = head?.name;
    if (name === 'param') {
      if (args.length !== 1 || !isSym(args[0]) || !args[0].name.startsWith(':'))
        throw new Error('Use (param :state-key)');
      return uniform(args[0].name.slice(1));
    }
    if (name === 'position' && !args.length) return { code: 'd.p', type: 'vec2f' };
    const values = args.map((x) => expr(x, locals));
    if (['+', '-', '*', '/'].includes(name)) {
      if (!values.length || (name === '/' && values.length < 2))
        throw new Error(`${name}: missing operands`);
      if (name === '-' && values.length === 1)
        return { ...values[0], code: `(-${values[0].code})` };
      let result = values[0];
      for (const v of values.slice(1)) {
        let a = result.code,
          b = v.code,
          type = result.type === 'f32' ? v.type : result.type;
        if (result.type !== v.type && result.type !== 'f32' && v.type !== 'f32')
          throw new Error(`${name}: vector sizes differ`);
        if (['+', '-'].includes(name) && result.type !== v.type) {
          if (result.type === 'f32') a = `${type}(${a})`;
          else b = `${type}(${b})`;
        }
        result = { code: `(${a} ${name} ${b})`, type };
      }
      return result;
    }
    const arities = {
      sin: 1,
      cos: 1,
      abs: 1,
      floor: 1,
      fract: 1,
      length: 1,
      noise: 1,
      min: 2,
      max: 2,
      pow: 2,
      mod: 2,
      clamp: 3,
      mix: 3,
      step: 2,
      smoothstep: 3,
    };
    if (name in arities) {
      if (values.length !== arities[name])
        throw new Error(`${name}: expected ${arities[name]} arguments`);
      if (name === 'noise' && values[0].type !== 'vec2f')
        throw new Error('noise expects a 2D vector');
      if (name === 'mod')
        return {
          code: `(${values[0].code} - ${values[1].code} * floor(${values[0].code} / ${values[1].code}))`,
          type: values[0].type,
        };
      return {
        code: `${name === 'noise' ? 'hash' : name}(${values.map((x) => x.code).join(', ')})`,
        type: ['length', 'noise'].includes(name) ? 'f32' : values[0].type,
      };
    }
    if (['vec2', 'vec3', 'rgb', 'rgba'].includes(name)) {
      const size = { vec2: 2, vec3: 3, rgb: 3, rgba: 4 }[name];
      if (values.length !== size || values.some((x) => x.type !== 'f32'))
        throw new Error(`${name}: expected ${size} scalars`);
      return { code: `vec${size}f(${values.map((x) => x.code).join(', ')})`, type: `vec${size}f` };
    }
    throw new Error(`Unknown shader expression ${name}`);
  }
  function color(n, locals) {
    const e = expr(n, locals);
    if (e.type === 'vec3f') return `vec4f(${e.code}, 1.0)`;
    if (e.type === 'f32') return `vec4f(vec3f(${e.code}), 1.0)`;
    if (e.type !== 'vec4f') throw new Error('Color needs a scalar, RGB, or RGBA expression');
    return e.code;
  }
  function typed(n, type, locals) {
    const e = expr(n, locals);
    if (e.type !== type) throw new Error(`Expected ${type}, got ${e.type} in ${print(n)}`);
    return e.code;
  }
  // Commands mutate each pixel's Draw struct. A scope restores settings but
  // deliberately retains d.color, so scoped primitives still composite.
  function body(nodes, locals = {}) {
    return nodes
      .map((n) => {
        if (++statements > 4096) throw new Error('Shader expansion exceeds 4096 statements');
        if (!Array.isArray(n) || !isSym(n[0]))
          throw new Error(`Expected drawing expression, got ${print(n)}`);
        const [h, ...a] = n,
          name = h.name;
        const arities = {
          background: 1,
          fill: 1,
          opacity: 1,
          blend: 1,
          circle: 2,
          rect: 2,
          line: 3,
          translate: 1,
          scale: 1,
          rotate: 1,
        };
        if (name in arities && a.length !== arities[name])
          throw new Error(`${name}: expected ${arities[name]} arguments`);
        if (name === 'background') return `d.color = ${color(a[0], locals)};`;
        if (name === 'fill') return `d.paint = ${color(a[0], locals)};`;
        if (name === 'opacity')
          return `d.opacity = clamp(${typed(a[0], 'f32', locals)}, 0.0, 1.0);`;
        if (name === 'blend') {
          const modes = { ':over': 0, ':add': 1, ':multiply': 2 };
          if (!(a[0]?.name in modes)) throw new Error('Blend must be :over, :add, or :multiply');
          return `d.mode = ${modes[a[0].name]}u;`;
        }
        if (name === 'translate') return `d.p -= ${typed(a[0], 'vec2f', locals)};`;
        if (name === 'scale') {
          const e = expr(a[0], locals);
          if (!['f32', 'vec2f'].includes(e.type)) throw new Error('Scale needs scalar or vec2');
          return `d.p /= ${e.code};`;
        }
        if (name === 'rotate') return `d.p = rotatePoint(d.p, -(${typed(a[0], 'f32', locals)}));`;
        if (['circle', 'rect', 'line'].includes(name)) {
          primitives++;
          const codes =
            name === 'circle'
              ? [typed(a[0], 'vec2f', locals), typed(a[1], 'f32', locals)]
              : name === 'rect'
                ? [typed(a[0], 'vec2f', locals), typed(a[1], 'vec2f', locals)]
                : [
                    typed(a[0], 'vec2f', locals),
                    typed(a[1], 'vec2f', locals),
                    typed(a[2], 'f32', locals),
                  ];
          return `composite(&d, cover_${name}(d.p, ${codes.join(', ')}));`;
        }
        if (name === 'scope') {
          const id = serial++;
          return `{ let saved${id} = d;\n${body(a, locals)}\nd.p = saved${id}.p; d.paint = saved${id}.paint; d.opacity = saved${id}.opacity; d.mode = saved${id}.mode; }`;
        }
        if (name === 'repeat') {
          // Expand bounded repetitions rather than submitting per-shape geometry.
          if (!Number.isInteger(a[0]) || a[0] < 0 || a[0] > 64 || !isSym(a[1]))
            throw new Error('Use (repeat count index body...), count 0–64');
          return Array.from({ length: a[0] }, (_, i) =>
            body(a.slice(2), { ...locals, [a[1].name]: { code: number(i), type: 'f32' } }),
          ).join('\n');
        }
        if (name === 'let') {
          if (a[0]?.type !== 'vector' || a[0].items.length % 2)
            throw new Error('Use (let [name value ...] body...)');
          const local = { ...locals },
            declarations = [];
          for (let i = 0; i < a[0].items.length; i += 2) {
            const key = a[0].items[i];
            if (!isSym(key)) throw new Error('Invalid shader let binding');
            const e = expr(a[0].items[i + 1], local),
              id = `local${serial++}`;
            declarations.push(`let ${id} = ${e.code};`);
            local[key.name] = { code: id, type: e.type };
          }
          return `{ ${declarations.join('\n')}\n${body(a.slice(1), local)}\n}`;
        }
        throw new Error(`Unknown drawing command ${name}`);
      })
      .join('\n');
  }
  const drawing = body(def.slice(3));
  const code = `struct Uniforms { data: array<vec4f, 64> }
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Draw { p: vec2f, color: vec4f, paint: vec4f, opacity: f32, mode: u32 }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1,311.7))) * 43758.5453); }
fn rotatePoint(p: vec2f, a: f32) -> vec2f { return vec2f(cos(a)*p.x-sin(a)*p.y, sin(a)*p.x+cos(a)*p.y); }
${pixelCoverageWGSL}
fn composite(d: ptr<function, Draw>, coverage: f32) {
  let a=clamp((*d).paint.a*(*d).opacity*coverage,0.0,1.0);
  var rgb=(*d).paint.rgb;
  if ((*d).mode==1u) { rgb=(*d).color.rgb+rgb*a; }
  else if ((*d).mode==2u) { rgb=mix((*d).color.rgb,(*d).color.rgb*rgb,a); }
  else { rgb=mix((*d).color.rgb,rgb,a); }
  (*d).color=vec4f(rgb,a+(*d).color.a*(1.0-a));
}
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners=array<vec2f,6>(vec2f(-1.0,-1.0),vec2f(1.0,-1.0),vec2f(-1.0,1.0),vec2f(-1.0,1.0),vec2f(1.0,-1.0),vec2f(1.0,1.0));
  return vec4f(corners[index],0.0,1.0);
}
@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  var d=Draw(floor(pixel.xy), vec4f(0.0,0.0,0.0,1.0), vec4f(1.0), 1.0, 0u);
  ${drawing}
  return d.color;
}`;
  return { code, params, primitives };
}
