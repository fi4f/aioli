import { locate } from './diagnostics.js';
import { parseParameters } from './types.js';

export const vertexWGSL = `
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[index], 0, 1);
}`;

// A deliberately small, typed language. No scene bindings are captured.
export function compileShader(node, source) {
  const fail = (message, at = node) => { throw locate(new SyntaxError(message), source, at.start, at.end); };
  const [, parameters, ...body] = node.items;
  if (parameters?.kind !== 'list') fail('sh expects a parameter list followed by body statements');
  const uniforms = [];
  let needsSampler = false;
  const builtins = new Map(['t', 'dt', 'w', 'h'].map(name => [name, { code: name, type: 1 }]));
  builtins.set('p', { code: 'p', type: 2 });
  const reserved = new Set(['let', 'set', 'return', 'fn', 'sample', '+', '-', '*', '/', 'vec2', 'vec3', 'vec4', 'x', 'y', 'z', 'xy', 'xyz']);
  const helperTypes = new Map([['float', 1], ['vec2', 2], ['vec3', 3], ['vec4', 4], ['texture2d', 'texture2d']]);
  const specialForms = new Set(['let', 'set', 'return', 'fn']);
  const typedParameters = (list, types) => {
    return parseParameters(list.items, { required: true, types: new Set(types.keys()), fail })
      .map(parameter => ({ name: parameter.node, type: types.get(parameter.type), annotation: parameter.type }));
  };
  const argumentsScope = new Map();
  let uniformCount = 0;
  const resources = [];
  for (const { name, type, annotation } of typedParameters(parameters, helperTypes)) {
    if (argumentsScope.has(name.name) || builtins.has(name.name) || reserved.has(name.name)) fail(`Invalid or duplicate shader parameter: ${name.name}`, name);
    if (type === 'texture2d') {
      const binding = resources.length + 1;
      const resource = { name: name.name, type: annotation, binding, code: `resource${resources.length}` };
      uniforms.push(resource); resources.push(resource);
      argumentsScope.set(name.name, { code: resource.code, type });
    } else {
      const slot = uniformCount++;
      uniforms.push({ name: name.name, type: annotation, slot });
      argumentsScope.set(name.name, { code: `frame.values[${slot}].${'xyzw'.slice(0, type)}`, type });
    }
  }
  let scopes = [builtins, argumentsScope];
  const helpers = [], helperCode = [];
  const fragmentOwner = {};
  let owner = fragmentOwner;
  let nextLocal = 0;
  const lookup = node => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const value = scopes[i].get(node.name);
      if (value) {
        if (value.pending) fail(`Shader variable ${node.name} used before initialization`, node);
        if (value.owner && value.owner !== owner) {
          fail(`Cannot capture shader local ${node.name}; pass it as a parameter`, node);
        }
        return value;
      }
    }
    fail(`Unknown shader symbol: ${node.name}`, node);
  };
  const expression = node => {
    if (node.kind === 'literal') {
      if (typeof node.value !== 'number' || !Number.isFinite(Math.fround(node.value))) fail('Shader literals must be finite f32 numbers', node);
      return { code: Object.is(node.value, -0) ? '-0.0f' : `${node.value}f`, type: 1 };
    }
    if (node.kind === 'symbol') {
      const value = lookup(node);
      if (value.helper) fail('Shader helpers can only be used in direct calls', node);
      return value;
    }
    if (node.kind !== 'list') fail('Expected a shader expression', node);
    const [head, ...args] = node.items;
    if (node.items[1]?.kind === 'colon') {
      if (node.items.length !== 3 || node.items[2].kind !== 'symbol') fail('Type assertion expects (value : type)', node);
      const value = expression(head), expected = helperTypes.get(node.items[2].name);
      if (!expected) fail(`Unknown shader type: ${node.items[2].name}`, node.items[2]);
      if (value.type !== expected) fail(`Shader expression must be ${node.items[2].name}`, node);
      return value;
    }
    if (head?.kind !== 'symbol') fail('Expected a shader operation name', node);
    const name = head.name;
    if (['+', '-', '*', '/'].includes(name)) {
      if (!args.length && (name === '-' || name === '/')) fail(`${name} needs at least one operand`, node);
      const operands = args.map(numericExpression);
      const type = Math.max(1, ...operands.map(value => value.type));
      if (operands.some(value => value.type !== 1 && value.type !== type)) fail('Arithmetic vector dimensions must match', node);
      const values = operands.map(value => value.type === type ? value.code : `vec${type}f(${value.code})`);
      if (!values.length) return { code: name === '+' ? '0.0f' : '1.0f', type: 1 };
      if (values.length === 1) {
        if (name === '-') return { code: `(-${values[0]})`, type };
        if (name === '/') return { code: `(${type === 1 ? '1.0f' : `vec${type}f(1.0f)`} / ${values[0]})`, type };
        return { code: values[0], type };
      }
      return { code: values.slice(1).reduce((result, value) => `(${result} ${name} ${value})`, values[0]), type };
    }
    if (/^vec[234]$/.test(name)) {
      const type = Number(name.at(-1)), values = args.map(numericExpression);
      const count = values.reduce((sum, value) => sum + value.type, 0);
      if (count !== type && !(values.length === 1 && values[0].type === 1)) fail(`${name} needs ${type} components or one scalar`, node);
      return { code: `vec${type}f(${values.map(value => value.code).join(', ')})`, type };
    }
    if (/^(x|y|z|w|xy|xyz)$/.test(name)) {
      if (args.length !== 1) fail(`${name} expects one vector`, node);
      const value = numericExpression(args[0]);
      const required = Math.max(...[...name].map(c => 'xyzw'.indexOf(c) + 1));
      if (value.type < 2 || value.type < required) fail(`${name} cannot access this vector`, node);
      return { code: `(${value.code}).${name}`, type: name.length };
    }
    if (name === 'sample') {
      if (args.length !== 2) fail('sample expects a texture2d and vec2 UV coordinates', node);
      const image = expression(args[0]), uv = numericExpression(args[1]);
      if (image.type !== 'texture2d' || uv.type !== 2) fail('sample expects a texture2d and vec2 UV coordinates', node);
      needsSampler = true;
      return { code: `textureSampleLevel(${image.code}, shaderSampler, ${uv.code}, 0.0f)`, type: 4 };
    }
    if (name === 'fn') fail('Shader fn must initialize a let binding', node);
    const callable = lookup(head);
    if (!callable.helper) fail(`Shader value ${name} is not a function`, head);
    const type = compileHelper(callable);
    const values = args.map(expression);
    if (values.length !== callable.parameters.length) fail(`${name} expects ${callable.parameters.length} arguments`, node);
    for (let i = 0; i < values.length; i++) {
      if (values[i].type !== callable.parameters[i].type) fail(`Argument ${i + 1} to ${name} must be ${typeName(callable.parameters[i].type)}`, args[i]);
    }
    return { code: `${callable.code}(p${values.length ? ', ' : ''}${values.map(value => value.code).join(', ')})`, type };
  };
  const numericExpression = node => {
    const value = expression(node);
    if (typeof value.type !== 'number') fail('Expected a numeric shader value, not a resource', node);
    return value;
  };
  const typeName = type => type === 'texture2d' ? 'texture_2d<f32>' : type === 1 ? 'f32' : `vec${type}f`;
  function compileHelper(helper) {
    if (helper.state === 'compiling') fail(`Recursive shader helper cycle involving ${helper.name}`, helper.node);
    if (helper.state === 'compiled') return helper.type;
    helper.state = 'compiling';
    const savedScopes = scopes, savedOwner = owner;
    scopes = helper.scopes.slice();
    owner = helper;
    try {
      const [, parameters, ...body] = helper.node.items;
      if (parameters?.kind !== 'list') fail('Shader fn expects typed parameters followed by body statements', helper.node);
      const scope = new Map();
      const parametersCode = [], copies = [];
      helper.parameters = typedParameters(parameters, helperTypes).map(({ name, type }, index) => {
        if (scope.has(name.name) || specialForms.has(name.name)) fail(`Invalid or duplicate helper parameter: ${name.name}`, name);
        const local = { code: type === 'texture2d' ? `argument${index}` : `local${nextLocal++}`, type, mutable: type !== 'texture2d', owner: helper };
        scope.set(name.name, local);
        parametersCode.push(`argument${index}: ${typeName(type)}`);
        if (type !== 'texture2d') copies.push(`var ${local.code}: ${typeName(type)} = argument${index};`);
        return { name: name.name, type };
      });
      const compiled = statements(body, scope);
      if (!compiled.returns) fail('Shader helper must explicitly return a scalar or vector', helper.node);
      helper.type = compiled.returnType;
      helper.state = 'compiled';
      helperCode.push(`fn ${helper.code}(shaderPixel: vec2f${parametersCode.length ? ', ' : ''}${parametersCode.join(', ')}) -> ${typeName(helper.type)} {
${builtinCode('shaderPixel')}
${copies.join('\n')}
${compiled.code}
}`);
      return helper.type;
    } finally { scopes = savedScopes; owner = savedOwner; }
  }
  const builtinCode = pixel => `  let w = frame.data.x;
  let h = frame.data.y;
  let t = frame.data.z;
  let dt = frame.data.w;
  let p = ${pixel};`;
  const statements = (nodes, scope = new Map()) => {
    scopes.push(scope);
    try {
      for (const statement of nodes) {
        if (statement.kind !== 'list' || statement.items[0]?.name !== 'let') continue;
        const [, name, value] = statement.items;
        if (statement.items.length !== 3 || name.kind !== 'symbol' || !value) fail('let expects a name and value', statement);
        if (scope.has(name.name) || reserved.has(name.name)) fail(`Name already defined or reserved: ${name.name}`, name);
        if (value.kind === 'list' && value.items[0]?.name === 'fn') {
          const helper = { name: name.name, code: `helper${helpers.length}`, helper: true,
            pending: true, node: value, scopes: scopes.slice(), state: 'uncompiled' };
          helpers.push(helper);
          scope.set(name.name, helper);
        } else {
          scope.set(name.name, { code: `local${nextLocal++}`, pending: true, mutable: true, owner });
        }
      }
      let returns = false, returnType = null;
      const lines = nodes.map(statement => {
        if (returns) fail('Unreachable shader statement after return', statement);
        if (statement.kind === 'block') {
          const block = statements(statement.items);
          returns = block.returns;
          returnType = block.returnType;
          return `{\n${block.code}\n}`;
        }
        if (statement.kind !== 'list') fail('Expected a shader statement', statement);
        const [head, ...args] = statement.items;
        if (head?.name === 'let') {
          const local = scope.get(args[0].name);
          if (local.helper) { local.pending = false; return ''; }
          const value = numericExpression(args[1]);
          Object.assign(local, { type: value.type, pending: false });
          return `var ${local.code}: ${value.type === 1 ? 'f32' : `vec${value.type}f`} = ${value.code};`;
        }
        if (head?.name === 'set') {
          if (args.length !== 2 || args[0].kind !== 'symbol') fail('set expects a name and value', statement);
          const local = lookup(args[0]), value = numericExpression(args[1]);
          if (local.helper) fail(`Cannot reassign shader helper: ${args[0].name}`, args[0]);
          if (!local.mutable) fail(`Cannot assign shader input: ${args[0].name}`, args[0]);
          if (local.type !== value.type) fail('Shader assignment must preserve its variable type', statement);
          return `${local.code} = ${value.code};`;
        }
        if (head?.name === 'return') {
          if (args.length !== 1) fail('Shader return expects one value', statement);
          const value = numericExpression(args[0]);
          if (owner === fragmentOwner && value.type !== 4) fail('Shader return must be a vec4 RGBA color', args[0]);
          returns = true;
          returnType = value.type;
          return `return ${value.code};`;
        }
        fail(`Unsupported shader statement: ${head?.name || statement.kind}`, statement);
      });
      return { code: lines.filter(Boolean).join('\n'), returns, returnType };
    } finally { scopes.pop(); }
  };
  const compiled = statements(body);
  if (!compiled.returns) fail('Shader must explicitly return a vec4 RGBA color');
  for (let i = 0; i < helpers.length; i++) compileHelper(helpers[i]);
  const hasSampler = resources.length > 0 || needsSampler;
  const wgsl = `${vertexWGSL}
struct Frame { data: vec4f, ${uniformCount ? `values: array<vec4f, ${uniformCount}>,` : ''} }
@group(0) @binding(0) var<uniform> frame: Frame;
${resources.map(resource => `@group(0) @binding(${resource.binding}) var ${resource.code}: texture_2d<f32>;`).join('\n')}
${hasSampler ? `@group(0) @binding(${resources.length + 1}) var shaderSampler: sampler;` : ''}
${helperCode.join('\n')}
@fragment fn fragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
${builtinCode('pixel.xy')}
${compiled.code}
}`;
  return { wgsl, uniforms, uniformCount, resources, hasSampler, source, start: node.start, end: node.end };
}
