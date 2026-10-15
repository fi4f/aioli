import { Trace } from './trace.js';
import { Types } from './types.js';
import { Numeric } from './numeric.js';
import { Structures } from './structures.js';
import { NumericTypes } from './numeric-types.js';
import { Conditionals } from './conditionals.js';
import { Transforms } from './transforms.js';
import { Codegen } from './codegen.js';
import { Colors } from './colors.js';

const __vertexWGSL__ = `
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[index], 0, 1);
}`;

// Shader expressions are typed; text bodies are lifted into regular Lisp.
function __compileShader__(node, source, { structDefinitions = new Map(), hoistText } = {}) {
  const fail = (message, at = node) => {
    throw Trace.locate(new SyntaxError(message), source, at.start, at.end);
  };
  const [, parameters, ...body] = node.items;
  if (parameters?.kind !== 'list') fail('sh expects a parameter list followed by body statements');
  const uniforms = [];
  let needsSampler = false;
  let needsBefore = false;
  let needsBlend = false;
  const builtins = new Map(
    ['t', 'dt', 'x', 'y', 'u', 'v', 'w', 'h'].map((name) => [name, { code: name, type: 1 }]),
  );
  for (const name of ['xy', 'uv', 'wh']) builtins.set(name, { code: name, type: 2 });
  builtins.set('before', { code: 'before', type: 'texture2d' });
  const reserved = new Set([
    'if',
    'let',
    'set',
    'return',
    'fn',
    'async',
    'promise',
    'await',
    'resolve',
    'reject',
    'sample',
    'sample-nearest',
    'copy',
    'get',
    'type',
    'len',
    'cap',
    'array',
    'many',
    'insert',
    'remove',
    'bool',
    'and',
    'or',
    'not',
    '+',
    '-',
    '*',
    '/',
    '%',
    'mat2x2f',
    'mat3x3f',
    'mat4x4f',
  ]);
  reserved.add('2d');
  reserved.add('3d');
  reserved.add('text');
  reserved.add('blend');
  for (const name of [
    'abs',
    'min',
    'max',
    'clamp',
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'sqrt',
    'log2',
  ])
    reserved.add(name);
  for (const name of ['<', '>', '<=', '>=']) reserved.add(name);
  for (const name of ['while', 'until', 'for', 'break', 'continue']) reserved.add(name);
  for (const name of [
    'num',
    'str',
    ...NumericTypes.scalarTypes,
    ...NumericTypes.vectorTypes,
    ...NumericTypes.matrixTypes,
    ...Object.keys(NumericTypes.typeAliases),
  ]) {
    reserved.add(name);
    reserved.add(name + '?');
  }
  const helperTypes = new Map([
    ['bool', 'bool'],
    ['mat2x2f', 'mat2x2f'],
    ['mat3x3f', 'mat3x3f'],
    ['mat4x4f', 'mat4x4f'],
    ['texture2d', 'texture2d'],
  ]);
  helperTypes.set('f32', 1);
  helperTypes.set('i32', 'i32');
  helperTypes.set('u32', 'u32');
  for (const type of NumericTypes.vectorTypes)
    helperTypes.set(type, type.endsWith('f') ? NumericTypes.vectorInfo(type).size : type);
  const shape = (type) =>
    typeof type === 'number'
      ? { size: type, scalar: 'f32' }
      : ['i32', 'u32'].includes(type)
        ? { size: 1, scalar: type }
        : NumericTypes.vectorInfo(type);
  const shapeType = (size, scalar) =>
    scalar === 'f32' ? size : size === 1 ? scalar : `vec${size}${scalar === 'i32' ? 'i' : 'u'}`;
  const structTypes = new Map();
  for (const [name, constructor] of structDefinitions) {
    const info = Structures.structDefinitionInfo(constructor);
    structTypes.set(info, { kind: 'struct', info });
    helperTypes.set(name, structTypes.get(info));
  }
  for (const [name, element] of [
    ...[
      ...NumericTypes.scalarTypes,
      ...NumericTypes.vectorTypes,
      'mat2x2f',
      'mat3x3f',
      'mat4x4f',
    ].map((name) => [name, name]),
    ...structDefinitions,
  ]) {
    helperTypes.set(`array<${name}>`, {
      kind: 'storage',
      element: Structures.elementInfo(element),
      collection: 'array',
    });
  }
  const resolveElementDescriptor = (name) => {
    name = NumericTypes.canonicalType(name);
    if (structDefinitions.has(name)) return structDefinitions.get(name);
    if (name === 'bool') return 'bool';
    if (
      [
        ...NumericTypes.scalarTypes,
        ...NumericTypes.vectorTypes,
        'mat2x2f',
        'mat3x3f',
        'mat4x4f',
      ].includes(name)
    )
      return name;
    const match = name.match(/^(array|many)<(.+),(\d+)>$/);
    if (!match) return null;
    const element = resolveElementDescriptor(match[2]);
    return element
      ? (match[1] === 'many' ? Structures.manyType : Structures.arrayType)(
          element,
          Number(match[3]),
        )
      : null;
  };
  const resolveType = (name) => {
    const canonical = NumericTypes.canonicalType(name);
    if (canonical !== name) {
      const type = resolveType(canonical);
      if (type) helperTypes.set(name, type);
      return type;
    }
    if (helperTypes.has(name)) return helperTypes.get(name);
    const sized = name.match(/^(array|many)<(.+),(\d+)>$/),
      match = sized || name.match(/^(array|many)<(.+)>$/);
    if (!match) return undefined;
    const element = resolveElementDescriptor(match[2]);
    if (!element) return undefined;
    const info = sized
      ? (match[1] === 'many' ? Structures.manyType : Structures.arrayType)(
          element,
          Number(match[3]),
        )
      : undefined;
    const type = {
      kind: 'storage',
      element: Structures.elementInfo(element),
      capacity: info?.capacity,
      info,
      collection: match[1],
    };
    helperTypes.set(name, type);
    return type;
  };
  const specialForms = new Set(['if', 'let', 'set', 'return', 'fn', 'and', 'or', 'not']);
  const typedParameters = (list, types) => {
    return Types.parseParameters(list.items, {
      required: true,
      types: {
        has: (name) => Boolean(resolveType(name)),
        [Symbol.iterator]: () => types.keys(),
      },
      fail,
    }).map((parameter) => ({
      name: parameter.node,
      type: types.get(parameter.type),
      annotation: NumericTypes.canonicalType(parameter.type),
    }));
  };
  const argumentsScope = new Map();
  let uniformCount = 0;
  const resources = [];
  for (const { name, type, annotation } of typedParameters(parameters, helperTypes)) {
    if (argumentsScope.has(name.name) || builtins.has(name.name) || reserved.has(name.name))
      fail(`Invalid or duplicate shader parameter: ${name.name}`, name);
    if (type === 'bool' || (type?.kind === 'storage' && !Structures.isHostShareable(type.element)))
      fail(`Shader parameter ${name.name}: booleans cannot cross the host/GPU boundary`, name);
    if (type?.kind === 'struct') fail('Struct shader inputs require array<StructName>', name);
    if (type === 'texture2d' || type?.kind === 'storage') {
      const binding = resources.length + 1;
      const resource = {
        name: name.name,
        type: annotation,
        binding,
        code: `resource${resources.length}`,
        kind: type === 'texture2d' ? 'texture' : 'storage',
        element: type.element,
        capacity: type.capacity,
        collection: type.collection,
      };
      if (type?.kind === 'storage') resource.slot = uniformCount++;
      uniforms.push(resource);
      resources.push(resource);
      argumentsScope.set(name.name, { code: resource.code, type, resource });
    } else {
      const slot = uniformCount;
      const columns = Numeric.isMatrix(type) ? NumericTypes.matrixSize(type) : 1;
      uniformCount += columns;
      uniforms.push({ name: name.name, type: annotation, slot });
      const uniformShape = shape(type);
      const raw = uniformShape ? `frame.values[${slot}].${'xyzw'.slice(0, uniformShape.size)}` : '';
      const code = Numeric.isMatrix(type)
        ? `mat${columns}x${columns}f(${Array.from({ length: columns }, (_, i) => `bitcast<vec${columns}f>(frame.values[${slot + i}].${'xyzw'.slice(0, columns)})`).join(', ')})`
        : `bitcast<${uniformShape.scalar === 'f32' ? (uniformShape.size === 1 ? 'f32' : `vec${uniformShape.size}f`) : uniformShape.size === 1 ? uniformShape.scalar : type}>(${raw})`;
      argumentsScope.set(name.name, { code, type });
    }
  }
  let scopes = [builtins, argumentsScope];
  const parameterCount = uniforms.length,
    liftedText = new Map();
  function textField(value, key, at) {
    if (key === 'uv') return { code: `(xy / ${value.metrics}.xy)`, type: 2 };
    if (key === 'wh') return { code: `${value.metrics}.xy`, type: 2 };
    if (key === 'texture') return { code: value.code, type: 'texture2d' };
    if (key === 'origin') return { code: value.origin, type: 2 };
    const index = ['w', 'h', 'baseline', 'lines'].indexOf(key);
    if (index < 0) fail(`Unknown shader text field: ${key}`, at);
    return { code: `${value.metrics}.${'xyzw'[index]}`, type: 1 };
  }
  function textureField(value, key, at) {
    if (!['w', 'h', 'wh', 'uv'].includes(key)) fail(`Unknown texture field: ${key}`, at);
    const dimensions = `vec2f(textureDimensions(${value.code}, 0))`;
    if (key === 'uv') return { code: `(xy / ${dimensions})`, type: 2 };
    return {
      code: key === 'wh' ? dimensions : `(${dimensions}).${key === 'w' ? 'x' : 'y'}`,
      type: key === 'wh' ? 2 : 1,
    };
  }
  const helpers = [],
    helperCode = [];
  const transformHelpers = new Set();
  const generatedStructs = new Map(),
    collectionReaders = new Map(),
    arrayValues = new Map(),
    manyEditors = new Set();
  const numericConversions = new Set();
  const boolHelpers = new Set();
  let nextSelector = 0;
  const fragmentOwner = {};
  let owner = fragmentOwner;
  let nextLocal = 0;
  let nextCapture = 0;
  let loopDepth = 0;
  function __capture__(value, at) {
    value = value.__binding__ || value;
    if (value.pending)
      fail(`Shader variable ${at.name || 'capture'} used before initialization`, at);
    if (!value.owner || value.owner === owner) return value;
    let capture = owner.__captures__.get(value);
    if (!capture) {
      const index = nextCapture++;
      capture = {
        type: value.type,
        mutable: value.mutable,
        owner,
        code: `__captureValue${index}__`,
        __pointer__: value.mutable ? `__capturePointer${index}__` : null,
        __name__: `capture${index}`,
        __binding__: value,
        __written__: false,
      };
      owner.__captures__.set(value, capture);
    }
    return capture;
  }
  function __captureBinding__(capture, at) {
    const value = __capture__(capture.__binding__, at);
    if (capture.__written__ && value.__binding__) value.__written__ = true;
    return value;
  }
  const __captureArgument__ = (capture, value) =>
    capture.__written__ ? value.__pointer__ || `&${value.code}` : value.code;
  const __captureParameter__ = (capture) =>
    `${capture.__name__}: ${capture.__written__ ? `ptr<function, ${typeName(capture.type)}>` : typeName(capture.type)}`;
  function __resolveCaptures__(code, captures) {
    for (const capture of captures.values()) {
      code = code.replaceAll(
        capture.code,
        capture.__written__ ? `(*${capture.__name__})` : capture.__name__,
      );
      if (capture.__pointer__) code = code.replaceAll(capture.__pointer__, capture.__name__);
    }
    return code;
  }
  const lookup = (node) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const value = scopes[i].get(node.name);
      if (value) {
        if (value === builtins.get('before')) needsBefore = true;
        if (value.pending) fail(`Shader variable ${node.name} used before initialization`, node);
        return __capture__(value, node);
      }
    }
    fail(`Unknown shader symbol: ${node.name}`, node);
  };
  const expression = (node) => {
    if (node.kind === 'access') {
      const target = expression(node.target);
      if (node.computed) {
        if (node.key.kind === 'literal' && typeof node.key.value === 'string') {
          if (target.type === 'texture2d') return textureField(target, node.key.value, node);
          if (target.type?.kind === 'text') return textField(target, node.key.value, node);
          if (target.type?.kind === 'struct') return fieldAccess(target, node.key.value, node);
        }
        const index = computedIndex(node.key);
        if (['storage', 'array', 'many'].includes(target.type?.kind))
          return readCollection(target, index, node);
        const vector = shape(target.type);
        if (Numeric.isMatrix(target.type) || vector?.size >= 2) return readNumeric(target, index);
        fail('Shader computed access requires an indexed value or a literal field key', node);
      }
      if (target.type === 'texture2d') return textureField(target, node.key, node);
      if (target.type?.kind === 'text') return textField(target, node.key, node);
      if (target.type?.kind === 'struct') return fieldAccess(target, node.key, node);
      if (
        target.type?.kind === 'storage' ||
        target.type?.kind === 'array' ||
        target.type?.kind === 'many'
      ) {
        if (node.quoted || !/^\d+$/.test(node.key) || !Number.isSafeInteger(Number(node.key)))
          fail('Array dot access requires an integer index', node);
        return readCollection(target, { code: `${Number(node.key)}f`, type: 1 }, node);
      }
      const vector = shape(target.type);
      if (
        !node.quoted &&
        /^-?\d+$/.test(node.key) &&
        (Numeric.isMatrix(target.type) || vector?.size >= 2)
      ) {
        const size = Numeric.isMatrix(target.type)
            ? NumericTypes.matrixSize(target.type)
            : vector.size,
          index = Number(node.key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= size)
          fail('Numeric dot index is outside this vector/matrix', node);
        return {
          code: `(${target.code})[${index}u]`,
          type: Numeric.isMatrix(target.type) ? size : shapeType(1, vector.scalar),
        };
      }
      if (node.quoted || !/^[xyzw]{1,4}$/.test(node.key))
        fail('Shader dot access requires a one-to-four component vector swizzle', node);
      const value = target;
      const required = Math.max(...[...node.key].map((component) => 'xyzw'.indexOf(component) + 1));
      if (!vector || vector.size < 2 || vector.size < required)
        fail(`${node.key} cannot access this vector`, node);
      return {
        code: `(${value.code}).${node.key}`,
        type: shapeType(node.key.length, vector.scalar),
      };
    }
    if (node.kind === 'literal') {
      if (typeof node.value === 'boolean') return { code: String(node.value), type: 'bool' };
      if (node.scalarType) return __numericConstruction__(node, node.scalarType);
      if (typeof node.value !== 'number' || !Number.isFinite(Math.fround(node.value)))
        fail('Shader literals must be finite f32 numbers', node);
      return {
        code: Object.is(node.value, -0) ? '-0.0f' : `${node.value}f`,
        type: 1,
      };
    }
    if (node.kind === 'symbol') {
      const value = lookup(node);
      if (value.helper) fail('Shader helpers can only be used in direct calls', node);
      return value;
    }
    if (node.kind !== 'list') fail('Expected a shader expression', node);
    const [head, ...args] = node.items;
    if (node.items[1]?.kind === 'colon') {
      if (node.items.length !== 3 || node.items[2].kind !== 'symbol')
        fail('Type assertion expects (value : type)', node);
      const value = expression(head),
        declared = resolveType(node.items[2].name),
        expected = declared?.info ? elementType(declared.info) : declared;
      if (!expected) fail(`Unknown shader type: ${node.items[2].name}`, node.items[2]);
      if (value.type !== expected) fail(`Shader expression must be ${node.items[2].name}`, node);
      return value;
    }
    if (head?.kind !== 'symbol') fail('Expected a shader operation name', node);
    const name = NumericTypes.canonicalType(head.name);
    if (['type', 'async', 'promise', 'await', 'resolve', 'reject'].includes(name))
      fail(`${name} is only supported in host code`, node);
    if (
      [
        'abs',
        'min',
        'max',
        'clamp',
        'sin',
        'cos',
        'tan',
        'asin',
        'acos',
        'atan',
        'sqrt',
        'log2',
      ].includes(name)
    ) {
      const unary = !['min', 'max', 'clamp'].includes(name),
        arity = unary ? 1 : name === 'clamp' ? 3 : 2;
      const floatOnly = unary && name !== 'abs';
      const variadic = name === 'min' || name === 'max';
      if (variadic ? args.length < 1 : args.length !== arity)
        fail(
          `${name} expects ${variadic ? 'one or more' : `exactly ${arity}`} numeric operands`,
          node,
        );
      const values = args.map(numericExpression),
        shapes = values.map((value) => shape(value.type));
      if (shapes.some((info) => !info) || (floatOnly && shapes[0].scalar !== 'f32'))
        fail(
          `${name} requires ${floatOnly ? 'float scalars or vectors' : 'numeric scalars or vectors'}`,
          node,
        );
      const target = shapes.reduce((a, b) => (b.size > a.size ? b : a));
      if (
        shapes.some(
          (info) => info.scalar !== target.scalar || (info.size !== 1 && info.size !== target.size),
        )
      )
        fail(`${name} vector dimensions and scalar families must match`, node);
      if (
        name === 'clamp' &&
        args[1].kind === 'literal' &&
        args[2].kind === 'literal' &&
        args[1].value > args[2].value
      )
        fail('clamp minimum must not exceed maximum', node);
      const type = shapeType(target.size, target.scalar);
      const codes = values.map((value, i) =>
        target.size > 1 && shapes[i].size === 1 ? `${typeName(type)}(${value.code})` : value.code,
      );
      return {
        code: variadic
          ? codes.reduce((left, right) => `${name}(${left}, ${right})`)
          : `${name}(${codes.join(', ')})`,
        type,
      };
    }
    if (['<', '>', '<=', '>='].includes(name)) {
      if (args.length !== 2) fail(`${name} expects exactly two numeric scalars`, node);
      const [left, right] = args.map(numericExpression);
      if (shape(left.type)?.size !== 1 || shape(right.type)?.size !== 1 || left.type !== right.type)
        fail(`${name} expects two numeric scalars of the same type`, node);
      return { code: `(${left.code} ${name} ${right.code})`, type: 'bool' };
    }
    if (name === 'text') {
      if (liftedText.has(node)) return liftedText.get(node);
      if (!hoistText)
        fail('Shader text requires the regular Lisp compiler to hoist its body', node);
      hoistText(node, new Set(scopes.flatMap((scope) => [...scope.keys()])));
      const index = liftedText.size,
        resource = {
          name: `$text${index}`,
          type: 'texture2d',
          kind: 'texture',
          binding: resources.length + 1,
          code: `resource${resources.length}`,
        };
      resources.push(resource);
      uniforms.push(resource);
      const slot = uniformCount;
      uniforms.push({ name: `$text${index}.metrics`, type: 'vec4f', slot });
      uniforms.push({
        name: `$text${index}.origin`,
        type: 'vec2f',
        slot: slot + 1,
      });
      uniformCount += 2;
      const value = {
        type: { kind: 'text' },
        code: resource.code,
        metrics: `bitcast<vec4f>(frame.values[${slot}])`,
        origin: `bitcast<vec2f>(frame.values[${slot + 1}].xy)`,
      };
      liftedText.set(node, value);
      return value;
    }
    if (name === 'inverse' && !scopes.some((scope) => scope.has(name))) {
      if (args.length !== 1) fail('inverse expects exactly one square float matrix', node);
      const value = expression(args[0]);
      if (!Numeric.isMatrix(value.type))
        fail('inverse expects a mat2x2f, mat3x3f or mat4x4f', node);
      const helper = `inverseMatrix${nextSelector++}`;
      helperCode.push(Transforms.inverseWGSL(helper, NumericTypes.matrixSize(value.type)));
      return { code: `${helper}(${value.code})`, type: value.type };
    }
    if (name === 'transform' && !scopes.some((scope) => scope.has(name))) {
      if (args.length !== 2)
        fail(`${name} expects exactly two operands: a matrix and a float vector`, node);
      const transform = expression(args[0]),
        value = expression(args[1]);
      const size = transform.type === 'mat3x3f' ? 2 : transform.type === 'mat4x4f' ? 3 : 0;
      if (!size || value.type !== size)
        fail(`${name} expects mat3x3f and vec2f, or mat4x4f and vec3f`, node);
      const helper = `transformPoint${nextSelector++}`;
      helperCode.push(`fn ${helper}(transform: mat${size + 1}x${size + 1}f, point: vec${size}f) -> vec${size}f {
let homogeneous = transform * vec${size + 1}f(point, 1f);
return homogeneous.${size === 2 ? 'xy' : 'xyz'} / homogeneous.${size === 2 ? 'z' : 'w'};
}`);
      return {
        code: `${helper}(${transform.code}, ${value.code})`,
        type: size,
      };
    }
    if (name === '2d' || name === '3d') {
      const size = name === '2d' ? 2 : 3;
      const entries = Transforms.parseTransformPairs(
        args,
        (key) => (key.kind === 'symbol' ? key.name : key.kind === 'literal' ? key.value : null),
        fail,
      );
      const codes = {
        translate: `vec${size}f(0f)`,
        scale: `vec${size}f(1f)`,
        rotate: size === 2 ? '0f' : 'vec3f(0f)',
        skew: size === 2 ? 'vec2f(0f)' : 'array<f32, 6>()',
      };
      for (const [key, at] of entries) {
        const value = expression(at);
        if (key === 'skew' && size === 3) {
          const type = value.type,
            info = type?.info;
          if (type?.kind === 'array' && info.capacity === 6 && info.element.type === 'f32')
            codes[key] = value.code;
          else if (
            type?.kind === 'storage' &&
            type.collection === 'array' &&
            type.capacity === 6 &&
            type.element.type === 'f32'
          ) {
            codes[key] =
              `array<f32, 6>(${Array.from({ length: 6 }, (_, i) => readCollection(value, { code: `${i}f`, type: 1 }, at).code).join(', ')})`;
          } else fail('3d skew expects an array of six f32 angles: xy, xz, yx, yz, zx, zy', at);
        } else {
          const expected = key === 'rotate' && size === 2 ? 1 : size;
          if (key === 'scale' && value.type === 1) codes[key] = `vec${size}f(${value.code})`;
          else if (value.type === expected) codes[key] = value.code;
          else
            fail(
              `${name} ${key} expects ${expected === 1 ? 'f32' : `vec${expected}f`}${key === 'scale' ? ' or f32' : ''}`,
              at,
            );
        }
      }
      if (!transformHelpers.has(name)) {
        transformHelpers.add(name);
        helperCode.push(Transforms.transformWGSL[name]);
      }
      return {
        code: `transform${name}(${['translate', 'scale', 'rotate', 'skew'].map((key) => codes[key]).join(', ')})`,
        type: size === 2 ? 'mat3x3f' : 'mat4x4f',
      };
    }
    if (
      name.endsWith('?') &&
      [
        'num',
        'str',
        ...NumericTypes.scalarTypes,
        ...NumericTypes.vectorTypes,
        ...NumericTypes.matrixTypes,
      ].includes(name.slice(0, -1))
    ) {
      if (args.length !== 1) fail(`${name} expects exactly one value`, node);
      const value = valueExpression(args[0]),
        requested = name.slice(0, -1);
      const matches =
        requested === 'num'
          ? shape(value.type)?.size === 1
          : helperTypes.get(requested) === value.type;
      const numeric = shape(value.type);
      let predicate = String(Boolean(matches));
      if (matches && numeric?.scalar === 'f32') {
        const maximum = NumericTypes.convertComponent(Number.MAX_VALUE, 'f32');
        predicate =
          numeric.size === 1
            ? `abs(value) <= ${maximum}f`
            : `all(abs(value) <= vec${numeric.size}f(${maximum}f))`;
      }
      if (matches && Numeric.isMatrix(value.type)) {
        const size = NumericTypes.matrixSize(value.type);
        const maximum = NumericTypes.convertComponent(Number.MAX_VALUE, 'f32');
        predicate = Array.from(
          { length: size },
          (_, column) => `all(abs(value[${column}]) <= vec${size}f(${maximum}f))`,
        ).join(' && ');
      }
      if (numeric?.size === 1) {
        if (requested === 'i32' && numeric.scalar === 'u32') predicate = 'value <= 2147483647u';
        if (requested === 'u32' && numeric.scalar === 'i32') predicate = 'value >= 0i';
        if (requested === 'i32' && numeric.scalar === 'f32')
          predicate = '(value == trunc(value) && value >= -2147483648f && value < 2147483648f)';
        if (requested === 'u32' && numeric.scalar === 'f32')
          predicate = '(value == trunc(value) && value >= 0f && value < 4294967296f)';
        if (requested === 'f32' && numeric.scalar !== 'f32') {
          predicate =
            numeric.scalar === 'i32'
              ? '(f32(value) < 2147483648f && i32(f32(value)) == value)'
              : '(f32(value) < 4294967296f && u32(f32(value)) == value)';
        }
      }
      const helper = `guard${nextSelector++}`;
      helperCode.push(
        `fn ${helper}(value: ${typeName(value.type)}) -> bool { return ${predicate}; }`,
      );
      return { code: `${helper}(${value.code})`, type: 'bool' };
    }
    if (name === 'i32' || name === 'u32') {
      if (args.length > 1) fail(`${name} expects at most one value`, node);
      if (args.length === 0) return { code: name === 'i32' ? '0i' : '0u', type: name };
      if (args[0].kind === 'literal' && typeof args[0].value === 'number') {
        return __numericConstruction__(args[0], name);
      }
      const value = expression(args[0]);
      if (value.type === 'bool')
        return {
          code: `select(0${name === 'i32' ? 'i' : 'u'}, 1${name === 'i32' ? 'i' : 'u'}, ${value.code})`,
          type: name,
        };
      if (value.type === 'i32' || value.type === 'u32')
        return { code: __convertNumeric__(value, name), type: name };
      if (value.type !== 1) fail(`${name} expects a numeric scalar or bool`, args[0]);
      return {
        code: __convertNumeric__(value, name),
        type: name,
      };
    }
    if (structDefinitions.has(name)) {
      const type = helperTypes.get(name),
        fields = type.info.fields,
        entries = new Map();
      if (args.length !== fields.length * 2) fail(`${name} requires all fields exactly once`, node);
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i].kind === 'symbol' ? args[i].name : args[i].value;
        const field = Structures.structField(type.info, key);
        if (!field || entries.has(key)) fail(`Unknown or duplicate ${name} field: ${key}`, args[i]);
        const value = valueExpression(args[i + 1]);
        if (value.type !== elementType(field.info))
          fail(`Wrong type for ${name} field ${key}`, args[i + 1]);
        entries.set(key, value.code);
      }
      return {
        code: `${typeName(type)}(${fields.map((field) => entries.get(field.key)).join(', ')})`,
        type,
      };
    }
    if (name === 'array' || name === 'many') {
      const [spec, ...initializers] = args;
      if (
        spec?.kind !== 'list' ||
        spec.items.length < 1 ||
        spec.items.length > 2 ||
        spec.items[0].kind !== 'symbol'
      )
        fail(`${name} expects (Element [capacity]) followed by initial elements`, node);
      const elementName = spec.items[0].name,
        element = resolveElementDescriptor(elementName);
      if (!element) fail('Unsupported shader array element type', spec);
      const count = spec.items[1]
        ? spec.items[1].kind === 'literal'
          ? spec.items[1].value
          : NaN
        : initializers.length;
      let info;
      try {
        info = (name === 'many' ? Structures.manyType : Structures.arrayType)(element, count);
      } catch (error) {
        fail(error.message, spec);
      }
      if (initializers.length > count) fail('Array initializer exceeds capacity', node);
      const elementValueType = elementType(info.element),
        values = initializers.map(valueExpression);
      if (values.some((value) => value.type !== elementValueType))
        fail('Array initializer has the wrong element type', node);
      const packed = Array.from({ length: count }, (_, i) =>
        values[i] ? values[i].code : `${typeName(elementValueType)}()`,
      );
      const type = elementType(info);
      return {
        code:
          name === 'many'
            ? `${typeName(type)}(${values.length}f, array<${typeName(elementValueType)}, ${count}>(${packed.join(', ')}))`
            : `${typeName(type)}(${packed.join(', ')})`,
        type,
      };
    }
    if (name === 'if') fail('Shader if requires statement position', node);
    if (name === 'get') {
      if (args.length !== 1 || !['symbol', 'access'].includes(args[0]?.kind))
        fail('get expects one binding name or dot path', node);
      return expression(args[0]);
    }
    if (name === 'cap') {
      if (args.length !== 1) fail('cap expects one array or many', node);
      const target = expression(args[0]);
      if (target.type?.kind === 'storage')
        return {
          code: `bitcast<f32>(frame.values[${target.resource.slot}].y)`,
          type: 1,
        };
      if (target.type?.kind === 'array' || target.type?.kind === 'many')
        return { code: `${target.type.info.capacity}f`, type: 1 };
      fail('cap expects an array or many', node);
    }
    if (name === 'len') {
      if (args.length !== 1) fail('len expects one array or struct', node);
      const target = expression(args[0]);
      if (target.type?.kind === 'storage')
        return {
          code: `bitcast<f32>(frame.values[${target.resource.slot}].x)`,
          type: 1,
        };
      if (target.type?.kind === 'array') return { code: `${target.type.info.capacity}f`, type: 1 };
      if (target.type?.kind === 'many') return { code: `(${target.code}).length`, type: 1 };
      if (target.type?.kind === 'struct')
        return { code: `${target.type.info.fields.length}f`, type: 1 };
      fail('Shader len requires a collection or struct', node);
    }
    if (name === 'str' || name === 'num')
      fail(`${name} conversion is only available in regular code`, node);
    if (name === 'f32') {
      if (args.length > 1) fail('f32 expects at most one value', node);
      if (args.length === 0) return { code: '0.0f', type: 1 };
      if (args[0].kind === 'literal' && typeof args[0].value === 'number') {
        return __numericConstruction__(args[0], 'f32');
      }
      const value = expression(args[0]);
      if (value.type === 1) return value;
      if (value.type === 'i32' || value.type === 'u32')
        return { code: `f32(${value.code})`, type: 1 };
      if (value.type === 'bool') return { code: `select(0.0f, 1.0f, ${value.code})`, type: 1 };
      fail('Shader f32 conversion expects a numeric scalar or bool', args[0]);
    }
    if (name === 'bool') {
      if (args.length > 1) fail('bool expects at most one value', node);
      if (args.length === 0) return { code: 'false', type: 'bool' };
      return { code: __booleanExpression__(args[0]), type: 'bool' };
    }
    if (name === 'not') {
      if (args.length !== 1) fail('not expects exactly one operand', node);
      return { code: `(!${__booleanExpression__(args[0])})`, type: 'bool' };
    }
    if (name === 'and' || name === 'or') {
      if (!args.length) return { code: name === 'and' ? 'true' : 'false', type: 'bool' };
      if (args.length === 1) return valueExpression(args[0]);
      // Analyze lazy operands in their own capture scope. Written captures must
      // stay live across operand calls; read-only captures can be copied.
      const savedOwner = owner,
        selector = { __captures__: new Map() };
      let values;
      owner = selector;
      try {
        values = args.map(valueExpression);
      } finally {
        owner = savedOwner;
      }
      const type = values[0].type;
      if (values.some((value) => value.type !== type))
        fail(`${name} selector operands must have the same shader type`, node);
      const captures = [...selector.__captures__.values()],
        inputs = captures.map((capture) => __captureBinding__(capture, node));
      if (type === 'bool') {
        let code = `(${values.map((value) => value.code).join(name === 'and' ? ' && ' : ' || ')})`;
        for (let i = 0; i < captures.length; i++) {
          code = code.replaceAll(captures[i].code, inputs[i].code);
          if (captures[i].__pointer__)
            code = code.replaceAll(
              captures[i].__pointer__,
              __captureArgument__(captures[i], inputs[i]),
            );
        }
        return {
          code,
          type,
        };
      }
      const callable = `selector${nextSelector++}`;
      const check = boolCode(type, 'selected');
      const stop = name === 'and' ? `!(${check})` : check;
      const body = values
        .slice(1)
        .map((value) => `if (${stop}) { return selected; }\nselected = ${value.code};`)
        .join('\n');
      const code = `fn ${callable}(shaderPixel: vec2f${captures.map((capture) => ', ' + __captureParameter__(capture)).join('')}) -> ${typeName(type)} {
${builtinCode('shaderPixel')}
var selected: ${typeName(type)} = ${values[0].code};
${body}
return selected;
}`;
      helperCode.push(__resolveCaptures__(code, selector.__captures__));
      return {
        code: `${callable}(xy${inputs.map((value, i) => ', ' + __captureArgument__(captures[i], value)).join('')})`,
        type,
      };
    }
    if (
      name === '%' &&
      !args.some((arg) => {
        const value = expression(arg);
        return shape(value.type)?.scalar !== 'f32' || shape(value.type)?.size !== 1;
      })
    ) {
      if (args.length !== 2) fail('% expects exactly two scalar operands', node);
      const values = args.map(numericExpression);
      if (values.some((value) => value.type !== 1)) fail('% requires scalar numbers', node);
      return { code: `(${values[0].code} % ${values[1].code})`, type: 1 };
    }
    if (['+', '-', '*', '/', '%'].includes(name)) {
      if (name === '%' && args.length !== 2) fail('% expects exactly two operands', node);
      if (!args.length && (name === '-' || name === '/'))
        fail(`${name} needs at least one operand`, node);
      const operands = args.map(numericExpression);
      if (!operands.length) return { code: name === '+' ? '0.0f' : '1.0f', type: 1 };
      if (operands.length === 1) {
        const { code, type } = operands[0];
        if (name === '-') {
          const operation =
            shape(type)?.scalar === 'u32' ? `(${typeName(type)}(0u) - value)` : '(-value)';
          if (['i32', 'u32'].includes(shape(type)?.scalar)) {
            const helper = `negate${nextSelector++}`;
            helperCode.push(
              `fn ${helper}(value: ${typeName(type)}) -> ${typeName(type)} { return ${operation}; }`,
            );
            return { code: `${helper}(${code})`, type };
          }
          return { code: `(-${code})`, type };
        }
        if (name === '/') {
          if (Numeric.isMatrix(type)) fail('Matrix division is not supported', node);
          const scalar = shape(type).scalar,
            one = scalar === 'i32' ? '1i' : scalar === 'u32' ? '1u' : '1f';
          return {
            code: `(${shape(type).size === 1 ? one : `${typeName(type)}(${one})`} / ${code})`,
            type,
          };
        }
        return operands[0];
      }
      return operands.slice(1).reduce((left, right) => {
        const languageType = (type) =>
          typeof type === 'number' ? (type === 1 ? 'f32' : `vec${type}f`) : type;
        let result;
        try {
          result = Numeric.resultType(name, languageType(left.type), languageType(right.type));
        } catch (error) {
          fail(error.message, node);
        }
        const type = helperTypes.get(result) || result;
        const broadcast = (value) =>
          shape(type)?.size >= 2 && shape(value.type)?.size === 1
            ? `${typeName(type)}(${value.code})`
            : value.code;
        if (['i32', 'u32'].includes(shape(type)?.scalar)) {
          const helper = `arithmetic${nextSelector++}`;
          helperCode.push(
            `fn ${helper}(a: ${typeName(type)}, b: ${typeName(type)}) -> ${typeName(type)} { return a ${name} b; }`,
          );
          return {
            code: `${helper}(${broadcast(left)}, ${broadcast(right)})`,
            type,
          };
        }
        return {
          code: `(${broadcast(left)} ${name} ${broadcast(right)})`,
          type,
        };
      }, operands[0]);
    }
    if (name === 'copy') {
      if (args.length !== 1) fail('copy expects one value', node);
      return valueExpression(args[0]);
    }
    if (/^mat([234])x\1f$/.test(name)) {
      const size = NumericTypes.matrixSize(name),
        values = args.map((arg) => __numericConstruction__(arg, 'f32'));
      const type = name,
        constructor = `mat${size}x${size}f`;
      if (!values.length) return { code: `${constructor}()`, type };
      if (
        !(values.length === size && values.every((value) => value.type === size)) &&
        !(values.length === size * size && values.every((value) => value.type === 1))
      ) {
        fail(
          `${name} expects no arguments, ${size} float-vector columns, or ${size * size} scalars`,
          node,
        );
      }
      return {
        code: `${constructor}(${values.map((value) => value.code).join(', ')})`,
        type,
      };
    }
    if (NumericTypes.vectorInfo(name)) {
      const info = NumericTypes.vectorInfo(name),
        type = info.scalar === 'f32' ? info.size : name;
      const scalar = info.scalar;
      const input = args[0];
      if (
        !args.length ||
        (args.length === 1 &&
          ((input.kind === 'literal' && input.value === null) ||
            (input.kind === 'list' &&
              input.items.length === 1 &&
              input.items[0].kind === 'literal' &&
              input.items[0].value === null)))
      )
        return { code: `${typeName(type)}()`, type };
      // Inline lists adapt constructor inputs without introducing GPU list values.
      const isList = (arg) =>
        arg.kind === 'list' &&
        arg.items[0]?.kind === 'symbol' &&
        arg.items[0].name === 'list' &&
        !scopes.some((scope) => scope.has('list'));
      const codes = [];
      let count = 0;
      const append = (arg) => {
        if (count === info.size) return;
        if (isList(arg)) {
          for (let index = 1; index < arg.items.length && count < info.size; index++)
            append(arg.items[index]);
          return;
        }
        const value = __numericConstruction__(arg, scalar);
        if (Numeric.isMatrix(value.type)) fail('Vector constructors do not accept matrices', arg);
        const size = shape(value.type).size;
        const converted = __convertNumeric__(value, scalar);
        if (args.length === 1 && arg === input && size === 1) {
          codes.push(converted);
          count = info.size;
          return;
        }
        const take = Math.min(size, info.size - count);
        codes.push(take === size ? converted : `(${converted}).${'xyzw'.slice(0, take)}`);
        count += take;
      };
      for (const arg of args) {
        if (count === info.size) break;
        append(arg);
      }
      const zero = scalar === 'i32' ? '0i' : scalar === 'u32' ? '0u' : '0f';
      codes.push(...Array(info.size - count).fill(zero));
      return { code: `${typeName(type)}(${codes.join(', ')})`, type };
    }
    if (name === 'blend') {
      if (args.length < 1 || args.length > 2)
        fail('blend expects one or two vec4f colors or textures', node);
      const colors = args.map(expression);
      if (
        colors.some(
          (color) => color.type !== 4 && color.type !== 'texture2d' && color.type?.kind !== 'text',
        )
      )
        fail('blend expects vec4f colors or textures', node);
      if (!needsBlend) {
        needsBlend = true;
        helperCode.push(Colors.blendWGSL);
      }
      const sampleColor = (color) => {
        if (color.type === 4) return color.code;
        needsSampler = true;
        return `textureSampleLevel(${color.code}, shaderSampler, uv, 0f)`;
      };
      const foreground = sampleColor(colors[0]);
      if (colors.length === 1) needsBefore = true;
      const background = sampleColor(colors[1] ?? { code: 'before', type: 'texture2d' });
      return { code: `blendColors(${foreground}, ${background})`, type: 4 };
    }
    if (name === 'sample' || name === 'sample-nearest') {
      const nearest = name === 'sample-nearest';
      if (args.length < 1 || args.length > (nearest ? 2 : 3))
        fail(
          nearest
            ? 'sample-nearest expects a texture2d or text and optional vec2f UV coordinates'
            : 'sample expects a texture2d or text, optional vec2f UV coordinates, and optional f32 mip level',
          node,
        );
      const image = expression(args[0]);
      if (image.type !== 'texture2d' && image.type?.kind !== 'text')
        fail(`${name} expects a texture2d or text`, args[0]);
      const uv =
        args.length >= 2
          ? numericExpression(args[1])
          : image.type?.kind === 'text'
            ? textField(image, 'uv', node)
            : textureField(image, 'uv', node);
      if (uv.type !== 2) fail(`${name} expects vec2f UV coordinates`, node);
      if (nearest) {
        const dimensions = `textureDimensions(${image.code}, 0)`;
        const pixel = `min(vec2i(clamp(${uv.code}, vec2f(0f), vec2f(1f)) * vec2f(${dimensions})), vec2i(${dimensions}) - vec2i(1))`;
        return { code: `textureLoad(${image.code}, ${pixel}, 0)`, type: 4 };
      }
      const level = args.length === 3 ? numericExpression(args[2]) : { code: '0.0f', type: 1 };
      if (level.type !== 1) fail('sample mip level must be f32', node);
      needsSampler = true;
      return {
        code: `textureSampleLevel(${image.code}, shaderSampler, ${uv.code}, ${level.code})`,
        type: 4,
      };
    }
    if (name === 'fn') fail('Shader fn must initialize a let binding', node);
    const callable = lookup(head);
    if (!callable.helper) fail(`Shader value ${name} is not a function`, head);
    const type = compileHelper(callable);
    const values = args.map(expression);
    if (values.length !== callable.parameters.length)
      fail(`${name} expects ${callable.parameters.length} arguments`, node);
    for (let i = 0; i < values.length; i++) {
      if (values[i].type !== callable.parameters[i].type)
        fail(
          `Argument ${i + 1} to ${name} must be ${typeName(callable.parameters[i].type)}`,
          args[i],
        );
    }
    const captures = [...callable.__captures__.values()].map((capture) =>
      __captureArgument__(capture, __captureBinding__(capture, node)),
    );
    return {
      code: `${callable.code}(xy${[...values.map((value) => value.code), ...captures].map((code) => ', ' + code).join('')})`,
      type,
    };
  };
  const numericExpression = (node) => {
    const value = expression(node);
    if (!shape(value.type) && !Numeric.isMatrix(value.type))
      fail('Expected a numeric shader value, not a resource', node);
    return value;
  };
  const valueExpression = (node) => {
    const value = expression(node);
    if (value.type === 'texture2d' || value.type?.kind === 'storage' || value.type?.kind === 'text')
      fail('Expected a shader value, not a resource', node);
    return value;
  };
  const elementType = (info) => {
    if (info.type === 'array' || info.type === 'many') {
      // Layout identity belongs to this compilation, with structural equality.
      for (const [layout, type] of arrayValues)
        if (Structures.sameElement(layout, info)) return type;
      if (!arrayValues.has(info))
        arrayValues.set(info, { kind: info.type, info, id: arrayValues.size });
      return arrayValues.get(info);
    }
    if (!info.fields) return helperTypes.get(info.type);
    if (!structTypes.has(info)) structTypes.set(info, { kind: 'struct', info });
    return structTypes.get(info);
  };
  const typeName = (type) => {
    if (type?.kind === 'many') {
      if (!generatedStructs.has(type.info)) {
        const name = `Struct${generatedStructs.size}`;
        generatedStructs.set(type.info, { name, code: '' });
        generatedStructs.get(type.info).code =
          `struct ${name} {\nlength: f32,\ndata: array<${typeName(elementType(type.info.element))}, ${type.info.capacity}>,\n}`;
      }
      return generatedStructs.get(type.info).name;
    }
    if (type?.kind === 'array') {
      return `array<${typeName(elementType(type.info.element))}, ${type.info.capacity}>`;
    }
    if (type?.kind === 'struct') {
      if (!generatedStructs.has(type.info)) {
        const name = `Struct${generatedStructs.size}`;
        generatedStructs.set(type.info, { name, code: '' });
        const fields = type.info.fields
          .map((field) => `f${field.index}: ${typeName(elementType(field.info))},`)
          .join('\n');
        generatedStructs.get(type.info).code = `struct ${name} {\n${fields}\n}`;
      }
      return generatedStructs.get(type.info).name;
    }
    return type === 'bool'
      ? 'bool'
      : type === 'texture2d'
        ? 'texture_2d<f32>'
        : Numeric.isMatrix(type)
          ? type
          : type === 'i32' || type === 'u32' || Numeric.isVector(type)
            ? type
            : type === 1
              ? 'f32'
              : `vec${type}f`;
  };
  function __numericConstruction__(node, scalar) {
    if (node.kind !== 'literal' || typeof node.value !== 'number') return numericExpression(node);
    try {
      const component = NumericTypes.convertComponent(node.value, scalar);
      if (!Number.isFinite(component)) fail('Shader construction requires finite components', node);
      return {
        code:
          scalar === 'f32' && Object.is(component, -0)
            ? '-0.0f'
            : scalar === 'i32' && component === -2147483648
              ? 'i32(-2147483648)'
              : `${component}${scalar === 'i32' ? 'i' : scalar === 'u32' ? 'u' : 'f'}`,
        type: scalar === 'f32' ? 1 : scalar,
      };
    } catch (error) {
      fail(error.message, node);
    }
  }
  function __ensureClamp__(scalar) {
    const helper = scalar === 'i32' ? 'clampI32' : 'clampU32';
    if (numericConversions.has(helper)) return helper;
    numericConversions.add(helper);
    // The upper thresholds are exclusive: f32 rounds each integer maximum up.
    // Negate an abstract integer before converting: 2147483648i is out of range.
    helperCode.push(
      scalar === 'i32'
        ? `fn clampI32(value: f32) -> i32 { if (value >= 2147483648f) { return 2147483647i; } if (value <= -2147483648f) { return i32(-2147483648); } return i32(trunc(value)); }`
        : `fn clampU32(value: f32) -> u32 { if (value >= 4294967296f) { return 4294967295u; } if (value <= 0f) { return 0u; } return u32(trunc(value)); }`,
    );
    return helper;
  }
  function __convertNumeric__(value, scalar) {
    const source = shape(value.type);
    if (source.scalar === scalar) return value.code;
    const target =
      source.size === 1
        ? scalar
        : `vec${source.size}${scalar === 'i32' ? 'i' : scalar === 'u32' ? 'u' : 'f'}`;
    if (scalar === 'f32') return `${target}(${value.code})`;
    if (source.scalar === 'i32')
      return `${target}(max(${value.code}, ${source.size === 1 ? '0i' : `${typeName(value.type)}(0i)`}))`;
    if (source.scalar === 'u32')
      return `${target}(min(${value.code}, ${source.size === 1 ? '2147483647u' : `${typeName(value.type)}(2147483647u)`}))`;
    const clamp = __ensureClamp__(scalar);
    if (source.size === 1) return `${clamp}(${value.code})`;
    const helper = `convert${source.size}${scalar}${nextSelector++}`;
    const components = Array.from({ length: source.size }, (_, i) => `${clamp}(value[${i}u])`);
    helperCode.push(
      `fn ${helper}(value: ${typeName(value.type)}) -> ${target} { return ${target}(${components.join(', ')}); }`,
    );
    return `${helper}(${value.code})`;
  }
  function fieldAccess(target, key, node) {
    const field = Structures.structField(target.type.info, key);
    if (!field) fail(`Unknown struct field: ${key}`, node);
    const type = elementType(field.info),
      code = `(${target.code}).f${field.index}`;
    return {
      code,
      type,
    };
  }
  function readCollection(target, index, node) {
    if (target.type?.kind === 'array' || target.type?.kind === 'many') {
      const info = target.type.info,
        type = elementType(info.element),
        name = `readArray${target.type.id}`;
      if (!collectionReaders.has(info)) {
        collectionReaders.set(info, true);
        helperCode.push(`fn ${name}(value: ${typeName(target.type)}, index: f32) -> ${typeName(type)} {
if (!(index >= 0.0f && index < ${info.type === 'many' ? 'value.length' : info.capacity + 'f'}) || floor(index) != index) { return ${typeName(type)}(); }
return ${info.type === 'many' ? 'value.data' : 'value'}[u32(index)];
}`);
      }
      return { code: `${name}(${target.code}, ${index.code})`, type };
    }
    const resource = target.resource;
    if (!resource)
      fail(
        'Runtime-sized array helper parameters are not supported yet; reference shader inputs directly',
        node,
      );
    const type = elementType(resource.element),
      name = `readStorage${resource.binding}`;
    if (!collectionReaders.has(resource)) {
      collectionReaders.set(resource, true);
      helperCode.push(`fn ${name}(index: f32) -> ${typeName(type)} {
if (!(index >= 0.0f && index < bitcast<f32>(frame.values[${resource.slot}].x)) || floor(index) != index) { return ${typeName(type)}(); }
return ${resource.code}[u32(index)];
}`);
    }
    return { code: `${name}(${index.code})`, type };
  }
  function computedIndex(node) {
    const index = numericExpression(node);
    if (shape(index.type)?.size !== 1) fail('Computed index must be a numeric scalar', node);
    return { ...index, code: index.type === 1 ? index.code : `f32(${index.code})` };
  }
  function readNumeric(target, index) {
    const vector = shape(target.type),
      matrix = Numeric.isMatrix(target.type),
      size = matrix ? NumericTypes.matrixSize(target.type) : vector.size,
      type = matrix ? size : shapeType(1, vector.scalar),
      name = `readNumeric${String(target.type)}`;
    if (!collectionReaders.has(target.type)) {
      collectionReaders.set(target.type, true);
      helperCode.push(`fn ${name}(value: ${typeName(target.type)}, index: f32) -> ${typeName(type)} {
if (!(index >= 0f && index < ${size}f) || floor(index) != index) { return ${typeName(type)}(); }
return value[u32(index)];
}`);
    }
    return { code: `${name}(${target.code}, ${index.code})`, type };
  }
  function __booleanExpression__(node) {
    const value = expression(node);
    if (value.type?.kind === 'storage' && value.type.collection === 'many')
      return `(frame.values[${value.resource.slot}].x != 0u)`;
    if (value.type === 'texture2d' || value.type?.kind === 'storage' || value.type?.kind === 'text')
      fail('Expected a shader value, not a resource', node);
    return boolCode(value.type, value.code);
  }
  function boolCode(type, code) {
    if (type === 'bool') return code;
    const suffix =
      type?.kind === 'array' || type?.kind === 'many'
        ? `Array${type.id}`
        : typeof type === 'object'
          ? typeName(type)
          : type;
    if (!boolHelpers.has(type)) {
      boolHelpers.add(type);
      const result =
        type === 1
          ? '((value == value) && (value != 0.0f))'
          : type === 'i32'
            ? '(value != 0i)'
            : type === 'u32'
              ? '(value != 0u)'
              : type?.kind === 'many'
                ? '(value.length != 0.0f)'
                : 'true';
      helperCode.push(`fn bool${suffix}(value: ${typeName(type)}) -> bool { return ${result}; }`);
    }
    return `bool${suffix}(${code})`;
  }
  function manyEditor(type, operation) {
    const name = `${operation}Many${type.id}`;
    if (!manyEditors.has(name)) {
      manyEditors.add(name);
      const element = typeName(elementType(type.info.element)),
        result = typeName(type);
      helperCode.push(
        operation === 'insert'
          ? `fn ${name}(value: ${result}, item: ${element}, index: f32) -> ${result} {
var result = value;
if (!(index >= 0f && index <= result.length) || floor(index) != index || result.length >= ${type.info.capacity}f) { return result; }
var i = u32(result.length);
loop { if (i <= u32(index)) { break; } result.data[i] = result.data[i - 1u]; i -= 1u; }
result.data[u32(index)] = item;
result.length += 1f;
return result;
}`
          : `fn ${name}(value: ${result}, index: f32) -> ${result} {
var result = value;
if (!(index >= 0f && index < result.length) || floor(index) != index) { return result; }
var i = u32(index);
loop { if (i + 1u >= u32(result.length)) { break; } result.data[i] = result.data[i + 1u]; i += 1u; }
result.length -= 1f;
return result;
}`,
      );
    }
    return name;
  }
  function compileHelper(helper) {
    if (helper.state === 'compiling')
      fail(`Recursive shader helper cycle involving ${helper.name}`, helper.node);
    if (helper.state === 'compiled') return helper.type;
    helper.state = 'compiling';
    const savedScopes = scopes,
      savedOwner = owner,
      savedLoopDepth = loopDepth;
    loopDepth = 0;
    scopes = helper.scopes.slice();
    owner = helper;
    try {
      const [, parameters, ...body] = helper.node.items;
      if (parameters?.kind !== 'list')
        fail('Shader fn expects typed parameters followed by body statements', helper.node);
      const scope = new Map();
      const parametersCode = [],
        copies = [];
      helper.parameters = typedParameters(parameters, helperTypes).map(({ name, type }, index) => {
        if (type?.kind === 'storage' && type.info) type = elementType(type.info);
        if (type?.kind === 'storage')
          fail(
            'Runtime-sized array helper parameters are not supported yet; reference shader inputs directly',
            name,
          );
        if (scope.has(name.name) || specialForms.has(name.name))
          fail(`Invalid or duplicate helper parameter: ${name.name}`, name);
        const local = {
          code: type === 'texture2d' ? `argument${index}` : `local${nextLocal++}`,
          type,
          mutable: type !== 'texture2d',
          owner: helper,
        };
        scope.set(name.name, local);
        parametersCode.push(`argument${index}: ${typeName(type)}`);
        if (type !== 'texture2d')
          copies.push(
            `${Codegen.nameComment(name.name)}\nvar ${local.code}: ${typeName(type)} = argument${index};`,
          );
        return { name: name.name, type };
      });
      const compiled = statements(body, scope, true);
      if (!compiled.returns) fail('Shader helper must return a value on every path', helper.node);
      helper.type = compiled.returnType;
      helper.state = 'compiled';
      parametersCode.push(...[...helper.__captures__.values()].map(__captureParameter__));
      helperCode.push(`fn ${helper.code}(shaderPixel: vec2f${parametersCode.length ? ', ' : ''}${parametersCode.join(', ')}) -> ${typeName(helper.type)} {
${builtinCode('shaderPixel')}
${copies.join('\n')}
${__resolveCaptures__(compiled.code, helper.__captures__)}
}`);
      return helper.type;
    } finally {
      scopes = savedScopes;
      owner = savedOwner;
      loopDepth = savedLoopDepth;
    }
  }
  const builtinCode = (pixel) => `  // builtins
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
    if (node.kind === 'symbol') {
      const value = lookup(node);
      if (value.__binding__) value.__written__ = true;
      return value;
    }
    if (node.kind !== 'access') fail('set expects a name or dot target', node);
    const parent = writable(node.target);
    if (parent.type?.kind === 'storage')
      fail('Shader arrays are read-only; mutate them in regular code', node);
    if (node.computed) {
      if (
        parent.type?.kind === 'struct' &&
        node.key.kind === 'literal' &&
        typeof node.key.value === 'string'
      )
        return { ...parent, ...fieldAccess(parent, node.key.value, node) };
      const index = computedIndex(node.key),
        indexName = `computedIndex${nextLocal++}`,
        vector = shape(parent.type),
        matrix = Numeric.isMatrix(parent.type),
        collection = ['array', 'many'].includes(parent.type?.kind);
      if (!collection && !matrix && !(vector?.size >= 2))
        fail('Computed assignment requires an indexed local value', node);
      const limit = collection
          ? parent.type.kind === 'many'
            ? `${parent.code}.length`
            : `${parent.type.info.capacity}f`
          : `${matrix ? NumericTypes.matrixSize(parent.type) : vector.size}f`,
        type = collection
          ? elementType(parent.type.info.element)
          : matrix
            ? NumericTypes.matrixSize(parent.type)
            : shapeType(1, vector.scalar);
      return {
        ...parent,
        setup: `${parent.setup || ''}let ${indexName}: f32 = ${index.code};\n`,
        code: `${parent.code}${parent.type?.kind === 'many' ? '.data' : ''}[u32(${indexName})]`,
        type,
        guard: [
          parent.guard,
          `(${indexName} >= 0f && ${indexName} < ${limit} && floor(${indexName}) == ${indexName})`,
        ]
          .filter(Boolean)
          .join(' && '),
      };
    }
    if (parent.type?.kind === 'many') {
      if (node.quoted || !/^\d+$/.test(node.key) || Number(node.key) >= parent.type.info.capacity)
        fail('many dot assignment requires an index within capacity', node);
      const type = elementType(parent.type.info.element);
      return {
        ...parent,
        code: `${parent.code}.data[${node.key}u]`,
        type,
        guard: [parent.guard, `${node.key}f < ${parent.code}.length`].filter(Boolean).join(' && '),
      };
    }
    if (parent.type?.kind === 'array') {
      if (node.quoted || !/^\d+$/.test(node.key) || Number(node.key) >= parent.type.info.capacity)
        fail('Array dot assignment requires an index within capacity', node);
      const type = elementType(parent.type.info.element);
      return {
        ...parent,
        code: `${parent.code}[${node.key}u]`,
        type,
      };
    }
    if (parent.type?.kind === 'struct')
      return { ...parent, ...fieldAccess(parent, node.key, node) };
    const vector = shape(parent.type);
    if (
      !node.quoted &&
      /^-?\d+$/.test(node.key) &&
      (Numeric.isMatrix(parent.type) || vector?.size >= 2)
    ) {
      const size = Numeric.isMatrix(parent.type)
          ? NumericTypes.matrixSize(parent.type)
          : vector.size,
        index = Number(node.key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= size)
        fail('Numeric dot index is outside this vector/matrix', node);
      return {
        ...parent,
        code: `${parent.code}[${index}u]`,
        type: Numeric.isMatrix(parent.type) ? size : shapeType(1, vector.scalar),
      };
    }
    if (
      node.quoted ||
      !/^[xyzw]{1,4}$/.test(node.key) ||
      new Set(node.key).size !== node.key.length ||
      !vector ||
      vector.size < 2 ||
      [...node.key].some((key) => 'xyzw'.indexOf(key) >= vector.size)
    )
      fail('Invalid writable vector swizzle', node);
    return {
      ...parent,
      code: `${parent.code}.${node.key}`,
      type: shapeType(node.key.length, vector.scalar),
    };
  }
  const statements = (nodes, scope = new Map(), returnLast = false) => {
    scopes.push(scope);
    try {
      for (const statement of nodes) {
        if (statement.kind !== 'list' || statement.items[0]?.name !== 'let') continue;
        const [, name, value] = statement.items;
        if (statement.items.length !== 3 || name.kind !== 'symbol' || !value)
          fail('let expects a name and value', statement);
        if (scope.has(name.name) || reserved.has(name.name))
          fail(`Name already defined or reserved: ${name.name}`, name);
        if (value.kind === 'list' && value.items[0]?.name === 'fn') {
          const helper = {
            name: name.name,
            code: `helper${helpers.length}`,
            helper: true,
            pending: true,
            node: value,
            scopes: scopes.slice(),
            state: 'uncompiled',
            __captures__: new Map(),
          };
          helpers.push(helper);
          scope.set(name.name, helper);
        } else {
          scope.set(name.name, {
            code: `local${nextLocal++}`,
            pending: true,
            mutable: true,
            owner,
          });
        }
      }
      let returns = false,
        returnType = null,
        terminated = false;
      const mergeReturn = (type, at) => {
        if (type === null) return;
        if (returnType !== null && returnType !== type)
          fail('Shader return types must match across all paths', at);
        returnType = type;
      };
      const returnValue = (value, at) => {
        if (owner === fragmentOwner && value.type !== 4)
          fail('Shader return must be a vec4f RGBA color', at);
        returns = true;
        mergeReturn(value.type, at);
        return `return ${value.code};`;
      };
      const lines = nodes.map((statement, index) => {
        if (returns || terminated)
          fail('Unreachable shader statement after return or loop control', statement);
        if (statement.kind === 'block') {
          const block = statements(statement.items);
          returns = block.returns;
          mergeReturn(block.returnType, statement);
          return `{\n${block.code}\n}`;
        }
        const implicitResult = returnLast && index === nodes.length - 1;
        if (statement.kind !== 'list') {
          if (implicitResult) return returnValue(valueExpression(statement), statement);
          fail('Expected a shader statement', statement);
        }
        const [head, ...initialArgs] = statement.items;
        const args =
          head?.name === 'for' && initialArgs.length >= 2
            ? [initialArgs[1], initialArgs[0], ...initialArgs.slice(2)]
            : initialArgs;
        if (head?.name === 'break' || head?.name === 'continue') {
          if (!loopDepth || args.length)
            fail(`${head.name} requires a loop and no arguments`, statement);
          terminated = true;
          return `${head.name};`;
        }
        if (['while', 'until', 'for'].includes(head?.name)) {
          const name = head.name;
          if (args.length < (name === 'while' || name === 'until' ? 1 : 2))
            fail(`${name} has insufficient arguments`, statement);
          const compileBody = (body, binding = new Map()) => {
            loopDepth++;
            try {
              const result = statements(body, binding);
              mergeReturn(result.returnType, statement);
              return result.code;
            } finally {
              loopDepth--;
            }
          };
          if (name === 'while' || name === 'until') {
            const condition = expression(args[0]);
            if (
              condition.type === 'texture2d' ||
              condition.type?.kind === 'text' ||
              (condition.type?.kind === 'storage' && condition.type.collection !== 'many')
            )
              fail('Expected a shader condition value', args[0]);
            const code =
              condition.type?.kind === 'storage'
                ? `(frame.values[${condition.resource.slot}].x != 0u)`
                : boolCode(condition.type, condition.code);
            return `while (${name === 'until' ? `!(${code})` : code}) {\n${compileBody(args.slice(1))}\n}`;
          }
          const binding = args[1];
          if (binding.kind !== 'symbol' || reserved.has(binding.name))
            fail('Expected an unreserved loop binding name', binding);
          const variable = `local${nextLocal++}`,
            temp = `loop${nextLocal++}`;
          let prefix,
            header,
            item,
            type,
            guard = '';
          const evaluatedInput = args[0].kind === 'range' ? null : expression(args[0]);
          if (args[0].kind === 'range' || shape(evaluatedInput?.type)?.size === 1) {
            const range = args[0],
              isRange = range.kind === 'range';
            const bound = (at) => {
              if (
                at.kind === 'literal' &&
                (!Number.isInteger(at.value) || Math.abs(at.value) > 16777216)
              )
                fail('Shader loop bounds must be integers within ±16777216', at);
              const value = !isRange ? evaluatedInput : numericExpression(at);
              if (shape(value.type)?.size !== 1)
                fail('Shader loop bounds must be scalar integers', at);
              return value.type === 1 ? value.code : `f32(${value.code})`;
            };
            const from = isRange ? bound(range.from) : '0f',
              to = bound(isRange ? range.to : range);
            if (!isRange && range.kind === 'literal' && range.value < 0)
              fail('Loop count must be nonnegative', range);
            prefix = `let ${temp}a = ${from};\nlet ${temp}b = ${to};\nlet ${temp}s = select(-1f, 1f, ${temp}a < ${temp}b);`;
            guard = `${temp}a == trunc(${temp}a) && ${temp}b == trunc(${temp}b) && abs(${temp}a) <= 16777216f && abs(${temp}b) <= 16777216f${isRange ? '' : ` && ${temp}b >= 0f`}`;
            header = `var ${temp}i = ${temp}a; select((${temp}i > ${temp}b), (${temp}i < ${temp}b), (${temp}s > 0f)); ${temp}i += ${temp}s`;
            item = `${temp}i`;
            type = 1;
          } else {
            const collection = evaluatedInput,
              kind = collection.type?.kind;
            if (!['storage', 'array', 'many'].includes(kind))
              fail('Shader for expects an array or many', args[0]);
            const storage = kind === 'storage';
            const length = storage
              ? `bitcast<f32>(frame.values[${collection.resource.slot}].x)`
              : kind === 'many'
                ? `${temp}c.length`
                : `${collection.type.info.capacity}f`;
            prefix = `${storage ? '' : `let ${temp}c = ${collection.code};\n`}let ${temp}n = ${length};`;
            header = `var ${temp}i = 0f; ${temp}i < ${temp}n; ${temp}i += 1f`;
            const value = readCollection(
              storage ? collection : { ...collection, code: `${temp}c` },
              { code: `${temp}i`, type: 1 },
              args[0],
            );
            item = value.code;
            type = value.type;
          }
          const bindingScope = new Map([
            [binding.name, { code: variable, type, mutable: true, owner }],
          ]);
          const code = `for (${header}) {\nvar ${variable}: ${typeName(type)} = ${item};\n${compileBody(args.slice(2), bindingScope)}\n}`;
          return `{\n${prefix}\n${guard ? `if (${guard}) {\n${code}\n}` : code}\n}`;
        }
        if (head?.name === 'if') {
          const parsed = Conditionals.parseConditional(args, (message, at) =>
            fail(message, at || statement),
          );
          const compiled = parsed.branches.map((branch) => {
            const condition = expression(branch.condition);
            if (
              condition.type === 'texture2d' ||
              condition.type?.kind === 'text' ||
              (condition.type?.kind === 'storage' && condition.type.collection !== 'many')
            )
              fail('Expected a shader condition value', branch.condition);
            const code =
              condition.type?.kind === 'storage'
                ? `(frame.values[${condition.resource.slot}].x != 0u)`
                : boolCode(condition.type, condition.code);
            const body = statements(branch.body);
            mergeReturn(body.returnType, statement);
            return { ...body, code: `if (${code}) {\n${body.code}\n}` };
          });
          let fallback = null;
          if (parsed.otherwise) {
            fallback = statements(parsed.otherwise);
            mergeReturn(fallback.returnType, statement);
          }
          returns = Boolean(fallback?.returns) && compiled.every((branch) => branch.returns);
          return (
            compiled.map((branch) => branch.code).join(' else ') +
            (fallback ? ` else {\n${fallback.code}\n}` : '')
          );
        }
        if (head?.name === 'let') {
          const local = scope.get(args[0].name);
          if (local.helper) {
            local.pending = false;
            return '';
          }
          const value = expression(args[1]);
          if (value.type?.kind === 'text') {
            Object.assign(local, value, {
              pending: false,
              mutable: false,
              owner: null,
            });
            return '';
          }
          if (value.type === 'texture2d' || value.type?.kind === 'storage')
            fail('Expected a shader value, not a resource', args[1]);
          Object.assign(local, { type: value.type, pending: false });
          return `${Codegen.nameComment(args[0].name)}\nvar ${local.code}: ${typeName(value.type)} = ${value.code};`;
        }
        if (head?.name === 'insert' || head?.name === 'remove') {
          const operation = head.name;
          if (operation === 'insert' ? args.length < 2 || args.length > 3 : args.length !== 2)
            fail(`${operation} has invalid arity`, statement);
          const target = writable(args[0]);
          if (!target.mutable || target.type?.kind !== 'many')
            fail(`${operation} requires a local bounded many`, args[0]);
          const item = operation === 'insert' ? valueExpression(args[1]) : null;
          if (item && item.type !== elementType(target.type.info.element))
            fail('Wrong many insertion element type', args[1]);
          const indexNode = operation === 'insert' ? args[2] : args[1];
          const index = indexNode
            ? numericExpression(indexNode)
            : { code: `${target.code}.length`, type: 1 };
          if (shape(index.type)?.size !== 1) fail('many edit index must be a scalar', indexNode);
          const assignment = `${target.code} = ${manyEditor(target.type, operation)}(${target.code}, ${item ? item.code + ', ' : ''}${index.type === 1 ? index.code : `f32(${index.code})`});`;
          return (
            (target.setup || '') +
            (target.guard ? `if (${target.guard}) { ${assignment} }` : assignment)
          );
        }
        if (head?.name === 'set') {
          if (args.length !== 2) fail('set expects a name or dot target and value', statement);
          const local = writable(args[0]),
            value = valueExpression(args[1]);
          if (local.helper) fail(`Cannot reassign shader helper: ${args[0].name}`, args[0]);
          if (!local.mutable) fail(`Cannot assign shader input: ${args[0].name}`, args[0]);
          if (local.type !== value.type)
            fail('Shader assignment must preserve its variable type', statement);
          if (implicitResult) {
            const result = { ...value, code: `result${nextLocal++}` },
              assignment = `${local.code} = ${result.code};`,
              change = local.guard ? `if (${local.guard}) { ${assignment} }` : assignment;
            return `${local.setup || ''}let ${result.code}: ${typeName(result.type)} = ${value.code};\n${change}\n${returnValue(result, statement)}`;
          }
          const assignment = `${local.code} = ${value.code};`;
          return (
            (local.setup || '') +
            (local.guard ? `if (${local.guard}) { ${assignment} }` : assignment)
          );
        }
        if (head?.name === 'return') {
          if (args.length !== 1) fail('Shader return expects one value', statement);
          const value = valueExpression(args[0]);
          return returnValue(value, args[0]);
        }
        if (implicitResult) return returnValue(valueExpression(statement), statement);
        if (head?.kind === 'symbol') {
          const scope = [...scopes].reverse().find((scope) => scope.has(head.name));
          if (scope?.get(head.name).helper) return `${expression(statement).code};`;
        }
        fail(`Unsupported shader statement: ${head?.name || statement.kind}`, statement);
      });
      return { code: lines.filter(Boolean).join('\n'), returns, returnType };
    } finally {
      scopes.pop();
    }
  };
  const compiled = statements(body, new Map(), true);
  if (!compiled.returns) fail('Shader must return a vec4f RGBA color on every path');
  for (let i = 0; i < helpers.length; i++) compileHelper(helpers[i]);
  if (needsBefore) {
    const resource = {
      name: 'before',
      type: 'texture2d',
      kind: 'texture',
      code: 'before',
      binding: resources.length + 1,
      automatic: true,
    };
    uniforms.push(resource);
    resources.push(resource);
  }
  const hasSampler = resources.some((resource) => resource.kind === 'texture') || needsSampler;
  const resourceCode = resources
    .map((resource) =>
      resource.kind === 'storage'
        ? `@group(0) @binding(${resource.binding}) var<storage, read> ${resource.code}: array<${typeName(elementType(resource.element))}${resource.capacity ? ', ' + resource.capacity : ''}>;`
        : `@group(0) @binding(${resource.binding}) var ${resource.code}: texture_2d<f32>;`,
    )
    .join('\n');
  const wgsl = `${__vertexWGSL__}
struct Frame { data: vec4f, ${uniformCount ? `values: array<vec4u, ${uniformCount}>,` : ''} }
@group(0) @binding(0) var<uniform> frame: Frame;
${[...generatedStructs.values()]
  .reverse()
  .map((struct) => struct.code)
  .join('\n')}
${resourceCode}
${hasSampler ? `@group(0) @binding(${resources.length + 1}) var shaderSampler: sampler;` : ''}
${helperCode.join('\n')}
@fragment fn fragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
${builtinCode('pixel.xy')}
${compiled.code}
}`;
  return {
    wgsl,
    uniforms,
    uniformCount,
    resources,
    hasSampler,
    parameterCount,
    source,
    start: node.start,
    end: node.end,
  };
}

export const Shader = {
  vertexWGSL: __vertexWGSL__,
  compileShader: __compileShader__,
};
