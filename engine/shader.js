import { locate } from './trace.js';
import { parseParameters } from './types.js';
import { resultType, isMatrix, isVector, isScalar } from './numeric.js';
import { structDefinitionInfo, elementInfo, arrayType, manyType } from './structures.js';
import { vectorInfo, scalarTypes, vectorTypes, convertComponent, matrixSize, matrixTypes, typeAliases, canonicalType } from './numeric-types.js';
import { parseConditional } from './conditionals.js';
import { parseTransformPairs, transformWGSL } from './transforms.js';
import { nameComment } from './codegen.js';
import { blendWGSL } from './colors.js';

export const vertexWGSL = `
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[index], 0, 1);
}`;

// Shader expressions are typed; text bodies are lifted into regular Lisp.
export function compileShader(node, source, { structDefinitions = new Map(), hoistText } = {}) {
  const fail = (message, at = node) => { throw locate(new SyntaxError(message), source, at.start, at.end); };
  const [, parameters, ...body] = node.items;
  if (parameters?.kind !== 'list') fail('sh expects a parameter list followed by body statements');
  const uniforms = [];
  let needsSampler = false;
  let needsBefore = false;
  let needsBlend = false;
  const builtins = new Map(['t', 'dt', 'x', 'y', 'u', 'v', 'w', 'h'].map(name => [name, { code: name, type: 1 }]));
  for (const name of ['xy', 'uv', 'wh']) builtins.set(name, { code: name, type: 2 });
  builtins.set('before', { code: 'before', type: 'texture2d' });
  const reserved = new Set(['if', 'let', 'set', 'return', 'fn', 'sample', 'copy', 'get', 'len', 'cap', 'array', 'many', 'insert', 'remove', 'bool', 'and', 'or', 'not', '+', '-', '*', '/', '%', 'mat2x2f', 'mat3x3f', 'mat4x4f']);
  reserved.add('2d'); reserved.add('3d');
  reserved.add('text');
  reserved.add('blend');
  for (const name of ['num', 'str', ...scalarTypes, ...vectorTypes, ...matrixTypes, ...Object.keys(typeAliases)]) { reserved.add(name); reserved.add(name + '?'); }
  const helperTypes = new Map([['bool', 'bool'], ['mat2x2f', 'mat2x2f'], ['mat3x3f', 'mat3x3f'], ['mat4x4f', 'mat4x4f'], ['texture2d', 'texture2d']]);
  helperTypes.set('f32', 1); helperTypes.set('i32', 'i32'); helperTypes.set('u32', 'u32');
  for (const type of vectorTypes) helperTypes.set(type, type.endsWith('f') ? vectorInfo(type).size : type);
  const shape = type => typeof type === 'number' ? { size: type, scalar: 'f32' } : ['i32','u32'].includes(type) ? { size: 1, scalar: type } : vectorInfo(type);
  const shapeType = (size, scalar) => scalar === 'f32' ? size : size === 1 ? scalar : `vec${size}${scalar === 'i32' ? 'i' : 'u'}`;
  const structTypes = new Map();
  for (const [name, constructor] of structDefinitions) {
    const info = structDefinitionInfo(constructor);
    structTypes.set(info, { kind: 'struct', info });
    helperTypes.set(name, structTypes.get(info));
  }
  for (const [name, element] of [...[...scalarTypes, ...vectorTypes, 'mat2x2f', 'mat3x3f', 'mat4x4f'].map(name => [name, name]), ...structDefinitions]) {
    helperTypes.set(`array<${name}>`, { kind: 'storage', element: elementInfo(element), collection: 'array' });
  }
  const resolveElementDescriptor = name => {
    name = canonicalType(name);
    if (structDefinitions.has(name)) return structDefinitions.get(name);
    if (name === 'bool') return 'bool';
    if ([...scalarTypes, ...vectorTypes, 'mat2x2f', 'mat3x3f', 'mat4x4f'].includes(name)) return name;
    const match = name.match(/^(array|many)<(.+),(\d+)>$/);
    if (!match) return null;
    const element = resolveElementDescriptor(match[2]);
    return element ? (match[1] === "many" ? manyType : arrayType)(element, Number(match[3])) : null;
  };
  const resolveType = name => {
    const canonical = canonicalType(name);
    if (canonical !== name) {
      const type = resolveType(canonical);
      if (type) helperTypes.set(name, type);
      return type;
    }
    if (helperTypes.has(name)) return helperTypes.get(name);
    const sized = name.match(/^(array|many)<(.+),(\d+)>$/), match = sized || name.match(/^(array|many)<(.+)>$/);
    if (!match) return undefined;
    const element = resolveElementDescriptor(match[2]);
    if (!element) return undefined;
    const info = sized ? (match[1] === "many" ? manyType : arrayType)(element, Number(match[3])) : undefined;
    const type = { kind: 'storage', element: elementInfo(element), capacity: info?.capacity, info, collection: match[1] };
    helperTypes.set(name, type);
    return type;
  };
  const specialForms = new Set(['if', 'let', 'set', 'return', 'fn', 'and', 'or', 'not']);
  const typedParameters = (list, types) => {
    return parseParameters(list.items, { required: true, types: { has: name => Boolean(resolveType(name)), [Symbol.iterator]: () => types.keys() }, fail })
      .map(parameter => ({ name: parameter.node, type: types.get(parameter.type), annotation: canonicalType(parameter.type) }));
  };
  const argumentsScope = new Map();
  let uniformCount = 0;
  const resources = [];
  for (const { name, type, annotation } of typedParameters(parameters, helperTypes)) {
    if (argumentsScope.has(name.name) || builtins.has(name.name) || reserved.has(name.name)) fail(`Invalid or duplicate shader parameter: ${name.name}`, name);
    if (type?.kind === 'struct') fail('Struct shader inputs require array<StructName>', name);
    if (type === 'texture2d' || type?.kind === 'storage') {
      const binding = resources.length + 1;
      const resource = { name: name.name, type: annotation, binding, code: `resource${resources.length}`,
        kind: type === 'texture2d' ? 'texture' : 'storage', element: type.element, capacity: type.capacity, collection: type.collection };
      if (type?.kind === 'storage') resource.slot = uniformCount++;
      uniforms.push(resource); resources.push(resource);
      argumentsScope.set(name.name, { code: resource.code, type, resource });
    } else {
      const slot = uniformCount;
      const columns = isMatrix(type) ? matrixSize(type) : 1;
      uniformCount += columns;
      uniforms.push({ name: name.name, type: annotation, slot });
      const uniformShape = shape(type);
      const raw = uniformShape ? `frame.values[${slot}].${'xyzw'.slice(0, uniformShape.size)}` : '';
      const code = isMatrix(type)
        ? `mat${columns}x${columns}f(${Array.from({ length: columns }, (_, i) => `bitcast<vec${columns}f>(frame.values[${slot + i}].${'xyzw'.slice(0, columns)})`).join(', ')})`
        : type === 'bool' ? `(frame.values[${slot}].x != 0u)` : `bitcast<${uniformShape.scalar === 'f32' ? uniformShape.size === 1 ? 'f32' : `vec${uniformShape.size}f` : uniformShape.size === 1 ? uniformShape.scalar : type}>(${raw})`;
      argumentsScope.set(name.name, { code, type });
    }
  }
  let scopes = [builtins, argumentsScope];
  const parameterCount = uniforms.length, liftedText = new Map();
  function textField(value, key, at) {
    if (key === 'texture') return { code: value.code, type: 'texture2d' };
    if (key === 'origin') return { code: value.origin, type: 2 };
    const index = ['w', 'h', 'baseline', 'lines'].indexOf(key);
    if (index < 0) fail(`Unknown shader text field: ${key}`, at);
    return { code: `${value.metrics}.${'xyzw'[index]}`, type: 1 };
  }
  const helpers = [], helperCode = [];
  const transformHelpers = new Set();
  const generatedStructs = new Map(), collectionReaders = new Map(), arrayValues = new Map(), manyEditors = new Set();
  const numericConversions = new Set();
  const boolHelpers = new Set();
  let nextSelector = 0;
  const fragmentOwner = {};
  let owner = fragmentOwner;
  let nextLocal = 0;
  const lookup = node => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const value = scopes[i].get(node.name);
      if (value) {
        if (value === builtins.get('before')) needsBefore = true;
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
    if (node.kind === 'access') {
      const target = expression(node.target);
      if (target.type?.kind === 'text') return textField(target, node.key, node);
      if (target.type?.kind === 'struct') return fieldAccess(target, node.key, node);
      if (target.type?.kind === 'storage' || target.type?.kind === 'array' || target.type?.kind === 'many') {
        if (node.quoted || !/^\d+$/.test(node.key) || !Number.isSafeInteger(Number(node.key))) fail('Array dot access requires an integer index', node);
        return readCollection(target, { code: `${Number(node.key)}f`, type: 1 }, node);
      }
      const vector = shape(target.type);
      if (!node.quoted && /^-?\d+$/.test(node.key) && (isMatrix(target.type) || vector?.size >= 2)) {
        const size = isMatrix(target.type) ? matrixSize(target.type) : vector.size, index = Number(node.key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= size) fail('Numeric dot index is outside this vector/matrix', node);
        return { code: `(${target.code})[${index}u]`, type: isMatrix(target.type) ? size : shapeType(1, vector.scalar) };
      }
      if (node.quoted || !/^[xyzw]{1,4}$/.test(node.key)) fail('Shader dot access requires a one-to-four component vector swizzle', node);
      const value = target;
      const required = Math.max(...[...node.key].map(component => 'xyzw'.indexOf(component) + 1));
      if (!vector || vector.size < 2 || vector.size < required) fail(`${node.key} cannot access this vector`, node);
      return { code: `(${value.code}).${node.key}`, type: shapeType(node.key.length, vector.scalar) };
    }
    if (node.kind === 'literal') {
      if (typeof node.value === 'boolean') return { code: String(node.value), type: 'bool' };
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
      const value = expression(head), declared = resolveType(node.items[2].name), expected = declared?.info ? elementType(declared.info) : declared;
      if (!expected) fail(`Unknown shader type: ${node.items[2].name}`, node.items[2]);
      if (value.type !== expected) fail(`Shader expression must be ${node.items[2].name}`, node);
      return value;
    }
    if (head?.kind !== 'symbol') fail('Expected a shader operation name', node);
    const name = canonicalType(head.name);
    if (name === 'text') {
      if (liftedText.has(node)) return liftedText.get(node);
      if (!hoistText) fail('Shader text requires the regular Lisp compiler to hoist its body', node);
      hoistText(node, new Set(scopes.flatMap(scope => [...scope.keys()])));
      const index = liftedText.size, resource = { name: `$text${index}`, type: 'texture2d',
        kind: 'texture', binding: resources.length + 1, code: `resource${resources.length}` };
      resources.push(resource); uniforms.push(resource);
      const slot = uniformCount;
      uniforms.push({ name: `$text${index}.metrics`, type: 'vec4f', slot });
      uniforms.push({ name: `$text${index}.origin`, type: 'vec2f', slot: slot + 1 });
      uniformCount += 2;
      const value = { type: { kind: 'text' }, code: resource.code,
        metrics: `bitcast<vec4f>(frame.values[${slot}])`, origin: `bitcast<vec2f>(frame.values[${slot + 1}].xy)` };
      liftedText.set(node, value);
      return value;
    }
    if (name === '2d' || name === '3d') {
      const size = name === '2d' ? 2 : 3;
      const entries = parseTransformPairs(args, key => key.kind === 'symbol' ? key.name : key.kind === 'literal' ? key.value : null, fail);
      const codes = { position: `vec${size}f(0f)`, scale: `vec${size}f(1f)`,
        rotation: size === 2 ? '0f' : 'vec3f(0f)', skew: size === 2 ? 'vec2f(0f)' : 'array<f32, 6>()' };
      for (const [key, at] of entries) {
        const value = expression(at);
        if (key === 'skew' && size === 3) {
          const type = value.type, info = type?.info;
          if (type?.kind === 'array' && info.capacity === 6 && info.element.type === 'f32') codes[key] = value.code;
          else if (type?.kind === 'storage' && type.collection === 'array' && type.capacity === 6 && type.element.type === 'f32') {
            codes[key] = `array<f32, 6>(${Array.from({ length: 6 }, (_, i) => readCollection(value, { code: `${i}f`, type: 1 }, at).code).join(', ')})`;
          } else fail('3d skew expects an array of six f32 angles: xy, xz, yx, yz, zx, zy', at);
        } else {
          const expected = key === 'rotation' && size === 2 ? 1 : size;
          if (key === 'scale' && value.type === 1) codes[key] = `vec${size}f(${value.code})`;
          else if (value.type === expected) codes[key] = value.code;
          else fail(`${name} ${key} expects ${expected === 1 ? 'f32' : `vec${expected}f`}${key === 'scale' ? ' or f32' : ''}`, at);
        }
      }
      if (!transformHelpers.has(name)) { transformHelpers.add(name); helperCode.push(transformWGSL[name]); }
      return { code: `transform${name}(${['position', 'scale', 'rotation', 'skew'].map(key => codes[key]).join(', ')})`, type: size === 2 ? 'mat3x3f' : 'mat4x4f' };
    }
    if (name.endsWith('?') && ['num', 'str', ...scalarTypes, ...vectorTypes, ...matrixTypes].includes(name.slice(0, -1))) {
      if (args.length !== 1) fail(`${name} expects exactly one value`, node);
      const value = valueExpression(args[0]), requested = name.slice(0, -1);
      const matches = requested === 'num' ? shape(value.type)?.size === 1 : helperTypes.get(requested) === value.type;
      const numeric = shape(value.type);
      let predicate = String(Boolean(matches));
      if (numeric?.size === 1) {
        if (requested === 'i32' && numeric.scalar === 'u32') predicate = 'value <= 2147483647u';
        if (requested === 'u32' && numeric.scalar === 'i32') predicate = 'value >= 0i';
        if (requested === 'i32' && numeric.scalar === 'f32') predicate = '(value == trunc(value) && value >= -2147483648f && value < 2147483648f)';
        if (requested === 'u32' && numeric.scalar === 'f32') predicate = '(value == trunc(value) && value >= 0f && value < 4294967296f)';
        if (requested === 'f32' && numeric.scalar !== 'f32') {
          ensureWrap();
          predicate = numeric.scalar === 'i32' ? 'i32(wrapU32(f32(value))) == value' : 'wrapU32(f32(value)) == value';
        }
      }
      const helper = `guard${nextSelector++}`;
      helperCode.push(`fn ${helper}(value: ${typeName(value.type)}) -> bool { return ${predicate}; }`);
      return { code: `${helper}(${value.code})`, type: 'bool' };
    }
    if (name === 'i32' || name === 'u32') {
      if (args.length !== 1) fail(`${name} expects exactly one value`, node);
      if (args[0].kind === 'literal' && typeof args[0].value === 'number') {
        let value;
        try { value = convertComponent(args[0].value, name); } catch (error) { fail(error.message, args[0]); }
        return { code: `${value}${name === 'i32' ? 'i' : 'u'}`, type: name };
      }
      const value = expression(args[0]);
      if (value.type === 'bool') return { code: `select(0${name === 'i32' ? 'i' : 'u'}, 1${name === 'i32' ? 'i' : 'u'}, ${value.code})`, type: name };
      if (value.type === 'i32' || value.type === 'u32') return { code: `${name}(${value.code})`, type: name };
      if (value.type !== 1) fail(`${name} expects a numeric scalar or bool`, args[0]);
      ensureWrap();
      return { code: name === 'u32' ? `wrapU32(${value.code})` : `i32(wrapU32(${value.code}))`, type: name };
    }
    if (structDefinitions.has(name)) {
      const type = helperTypes.get(name), fields = type.info.fields, entries = new Map();
      if (args.length !== fields.length * 2) fail(`${name} requires all fields exactly once`, node);
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i].kind === 'symbol' ? args[i].name : args[i].value;
        const field = fields.find(field => field.key === key);
        if (!field || entries.has(key)) fail(`Unknown or duplicate ${name} field: ${key}`, args[i]);
        const value = valueExpression(args[i + 1]);
        if (value.type !== elementType(field.info)) fail(`Wrong type for ${name} field ${key}`, args[i + 1]);
        entries.set(key, encodeStored(value.type, value.code));
      }
      return { code: `${typeName(type)}(${fields.map(field => entries.get(field.key)).join(', ')})`, type };
    }
    if (name === 'array' || name === 'many') {
      const [spec, ...initializers] = args;
      if (spec?.kind !== 'list' || spec.items.length < 1 || spec.items.length > 2 || spec.items[0].kind !== 'symbol') fail(`${name} expects (Element [capacity]) followed by initial elements`, node);
      const elementName = spec.items[0].name, element = resolveElementDescriptor(elementName);
      if (!element) fail('Unsupported shader array element type', spec);
      const count = spec.items[1] ? spec.items[1].kind === 'literal' ? spec.items[1].value : NaN : initializers.length;
      let info;
      try { info = (name === "many" ? manyType : arrayType)(element, count); } catch (error) { fail(error.message, spec); }
      if (initializers.length > count) fail('Array initializer exceeds capacity', node);
      const elementValueType = elementType(info.element), values = initializers.map(valueExpression);
      if (values.some(value => value.type !== elementValueType)) fail('Array initializer has the wrong element type', node);
      const packed = Array.from({ length: count }, (_, i) => values[i] ? encodeStored(elementValueType, values[i].code) : `${storedTypeName(elementValueType)}()`);
      const type = elementType(info);
      return { code: name === "many" ? `${typeName(type)}(${values.length}f, array<${storedTypeName(elementValueType)}, ${count}>(${packed.join(", ")}))` : `${typeName(type)}(${packed.join(", ")})`, type };
    }
    if (name === 'if') fail('Shader if requires statement position', node);
    if (name === 'get') {
      if (args.length !== 2) fail('get expects a collection/struct and index/key', node);
      const target = expression(args[0]);
      if (target.type?.kind === 'text' && args[1].kind === 'literal' && typeof args[1].value === 'string') return textField(target, args[1].value, node);
      if (target.type?.kind === 'struct' && args[1].kind === 'literal' && typeof args[1].value === 'string') return fieldAccess(target, args[1].value, node);
      if (target.type?.kind === 'storage' || target.type?.kind === 'array' || target.type?.kind === 'many') {
        const index = numericExpression(args[1]);
        if (shape(index.type)?.size !== 1) fail('Array index must be a scalar', args[1]);
        return readCollection(target, { ...index, code: index.type === 1 ? index.code : `f32(${index.code})` }, node);
      }
      fail('Shader get requires a collection index or literal struct key', node);
    }
    if (name === 'cap') {
      if (args.length !== 1) fail('cap expects one array or many', node);
      const target = expression(args[0]);
      if (target.type?.kind === 'storage') return { code: `bitcast<f32>(frame.values[${target.resource.slot}].y)`, type: 1 };
      if (target.type?.kind === 'array' || target.type?.kind === 'many') return { code: `${target.type.info.capacity}f`, type: 1 };
      fail('cap expects an array or many', node);
    }
    if (name === 'len') {
      if (args.length !== 1) fail('len expects one array or struct', node);
      const target = expression(args[0]);
      if (target.type?.kind === 'storage') return { code: `bitcast<f32>(frame.values[${target.resource.slot}].x)`, type: 1 };
      if (target.type?.kind === 'array') return { code: `${target.type.info.capacity}f`, type: 1 };
      if (target.type?.kind === 'many') return { code: `(${target.code}).length`, type: 1 };
      if (target.type?.kind === 'struct') return { code: `${target.type.info.fields.length}f`, type: 1 };
      fail('Shader len requires a collection or struct', node);
    }
    if (name === 'str' || name === 'num') fail(`${name} conversion is only available in regular code`, node);
    if (name === 'f32') {
      if (args.length !== 1) fail('f32 expects exactly one value', node);
      const value = expression(args[0]);
      if (value.type === 1) return value;
      if (value.type === 'i32' || value.type === 'u32') return { code: `f32(${value.code})`, type: 1 };
      if (value.type === 'bool') return { code: `select(0.0f, 1.0f, ${value.code})`, type: 1 };
      fail('Shader f32 conversion expects a numeric scalar or bool', args[0]);
    }
    if (name === 'bool') {
      if (args.length !== 1) fail('bool expects exactly one value', node);
      const candidate = expression(args[0]);
      if (candidate.type?.kind === 'storage' && candidate.type.collection === 'many') return { code: `(frame.values[${candidate.resource.slot}].x != 0u)`, type: 'bool' };
      const value = candidate;
      if (value.type === 'texture2d' || value.type?.kind === 'storage' || value.type?.kind === 'text') fail('Expected a shader value, not a resource', args[0]);
      return { code: boolCode(value.type, value.code), type: 'bool' };
    }
    if (name === 'not') {
      if (args.length !== 1) fail('not expects exactly one operand', node);
      const value = expression(args[0]);
      if (value.type !== 'bool') fail('not requires a boolean operand', args[0]);
      return { code: `(!${value.code})`, type: 'bool' };
    }
    if (name === 'and' || name === 'or') {
      if (!args.length) return { code: name === 'and' ? 'true' : 'false', type: 'bool' };
      const values = args.map(valueExpression), type = values[0].type;
      if (values.some(value => value.type !== type)) fail(`${name} selector operands must have the same shader type`, node);
      if (values.length === 1) return values[0];
      if (type === 'bool') return { code: `(${values.map(value => value.code).join(name === 'and' ? ' && ' : ' || ')})`, type };
      // WGSL lacks expression blocks. Lift a lazy selection function, explicitly
      // passing visible local values while keeping uniform inputs in module scope.
      const captures = new Map();
      for (const scope of scopes) for (const value of scope.values()) {
        if (value.owner === owner && !value.pending && !value.helper) captures.set(value.code, value);
      }
      const parameters = [...captures.values()];
      const callable = `selector${nextSelector++}`;
      const check = boolCode(type, 'selected');
      const stop = name === 'and' ? `!(${check})` : check;
      const body = values.slice(1).map(value => `if (${stop}) { return selected; }\nselected = ${value.code};`).join('\n');
      helperCode.push(`fn ${callable}(shaderPixel: vec2f${parameters.map(value => `, ${value.code}: ${typeName(value.type)}`).join('')}) -> ${typeName(type)} {
${builtinCode('shaderPixel')}
var selected: ${typeName(type)} = ${values[0].code};
${body}
return selected;
}`);
      return { code: `${callable}(xy${parameters.map(value => `, ${value.code}`).join('')})`, type };
    }
    if (name === '%' && !args.some(arg => { const value = expression(arg); return shape(value.type)?.scalar !== 'f32' || shape(value.type)?.size !== 1; })) {
      if (args.length !== 2) fail('% expects exactly two scalar operands', node);
      const values = args.map(numericExpression);
      if (values.some(value => value.type !== 1)) fail('% requires scalar numbers', node);
      return { code: `(${values[0].code} % ${values[1].code})`, type: 1 };
    }
    if (['+', '-', '*', '/', '%'].includes(name)) {
      if (name === '%' && args.length !== 2) fail('% expects exactly two operands', node);
      if (!args.length && (name === '-' || name === '/')) fail(`${name} needs at least one operand`, node);
      const operands = args.map(numericExpression);
      if (!operands.length) return { code: name === '+' ? '0.0f' : '1.0f', type: 1 };
      if (operands.length === 1) {
        const { code, type } = operands[0];
        if (name === '-') {
          const operation = shape(type)?.scalar === 'u32' ? `(${typeName(type)}(0u) - value)` : '(-value)';
          if (['i32', 'u32'].includes(shape(type)?.scalar)) {
            const helper = `negate${nextSelector++}`;
            helperCode.push(`fn ${helper}(value: ${typeName(type)}) -> ${typeName(type)} { return ${operation}; }`);
            return { code: `${helper}(${code})`, type };
          }
          return { code: `(-${code})`, type };
        }
        if (name === '/') {
          if (isMatrix(type)) fail('Matrix division is not supported', node);
          const scalar = shape(type).scalar, one = scalar === 'i32' ? '1i' : scalar === 'u32' ? '1u' : '1f';
          return { code: `(${shape(type).size === 1 ? one : `${typeName(type)}(${one})`} / ${code})`, type };
        }
        return operands[0];
      }
      return operands.slice(1).reduce((left, right) => {
        const languageType = type => typeof type === 'number' ? (type === 1 ? 'f32' : `vec${type}f`) : type;
        let result;
        try { result = resultType(name, languageType(left.type), languageType(right.type)); }
        catch (error) { fail(error.message, node); }
        const type = helperTypes.get(result) || result;
        const broadcast = value => shape(type)?.size >= 2 && shape(value.type)?.size === 1 ? `${typeName(type)}(${value.code})` : value.code;
        if (['i32', 'u32'].includes(shape(type)?.scalar)) {
          const helper = `arithmetic${nextSelector++}`;
          helperCode.push(`fn ${helper}(a: ${typeName(type)}, b: ${typeName(type)}) -> ${typeName(type)} { return a ${name} b; }`);
          return { code: `${helper}(${broadcast(left)}, ${broadcast(right)})`, type };
        }
        return { code: `(${broadcast(left)} ${name} ${broadcast(right)})`, type };
      }, operands[0]);
    }
    if (name === 'copy') {
      if (args.length !== 1) fail('copy expects one value', node);
      return valueExpression(args[0]);
    }
    if (/^mat([234])x\1f$/.test(name)) {
      const size = matrixSize(name), values = args.map(numericExpression);
      const type = name, constructor = `mat${size}x${size}f`;
      if (!values.length) return { code: `${constructor}()`, type };
      if (!(values.length === size && values.every(value => value.type === size)) &&
          !(values.length === size * size && values.every(value => value.type === 1))) {
        fail(`${name} expects no arguments, ${size} float-vector columns, or ${size * size} scalars`, node);
      }
      return { code: `${constructor}(${values.map(value => value.code).join(', ')})`, type };
    }
    if (vectorInfo(name)) {
      const info = vectorInfo(name), type = info.scalar === 'f32' ? info.size : name, values = args.map(numericExpression);
      if (values.some(value => isMatrix(value.type))) fail('Vector constructors do not accept matrices', node);
      const count = values.reduce((sum, value) => sum + shape(value.type).size, 0);
      if (values.length && count !== info.size && !(values.length === 1 && shape(values[0].type).size === 1)) fail(`${name} needs ${info.size} components or one scalar`, node);
      const scalar = info.scalar;
      const converted = values.map((value, index) => {
        const source = shape(value.type);
        if ((scalar === 'i32' || scalar === 'u32') && args[index].kind === 'literal' && typeof args[index].value === 'number') return `${convertComponent(args[index].value, scalar)}${scalar === 'i32' ? 'i' : 'u'}`;
        if (source.scalar === scalar) return value.code;
        const target = source.size === 1 ? scalar : `vec${source.size}${scalar === 'i32' ? 'i' : scalar === 'u32' ? 'u' : 'f'}`;
        if (source.scalar === 'f32' && (scalar === 'i32' || scalar === 'u32')) {
          ensureWrap();
          if (source.size === 1) return scalar === 'u32' ? `wrapU32(${value.code})` : `i32(wrapU32(${value.code}))`;
          const helper = `convert${source.size}${scalar}${nextSelector++}`;
          const components = Array.from({ length: source.size }, (_, i) => scalar === 'u32' ? `wrapU32(value[${i}u])` : `i32(wrapU32(value[${i}u]))`);
          helperCode.push(`fn ${helper}(value: ${typeName(value.type)}) -> ${target} { return ${target}(${components.join(', ')}); }`);
          return `${helper}(${value.code})`;
        }
        return `${target}(${value.code})`;
      });
      return { code: `${typeName(type)}(${converted.join(', ')})`, type };
    }
    if (name === 'blend') {
      if (args.length < 1 || args.length > 2) fail('blend expects one or two vec4f colors', node);
      const colors = args.map(expression);
      if (colors.some(color => color.type !== 4)) fail('blend expects vec4f colors', node);
      if (!needsBlend) { needsBlend = true; helperCode.push(blendWGSL); }
      if (colors.length === 1) { needsBefore = true; needsSampler = true; }
      const background = colors[1]?.code ?? 'textureSampleLevel(before, shaderSampler, uv, 0f)';
      return { code: `blendColors(${colors[0].code}, ${background})`, type: 4 };
    }
    if (name === 'sample') {
      if (args.length !== 2) fail('sample expects a texture2d or text and vec2f UV coordinates', node);
      const image = expression(args[0]), uv = numericExpression(args[1]);
      if (image.type !== 'texture2d' && image.type?.kind !== 'text' || uv.type !== 2) fail('sample expects a texture2d or text and vec2f UV coordinates', node);
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
    return { code: `${callable.code}(xy${values.length ? ', ' : ''}${values.map(value => value.code).join(', ')})`, type };
  };
  const numericExpression = node => {
    const value = expression(node);
    if (!shape(value.type) && !isMatrix(value.type)) fail('Expected a numeric shader value, not a resource', node);
    return value;
  };
  const valueExpression = node => {
    const value = expression(node);
    if (value.type === 'texture2d' || value.type?.kind === 'storage' || value.type?.kind === 'text') fail('Expected a shader value, not a resource', node);
    return value;
  };
  const elementType = info => {
    if (info.type === 'array' || info.type === 'many') {
      if (!arrayValues.has(info)) arrayValues.set(info, { kind: info.type, info, id: arrayValues.size });
      return arrayValues.get(info);
    }
    if (!info.fields) return helperTypes.get(info.type);
    if (!structTypes.has(info)) structTypes.set(info, { kind: 'struct', info });
    return structTypes.get(info);
  };
  const typeName = type => {
    if (type?.kind === 'many') {
      if (!generatedStructs.has(type.info)) {
        const name = `Struct${generatedStructs.size}`;
        generatedStructs.set(type.info, { name, code: '' });
        generatedStructs.get(type.info).code = `struct ${name} {\nlength: f32,\ndata: array<${storedTypeName(elementType(type.info.element))}, ${type.info.capacity}>,\n}`;
      }
      return generatedStructs.get(type.info).name;
    }
    if (type?.kind === 'array') {
      return `array<${storedTypeName(elementType(type.info.element))}, ${type.info.capacity}>`;
    }
    if (type?.kind === 'struct') {
      if (!generatedStructs.has(type.info)) {
        const name = `Struct${generatedStructs.size}`;
        generatedStructs.set(type.info, { name, code: '' });
        const fields = type.info.fields.map(field => `f${field.index}: ${storedTypeName(elementType(field.info))},`).join('\n');
        generatedStructs.get(type.info).code = `struct ${name} {\n${fields}\n}`;
      }
      return generatedStructs.get(type.info).name;
    }
    return type === 'bool' ? 'bool' : type === 'texture2d' ? 'texture_2d<f32>' : isMatrix(type) ? type : type === 'i32' || type === 'u32' || isVector(type) ? type : type === 1 ? 'f32' : `vec${type}f`;
  };
  const storedTypeName = type => type === 'bool' ? 'f32' : typeName(type);
  function ensureWrap() {
    if (numericConversions.has('wrapU32')) return;
    numericConversions.add('wrapU32');
    helperCode.push(`fn wrapU32(value: f32) -> u32 { let remainder = trunc(value) % 4294967296f; if (remainder < 0f) { return 0u - u32(-remainder); } return u32(remainder); }`);
  }
  const encodeStored = (type, code) => type === 'bool' ? `select(0f, 1f, ${code})` : code;
  const decodeStored = (type, code) => type === 'bool' ? `(${code} != 0f)` : code;
  function fieldAccess(target, key, node, raw = false) {
    const field = target.type.info.fields.find(field => field.key === key);
    if (!field) fail(`Unknown struct field: ${key}`, node);
    const type = elementType(field.info), code = `(${target.code}).f${field.index}`;
    return { code: raw ? code : decodeStored(type, code), type, encodedBool: raw && type === 'bool' };
  }
  function readCollection(target, index, node) {
    if (target.type?.kind === 'array' || target.type?.kind === 'many') {
      const info = target.type.info, type = elementType(info.element), name = `readArray${target.type.id}`;
      if (!collectionReaders.has(info)) {
        collectionReaders.set(info, true);
        helperCode.push(`fn ${name}(value: ${typeName(target.type)}, index: f32) -> ${typeName(type)} {
if (!(index >= 0.0f && index < ${info.type === "many" ? "value.length" : info.capacity + "f"}) || floor(index) != index) { return ${typeName(type)}(); }
return ${decodeStored(type, `${info.type === "many" ? "value.data" : "value"}[u32(index)]`)};
}`);
      }
      return { code: `${name}(${target.code}, ${index.code})`, type };
    }
    const resource = target.resource;
    if (!resource) fail('Runtime-sized array helper parameters are not supported yet; reference shader inputs directly', node);
    const type = elementType(resource.element), name = `readStorage${resource.binding}`;
    if (!collectionReaders.has(resource)) {
      collectionReaders.set(resource, true);
      helperCode.push(`fn ${name}(index: f32) -> ${typeName(type)} {
if (!(index >= 0.0f && index < bitcast<f32>(frame.values[${resource.slot}].x)) || floor(index) != index) { return ${typeName(type)}(); }
return ${decodeStored(type, `${resource.code}[u32(index)]`)};
}`);
    }
    return { code: `${name}(${index.code})`, type };
  }
  function boolCode(type, code) {
    if (type === 'bool') return code;
    const suffix = (type?.kind === 'array' || type?.kind === 'many') ? `Array${type.id}` : typeof type === 'object' ? typeName(type) : type;
    if (!boolHelpers.has(type)) {
      boolHelpers.add(type);
      const result = type === 1 ? '((value == value) && (value != 0.0f))' : type === 'i32' ? '(value != 0i)' : type === 'u32' ? '(value != 0u)' : type?.kind === 'many' ? '(value.length != 0.0f)' : 'true';
      helperCode.push(`fn bool${suffix}(value: ${typeName(type)}) -> bool { return ${result}; }`);
    }
    return `bool${suffix}(${code})`;
  }
  function manyEditor(type, operation) {
    const name = `${operation}Many${type.id}`;
    if (!manyEditors.has(name)) {
      manyEditors.add(name);
      const element = typeName(elementType(type.info.element)), result = typeName(type);
      helperCode.push(operation === 'insert' ? `fn ${name}(value: ${result}, item: ${element}, index: f32) -> ${result} {
var result = value;
if (!(index >= 0f && index <= result.length) || floor(index) != index || result.length >= ${type.info.capacity}f) { return result; }
var i = u32(result.length);
loop { if (i <= u32(index)) { break; } result.data[i] = result.data[i - 1u]; i -= 1u; }
result.data[u32(index)] = ${encodeStored(elementType(type.info.element), 'item')};
result.length += 1f;
return result;
}` : `fn ${name}(value: ${result}, index: f32) -> ${result} {
var result = value;
if (!(index >= 0f && index < result.length) || floor(index) != index) { return result; }
var i = u32(index);
loop { if (i + 1u >= u32(result.length)) { break; } result.data[i] = result.data[i + 1u]; i += 1u; }
result.length -= 1f;
return result;
}`);
    }
    return name;
  }
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
        if (type?.kind === 'storage' && type.info) type = elementType(type.info);
        if (type?.kind === 'storage') fail('Runtime-sized array helper parameters are not supported yet; reference shader inputs directly', name);
        if (scope.has(name.name) || specialForms.has(name.name)) fail(`Invalid or duplicate helper parameter: ${name.name}`, name);
        const local = { code: type === 'texture2d' ? `argument${index}` : `local${nextLocal++}`, type, mutable: type !== 'texture2d', owner: helper };
        scope.set(name.name, local);
        parametersCode.push(`argument${index}: ${typeName(type)}`);
        if (type !== 'texture2d') copies.push(`var ${local.code}: ${typeName(type)} = argument${index}; ${nameComment(name.name)}`);
        return { name: name.name, type };
      });
      const compiled = statements(body, scope);
      if (!compiled.returns) fail('Shader helper must explicitly return a boolean, scalar, vector, or matrix', helper.node);
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
  const builtinCode = pixel => `  // builtins
  let xy = ${pixel};
  let x  = xy.x;
  let y  = xy.y;
  let wh = frame.data.xy;
  let w  = wh.x;
  let h  = wh.y;
  let uv = xy / wh;
  let u  = uv.x;
  let v  = uv.y;
  let t  = frame.data.z;
  let dt = frame.data.w;`;
  function writable(node) {
    if (node.kind === 'symbol') return lookup(node);
    if (node.kind !== 'access') fail('set expects a name or dot target', node);
    const parent = writable(node.target);
    if (parent.type?.kind === 'storage') fail('Shader arrays are read-only; mutate them in regular code', node);
    if (parent.type?.kind === 'many') {
      if (node.quoted || !/^\d+$/.test(node.key) || Number(node.key) >= parent.type.info.capacity) fail('many dot assignment requires an index within capacity', node);
      const type = elementType(parent.type.info.element);
      return { ...parent, code: `${parent.code}.data[${node.key}u]`, type, encodedBool: type === 'bool', guard: [parent.guard, `${node.key}f < ${parent.code}.length`].filter(Boolean).join(' && ') };
    }
    if (parent.type?.kind === 'array') {
      if (node.quoted || !/^\d+$/.test(node.key) || Number(node.key) >= parent.type.info.capacity) fail('Array dot assignment requires an index within capacity', node);
      const type = elementType(parent.type.info.element);
      return { ...parent, code: `${parent.code}[${node.key}u]`, type, encodedBool: type === 'bool' };
    }
    if (parent.type?.kind === 'struct') return { ...parent, ...fieldAccess(parent, node.key, node, true) };
    const vector = shape(parent.type);
    if (!node.quoted && /^-?\d+$/.test(node.key) && (isMatrix(parent.type) || vector?.size >= 2)) {
      const size = isMatrix(parent.type) ? matrixSize(parent.type) : vector.size, index = Number(node.key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= size) fail('Numeric dot index is outside this vector/matrix', node);
      return { ...parent, code: `${parent.code}[${index}u]`, type: isMatrix(parent.type) ? size : shapeType(1, vector.scalar) };
    }
    if (node.quoted || !/^[xyzw]{1,4}$/.test(node.key) || new Set(node.key).size !== node.key.length ||
        !vector || vector.size < 2 || [...node.key].some(key => 'xyzw'.indexOf(key) >= vector.size)) fail('Invalid writable vector swizzle', node);
    return { ...parent, code: `${parent.code}.${node.key}`, type: shapeType(node.key.length, vector.scalar) };
  }
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
      const mergeReturn = (type, at) => {
        if (type === null) return;
        if (returnType !== null && returnType !== type) fail('Shader return types must match across all paths', at);
        returnType = type;
      };
      const lines = nodes.map(statement => {
        if (returns) fail('Unreachable shader statement after return', statement);
        if (statement.kind === 'block') {
          const block = statements(statement.items);
          returns = block.returns;
          mergeReturn(block.returnType, statement);
          return `{\n${block.code}\n}`;
        }
        if (statement.kind !== 'list') fail('Expected a shader statement', statement);
        const [head, ...args] = statement.items;
        if (head?.name === 'if') {
          const parsed = parseConditional(args, (message, at) => fail(message, at || statement));
          const compiled = parsed.branches.map(branch => {
            const condition = expression(branch.condition);
            if (condition.type === 'texture2d' || condition.type?.kind === 'text' || condition.type?.kind === 'storage' && condition.type.collection !== 'many') fail('Expected a shader condition value', branch.condition);
            const code = condition.type?.kind === 'storage' ? `(frame.values[${condition.resource.slot}].x != 0u)` : boolCode(condition.type, condition.code);
            const body = statements(branch.body);
            mergeReturn(body.returnType, statement);
            return { ...body, code: `if (${code}) {\n${body.code}\n}` };
          });
          let fallback = null;
          if (parsed.otherwise) {
            fallback = statements(parsed.otherwise);
            mergeReturn(fallback.returnType, statement);
          }
          returns = Boolean(fallback?.returns) && compiled.every(branch => branch.returns);
          return compiled.map(branch => branch.code).join(' else ') + (fallback ? ` else {\n${fallback.code}\n}` : '');
        }
        if (head?.name === 'let') {
          const local = scope.get(args[0].name);
          if (local.helper) { local.pending = false; return ''; }
          const value = expression(args[1]);
          if (value.type?.kind === 'text') {
            Object.assign(local, value, { pending: false, mutable: false, owner: null });
            return '';
          }
          if (value.type === 'texture2d' || value.type?.kind === 'storage') fail('Expected a shader value, not a resource', args[1]);
          Object.assign(local, { type: value.type, pending: false });
          return `var ${local.code}: ${typeName(value.type)} = ${value.code}; ${nameComment(args[0].name)}`;
        }
        if (head?.name === 'insert' || head?.name === 'remove') {
          const operation = head.name;
          if (operation === 'insert' ? args.length < 2 || args.length > 3 : args.length !== 2) fail(`${operation} has invalid arity`, statement);
          const target = writable(args[0]);
          if (!target.mutable || target.type?.kind !== 'many') fail(`${operation} requires a local bounded many`, args[0]);
          const item = operation === 'insert' ? valueExpression(args[1]) : null;
          if (item && item.type !== elementType(target.type.info.element)) fail('Wrong many insertion element type', args[1]);
          const indexNode = operation === 'insert' ? args[2] : args[1];
          const index = indexNode ? numericExpression(indexNode) : { code: `${target.code}.length`, type: 1 };
          if (shape(index.type)?.size !== 1) fail('many edit index must be a scalar', indexNode);
          const assignment = `${target.code} = ${manyEditor(target.type, operation)}(${target.code}, ${item ? item.code + ', ' : ''}${index.type === 1 ? index.code : `f32(${index.code})`});`;
          return target.guard ? `if (${target.guard}) { ${assignment} }` : assignment;
        }
        if (head?.name === 'set') {
          if (args.length !== 2) fail('set expects a name or dot target and value', statement);
          const local = writable(args[0]), value = valueExpression(args[1]);
          if (local.helper) fail(`Cannot reassign shader helper: ${args[0].name}`, args[0]);
          if (!local.mutable) fail(`Cannot assign shader input: ${args[0].name}`, args[0]);
          if (local.type !== value.type) fail('Shader assignment must preserve its variable type', statement);
          const assignment = `${local.code} = ${local.encodedBool ? encodeStored(value.type, value.code) : value.code};`;
          return local.guard ? `if (${local.guard}) { ${assignment} }` : assignment;
        }
        if (head?.name === 'return') {
          if (args.length !== 1) fail('Shader return expects one value', statement);
          const value = valueExpression(args[0]);
          if (owner === fragmentOwner && value.type !== 4) fail('Shader return must be a vec4f RGBA color', args[0]);
          returns = true;
          mergeReturn(value.type, statement);
          return `return ${value.code};`;
        }
        fail(`Unsupported shader statement: ${head?.name || statement.kind}`, statement);
      });
      return { code: lines.filter(Boolean).join('\n'), returns, returnType };
    } finally { scopes.pop(); }
  };
  const compiled = statements(body);
  if (!compiled.returns) fail('Shader must explicitly return a vec4f RGBA color');
  for (let i = 0; i < helpers.length; i++) compileHelper(helpers[i]);
  if (needsBefore) {
    const resource = { name: 'before', type: 'texture2d', kind: 'texture', code: 'before',
      binding: resources.length + 1, automatic: true };
    uniforms.push(resource); resources.push(resource);
  }
  const hasSampler = resources.some(resource => resource.kind === 'texture') || needsSampler;
  const resourceCode = resources.map(resource => resource.kind === 'storage'
    ? `@group(0) @binding(${resource.binding}) var<storage, read> ${resource.code}: array<${storedTypeName(elementType(resource.element))}${resource.capacity ? ', ' + resource.capacity : ''}>;`
    : `@group(0) @binding(${resource.binding}) var ${resource.code}: texture_2d<f32>;`).join('\n');
  const wgsl = `${vertexWGSL}
struct Frame { data: vec4f, ${uniformCount ? `values: array<vec4u, ${uniformCount}>,` : ''} }
@group(0) @binding(0) var<uniform> frame: Frame;
${[...generatedStructs.values()].reverse().map(struct => struct.code).join('\n')}
${resourceCode}
${hasSampler ? `@group(0) @binding(${resources.length + 1}) var shaderSampler: sampler;` : ''}
${helperCode.join('\n')}
@fragment fn fragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
${builtinCode('pixel.xy')}
${compiled.code}
}`;
  return { wgsl, uniforms, uniformCount, resources, hasSampler, parameterCount, source, start: node.start, end: node.end };
}
