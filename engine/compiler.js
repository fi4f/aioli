import { locate, runtimeTrace } from './trace.js';
import { compileShader } from './shader.js';
import { assertType, parseParameters, typeNames, access, setAccess } from './types.js';
import { createStruct, createArray, createMany, arrayType, manyType } from './structures.js';
import { normalizeNil, bool } from './data.js';
import { scalarTypes, vectorTypes, canonicalType } from './numeric-types.js';
import { isTransformConstructor } from './transforms.js';
import { inputCallbacks } from './input.js';
import { nameComment } from './codegen.js';
import { textOperations, textNamedOptions, createTextBuilder, textOperation, finishTextBuilder, textDescription, bindTextShader } from './text.js';

export function read(source) {
  let i = 0;
  const fail = message => { throw locate(new SyntaxError(message), source, Math.min(i, source.length)); };
  const skip = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) i++;
      else if (source[i] === ';') {
        while (i < source.length && source[i] !== '\n') i++;
      } else break;
    }
  };
  const expression = () => {
    skip();
    const start = i;
    try {
      let node = { ...readExpression(), start, end: i };
      while (source[i] === '.') {
        const fieldStart = i++;
        let key, quoted = false;
        if (source[i] === '"') {
          quoted = true;
          key = readExpression().value;
        } else {
          const keyStart = i;
          while (i < source.length && !/[\s(){};":.]/.test(source[i])) i++;
          key = source.slice(keyStart, i);
          if (!key) throw locate(new SyntaxError('Expected a key, index, or swizzle after dot'), source, fieldStart, i);
        }
        node = { kind: 'access', target: node, key, quoted, start, end: i, fieldStart };
      }
      return node;
    } catch (error) { throw locate(error, source, start, i); }
  };
  const readExpression = () => {
    const start = i, character = source[i++];
    if (character === ':') return { kind: 'colon' };
    if (character === 'f' && source[i] === '"') {
      i++;
      const parts = [];
      let text = '';
      const flush = () => {
        try { parts.push({ kind: 'literal', value: JSON.parse(`"${text}"`) }); }
        catch { fail('Invalid interpolated string'); }
        text = '';
      };
      while (i < source.length && source[i] !== '"') {
        const c = source[i++];
        if (c === '\\') {
          if (i >= source.length) fail('Unterminated interpolated string');
          text += c + source[i++];
        } else if (c === '{') {
          if (source[i] === '{') { text += '{'; i++; continue; }
          flush();
          skip();
          if (source[i] === '}' || i >= source.length) fail('Expected interpolation expression');
          parts.push({ kind: 'interpolation', expression: expression() });
          skip();
          if (source[i] !== '}') fail('Expected closing interpolation brace');
          i++;
        } else if (c === '}') {
          if (source[i] !== '}') fail('Literal closing brace must be doubled');
          text += '}'; i++;
        } else text += c;
      }
      if (i >= source.length) fail('Unterminated interpolated string');
      flush();
      i++;
      return { kind: 'template', parts };
    }
    if (character === '(' || character === '{') {
      const closing = character === '(' ? ')' : '}';
      const items = [];
      skip();
      while (source[i] !== closing) {
        if (i >= source.length) fail(`Missing closing ${closing}`);
        items.push(expression());
        skip();
      }
      i++;
      return { kind: character === '(' ? 'list' : 'block', items };
    }
    if (character === ')' || character === '}') fail(`Unexpected closing ${character}`);
    if (character === '"') {
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') i++;
        i++;
      }
      if (i >= source.length) fail('Unterminated string');
      i++;
      try {
        return { kind: 'literal', value: JSON.parse(source.slice(start, i)) };
      } catch { fail('Invalid string'); }
    }
    const numeric = source.slice(start).match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?=$|[\s(){};":.])/);
    if (numeric) {
      i = start + numeric[0].length;
      const value = Number(numeric[0]);
      if (!Number.isFinite(value)) fail('Number must be finite');
      return { kind: 'literal', value };
    }
    if (character === '.') fail('Expected an expression before dot access');
    let depth = 0;
    while (i < source.length) {
      if (source[i] === '<') depth++;
      else if (source[i] === '>') depth--;
      if (depth < 0) fail('Unexpected closing angle bracket');
      if (depth === 0 && /[\s(){};":.]/.test(source[i])) break;
      if (depth > 0 && /[(){};":]/.test(source[i])) fail('Malformed array type annotation');
      i++;
    }
    if (depth !== 0) fail('Missing closing angle bracket');
    const token = source.slice(start, i).replace(/\s/g, '');
    if (token === 'NaN' || token === 'Infinity' || token === '-Infinity') {
      return { kind: 'literal', value: Number(token) };
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) fail('Number must be finite');
      return { kind: 'literal', value };
    }
    if (token === 'true' || token === 'false') return { kind: 'literal', value: token === 'true' };
    if (token === 'nil') return { kind: 'literal', value: null };
    return { kind: 'symbol', name: token };
  };
  const expressions = [];
  skip();
  while (i < source.length) { expressions.push(expression()); skip(); }
  return expressions;
}

// Bindings are runtime values/functions; forms are trusted compile-time emitters.
export function compile(source, bindings = {}, forms = {}, { trace = true, scene = false, textRenderer = textDescription } = {}) {
  let nextLocal = 0;
  let functionDepth = 0;
  const textScopes = [];
  let nextText = 0;
  const hosts = new Map(Object.keys(bindings).map((name, index) =>
    [name, { identifier: `$binding${index}`, mutable: false, namedArguments: isTransformConstructor(bindings[name]) }]));
  const scopes = [hosts];
  const names = new Map([...hosts].map(([name, variable]) => [variable.identifier, name]));
  const callbacks = new Set();
  const shaders = [];
  const descriptors = [];
  const lookup = name => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(name)) {
        const variable = scopes[i].get(name);
        if (variable.shaderOnly) throw new SyntaxError(`Hoisted text cannot depend on shader value ${name}; use a regular Lisp value outside sh`);
        return variable;
      }
    }
    throw new SyntaxError(`Unknown symbol: ${name}`);
  };
  const symbolName = node => {
    if (node?.kind !== 'symbol') throw new SyntaxError('Variable name must be a symbol');
    return node.name;
  };
  const resolveElement = name => {
    name = canonicalType(name);
    const array = name.match(/^(array|many)<(.+),(\d+)>$/);
    if (array) return (array[1] === "many" ? manyType : arrayType)(resolveElement(array[2]), Number(array[3]));
    if (name.startsWith('array<') || name.startsWith('many<')) throw new SyntaxError('Struct collection fields require array<Element,Capacity> or many<Element,Capacity>');
    if (name === 'bool') return 'bool';
    if ([...scalarTypes, ...vectorTypes, 'mat2x2f', 'mat3x3f', 'mat4x4f'].includes(name)) return name;
    const type = lookup(name).definition;
    if (!type) throw new SyntaxError(`Unknown struct field type: ${name}`);
    return type;
  };
  const context = {
    text(nodes) {
      const builder = `$text${nextText++}`;
      textScopes.push({ builder, functionDepth });
      try { return `(function() {\nconst ${builder} = $text.create();\n${sequence(nodes)}\nreturn $text.finish(${builder});\n})()`; }
      finally { textScopes.pop(); }
    },
    array(args, kind = "array") {
      const [spec, ...values] = args;
      if (spec?.kind !== 'list' || spec.items.length < 1 || spec.items.length > 2 || spec.items[0].kind !== 'symbol') throw new SyntaxError(`${kind} expects (Element [capacity]) followed by initial elements`);
      const name = spec.items[0].name, type = resolveElement(name);
      const capacity = spec.items[1] ? emit(spec.items[1]) : 'undefined';
      const element = typeof type === 'string' ? JSON.stringify(type) : ['array', 'many'].includes(type.type) ? (() => { const index = descriptors.length; descriptors.push(type); return `$descriptors[${index}]`; })() : emit(spec.items[0]);
      return `${kind === "many" ? "$many" : "$array"}(${element}, ${capacity}${values.length ? ', ' + values.map(value => emit(value)).join(', ') : ''})`;
    },
    struct(args) {
      const name = symbolName(args[0]), fields = [];
      if (typeNames.has(name)) throw new SyntaxError(`Struct name conflicts with a built-in type: ${name}`);
      for (let i = 1; i < args.length; i += 3) {
        const key = args[i], colon = args[i + 1], type = args[i + 2];
        if (!(key?.kind === 'symbol' || key?.kind === 'literal' && typeof key.value === 'string') || colon?.kind !== 'colon' || type?.kind !== 'symbol') throw new SyntaxError('struct fields require a name or string key followed by : type');
        const fieldType = resolveElement(type.name);
        if (!fieldType) throw new SyntaxError(`Unknown struct field type: ${type.name}`);
        fields.push([key.kind === 'symbol' ? key.name : key.value, fieldType]);
      }
      const constructor = createStruct(name, fields), index = descriptors.length;
      descriptors.push(constructor);
      const variable = scopes.at(-1).get(name);
      variable.definition = constructor; variable.mutable = false;
      return `${nameComment(name)}\nconst ${variable.identifier} = $descriptors[${index}];`;
    },
    setAccess(node, replacement) { return `$setAccess(${emit(node.target)}, ${JSON.stringify(node.key)}, ${emit(replacement)}, ${node.quoted})`; },
    condition(node) { return `$bool(${emit(node)})`; },
    selector(nodes, operator) {
      if (!nodes.length) return operator === 'and' ? 'true' : 'false';
      if (nodes.length === 1) return emit(nodes[0]);
      const values = nodes.map(node => emit(node));
      const stop = operator === 'and' ? '!$bool($selected)' : '$bool($selected)';
      const statements = values.slice(1).map(value => `if (${stop}) return $selected;\n$selected = ${value};`);
      return `(function() {\nlet $selected = ${values[0]};\n${statements.join('\n')}\nreturn $selected;\n})()`;
    },
    assertion(value, annotation, label, at) {
      if (annotation.kind === 'literal' && annotation.value === null) annotation = { ...annotation, kind: 'symbol', name: 'nil' };
      if (annotation.kind !== 'symbol' || !typeNames.has(annotation.name)) {
        throw locate(new SyntaxError(`Unknown assertion type: ${annotation.name || annotation.kind}`), source, annotation.start, annotation.end);
      }
      const code = `$assert(${value}, ${JSON.stringify(annotation.name)}, ${JSON.stringify(label)})`;
      return trace ? `$trace.at(${at.start}, ${at.end}, () => (${code}))` : code;
    },
    shader(node) {
      const index = shaders.length;
      shaders.push(null); // Nested shaders in a hoisted text body need distinct indices.
      const visibleStructs = new Map();
      for (const scope of scopes) for (const [name, value] of scope) {
        if (value.definition) visibleStructs.set(name, value.definition);
        else visibleStructs.delete(name);
      }
      const texts = [];
      const descriptor = compileShader(node, source, { structDefinitions: visibleStructs,
        hoistText(text, shaderNames) {
          const blocked = new Map([...shaderNames].map(name => [name, { shaderOnly: true }]));
          scopes.push(blocked);
          try { texts.push({ start: text.start, code: emit(text), identifier: `$hoisted${texts.length}` }); } finally { scopes.pop(); }
        },
      });
      shaders[index] = descriptor;
      if (!texts.length) return `$shaders[${index}]`;
      const declarations = [...texts].sort((a, b) => a.start - b.start).map(text => `const ${text.identifier} = ${text.code};`).join('\n');
      return `(function() {\n${declarations}\nreturn $text.bind($shaders[${index}], [${texts.map(text => text.identifier).join(', ')}], ${descriptor.parameterCount});\n})()`;
    },
    callback(nameNode, parameters, body) {
      if (!scene) throw new SyntaxError('on requires scene compilation');
      if (scopes.length !== 2 || functionDepth) throw new SyntaxError('on must be declared at scene top level');
      const name = symbolName(nameNode);
      if (!['attach', 'detach', 'update', 'render', ...inputCallbacks].includes(name)) throw new SyntaxError(`Unknown callback: ${name}`);
      if (callbacks.has(name)) throw new SyntaxError(`Duplicate callback: ${name}`);
      const receivesTime = name === 'update' || name === 'render' || inputCallbacks.includes(name);
      const parsed = parseParameters(parameters, { fail: (message, node) => {
        throw locate(new SyntaxError(message), source, node.start, node.end);
      } });
      if (parsed.length > (receivesTime ? 1 : 0)) {
        const argument = `${name}-context`;
        throw new SyntaxError(`${name} accepts ${receivesTime ? `at most one ${argument} parameter` : 'no parameters'}`);
      }
      callbacks.add(name);
      return `$scene[${JSON.stringify(name)}] = ${context.function(parameters, body)};`;
    },
    declaration(node) {
      return scopes.at(-1).get(symbolName(node)).identifier;
    },
    declarationComment(node) { return nameComment(symbolName(node)); },
    assign(node) {
      const name = symbolName(node), variable = lookup(name);
      if (variable.definition) throw new SyntaxError(`Cannot reassign struct: ${name}`);
      if (!variable.mutable) throw new SyntaxError(`Cannot assign host binding: ${name}`);
      return variable.identifier;
    },
    block(nodes) { return `{\n${sequence(nodes)}\n}`; },
    function(parameters, body) {
      const scope = new Map();
      const checks = [];
      const parsed = parseParameters(parameters, { fail: (message, node) => {
        throw locate(new SyntaxError(message), source, node.start, node.end);
      } });
      for (const parameter of parsed) {
        const name = parameter.name;
        if (scope.has(name) || Object.hasOwn(forms, name) || textScopes.length && textOperations.has(name)) {
          throw new SyntaxError(`Invalid or duplicate parameter: ${name}`);
        }
        scope.set(name, { identifier: `$local${nextLocal++}`, mutable: true });
        names.set(scope.get(name).identifier, name);
        if (parameter.type) {
          checks.push(context.assertion(scope.get(name).identifier,
            { kind: 'symbol', name: parameter.type, start: parameter.start, end: parameter.end },
            `Parameter ${name}`, parameter) + ';');
        }
      }
      const identifiers = [...scope].map(([name, variable]) => `${nameComment(name)} ${variable.identifier} = null`);
      functionDepth++;
      try {
        return `(function(${identifiers.join(', ')}) {\n${checks.join('\n')}\n${sequence(body, false, scope)}\nreturn null;\n})`;
      } finally { functionDepth--; }
    },
    statement(node) {
      const result = emit(node, true);
      return typeof result === 'string' ? `${result};` : result.statement;
    },
  };
  const emit = (node, statement = false) => {
    try {
      const result = emitRaw(node, statement);
      return trace && typeof result === 'string'
        ? `$trace.at(${node.start}, ${node.end}, () => (${result}))`
        : result;
    } catch (error) { throw locate(error, source, node.start, node.end); }
  };
  const emitRaw = (node, statement = false) => {
    if (statement && textScopes.length && (node.kind === 'template' || node.kind === 'literal' && typeof node.value === 'string')) {
      return `$text.apply(${textScopes.at(-1).builder}, "span", ${emit(node)})`;
    }
    if (node.kind === 'colon') throw new SyntaxError('Colon annotations require a parameter or (value : type) expression');
    if (node.kind === 'template') {
      const content = node.parts.map(part => part.kind === 'interpolation'
        ? '${' + emit(part.expression) + '}'
        : part.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')).join('');
      return '`' + content + '`';
    }
    if (node.kind === 'literal') {
      if (typeof node.value === 'number') {
        if (Number.isNaN(node.value)) return '(0 / 0)';
        if (node.value === Infinity) return '(1 / 0)';
        if (node.value === -Infinity) return '(-1 / 0)';
        if (Object.is(node.value, -0)) return '-0';
      }
      return JSON.stringify(node.value);
    }
    if (node.kind === 'symbol') return lookup(node.name).identifier;
    if (node.kind === 'access') return `$access(${emit(node.target)}, ${JSON.stringify(node.key)}, ${node.quoted})`;
    if (node.kind === 'block') {
      if (!statement) throw new SyntaxError('Block requires statement position');
      return { statement: context.block(node.items) };
    }
    const [head, ...args] = node.items;
    if (!head) throw new SyntaxError('Empty list is not callable');
    if (head.kind === 'symbol' && textScopes.length) {
      if (head.name === 'return' && functionDepth === textScopes.at(-1).functionDepth) throw new SyntaxError('return cannot exit a text body; its result is the completed text');
      if (textOperations.has(head.name)) return `$text.apply(${textScopes.at(-1).builder}, ${JSON.stringify(head.name)}${args.length ? ', ' + args.map(arg => arg.kind === 'symbol' && textNamedOptions[head.name]?.includes(arg.name) ? JSON.stringify(arg.name) : emit(arg)).join(', ') : ''})`;
    }
    if (node.items[1]?.kind === 'colon') {
      if (node.items.length !== 3) throw new SyntaxError('Type assertion expects (value : type)');
      return context.assertion(emit(head), node.items[2], 'Value', node);
    }
    if (head.kind === 'symbol' && Object.hasOwn(forms, head.name)) {
      const result = forms[head.name](args, child => emit(child), {
        ...context, node, inStatement: statement, inFunction: functionDepth > 0,
      });
      if (!statement && typeof result !== 'string') throw new SyntaxError(`${head.name} requires statement position`);
      return result;
    }
    const callee = emit(head);
    const constructor = head.kind === 'symbol' && (lookup(head.name).definition || lookup(head.name).namedArguments);
    const argumentsCode = args.map((arg, index) => constructor && index % 2 === 0 && arg.kind === 'symbol' ? JSON.stringify(arg.name) : emit(arg)).join(', ');
    return trace
      ? `$nil($trace.call(${node.start}, ${node.end}, ${callee}, [${argumentsCode}]))`
      : `$nil((${callee})(${argumentsCode}))`;
  };
  function sequence(nodes, returnLast = false, scope = new Map()) {
    scopes.push(scope);
    try {
      // Register declarations for the whole block so JavaScript enforces its TDZ.
      for (const node of nodes) {
        if (node.kind !== 'list' || node.items[0]?.kind !== 'symbol') continue;
        const name = node.items[0].name;
        if (!Object.hasOwn(forms, name) || !forms[name].declares) continue;
        try {
          const declaredName = symbolName(forms[name].declares(node.items.slice(1)));
          if (scope.has(declaredName) || Object.hasOwn(forms, declaredName) || textScopes.length && textOperations.has(declaredName)) {
            throw new SyntaxError(`Name already defined: ${declaredName}`);
          }
          scope.set(declaredName, { identifier: `$local${nextLocal++}`, mutable: true });
          names.set(scope.get(declaredName).identifier, declaredName);
        } catch (error) {
          throw locate(error, source, node.start, node.end);
        }
      }
      return nodes.map((node, index) => {
        const result = emit(node, true);
        if (typeof result !== 'string') return result.statement;
        return `${returnLast && index === nodes.length - 1 ? 'return ' : ''}${result};`;
      }).join('\n');
    } finally { scopes.pop(); }
  }
  const declarations = [...hosts].map(([name, variable]) =>
    `const ${variable.identifier} = $nil($bindings[${JSON.stringify(name)}]);`);
  const javascript = ['"use strict";', ...declarations,
    ...(scene ? ['const $scene = {};'] : []),
    sequence(read(source), !scene),
    ...(scene ? ['return $scene;'] : ['return null;']),
  ].join('\n');
  const execute = trace
    ? new Function('$bindings', '$shaders', '$assert', '$access', '$nil', '$bool', '$setAccess', '$descriptors', '$array', '$many', '$trace', '$text', javascript)
    : new Function('$bindings', '$shaders', '$assert', '$access', '$nil', '$bool', '$setAccess', '$descriptors', '$array', '$many', '$text', javascript);
  const tracer = trace ? runtimeTrace(source, names) : undefined;
  const textRuntime = { create: createTextBuilder, apply: textOperation, finish: builder => textRenderer(finishTextBuilder(builder)), bind: bindTextShader };
  return { javascript, scene, shaders, run: (shaderValues = []) => execute(bindings, shaderValues, assertType, access, normalizeNil, bool, setAccess, descriptors, createArray, createMany, ...(trace ? [tracer] : []), textRuntime) };
}
