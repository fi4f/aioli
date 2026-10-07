import { locate, runtimeTrace } from '../language/trace.js';
import { compileShader } from './shader.js';
import { assertType, parseParameters, typeNames, access, setAccess } from '../language/types.js';
import { createStruct, createArray, createMany, arrayType, manyType } from '../language/structures.js';
import { normalizeNil, bool } from '../language/data.js';
import { scalarTypes, vectorTypes, canonicalType } from '../language/numeric-types.js';
import { isTransformConstructor } from '../language/transforms.js';
import { isConfigureBinding } from '../runtime/contracts.js';
import { inputCallbacks } from '../runtime/contracts.js';
import { loopRuntime } from '../language/loops.js';
import { promiseRuntime } from '../language/promises.js';
import { moduleNamespace, importRuntime } from '../runtime/modules.js';
import { nameComment } from './codegen.js';
import { scanToken } from './tokenize.js';
import { textOperations, textNamedOptions, validateTextArity, createTextBuilder, textOperation, finishTextBuilder, textDescription, bindTextShader } from '../language/text.js';

export function read(source) {
  let i = 0;
  const fail = message => { throw locate(new SyntaxError(message), source, Math.min(i, source.length)); };
  const skip = () => {
    while (i < source.length) {
      const token = scanToken(source, i);
      if (token.kind === 'whitespace' || token.kind === 'comment') i = token.end;
      else break;
    }
  };
  const expression = () => {
    skip();
    if (i >= source.length) fail('Expected an expression');
    const start = i;
    try {
      let node = { ...readExpression(), start, end: i };
      while (source[i] === '.' && source[i + 1] !== '.') {
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
      if (source.slice(i, i + 2) === '..') {
        i += 2;
        const end = expression();
        node = { kind: 'range', from: node, to: end, start, end: i };
      }
      return node;
    } catch (error) { throw locate(error, source, start, i); }
  };
  const readExpression = () => {
    const start = i, character = source[i++];
    if (character === ':') return { kind: 'colon' };
    if (character === '<' || character === '>') {
      const end = source[i] === '=' ? i + 1 : i;
      if (end === source.length || /[\s(){};":]/.test(source[end])) {
        i = end;
        return { kind: 'symbol', name: source.slice(start, i) };
      }
    }
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
      const token = scanToken(source, start);
      i = token.end;
      if (!token.closed) fail('Unterminated string');
      try {
        return { kind: 'literal', value: JSON.parse(source.slice(start, i)) };
      } catch { fail('Invalid string'); }
    }
    const lexical = scanToken(source, start);
    if (lexical.kind === 'number') {
      i = lexical.end;
      const value = Number(lexical.text);
      if (!Number.isFinite(value)) fail('Number must be finite');
      return { kind: 'literal', value };
    }
    if (character === '.') fail('Expected an expression before dot access');
    if (lexical.kind === 'word') {
      i = lexical.end;
      if (lexical.malformed) fail('Malformed array type annotation');
      if (lexical.angleDepth !== 0) fail('Missing closing angle bracket');
    }
    let depth = 0;
    while (lexical.kind !== 'word' && i < source.length) {
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
function standaloneImport(node) {
  if (node?.kind !== 'list') return false;
  if (node.items[0]?.name === 'import') return 'promise';
  if (node.items[0]?.name === 'await' && node.items.length === 2 &&
      node.items[1]?.kind === 'list' && node.items[1].items[0]?.name === 'import') return 'await';
  return false;
}

export function compile(source, bindings = {}, forms = {}, { trace = true, scene = false, module = false, sourceURL, textRenderer = textDescription } = {}) {
  let nextLocal = 0;
  let functionDepth = 0;
  let asyncFunction = false;
  let loopDepth = 0;
  const textScopes = [];
  let nextText = 0;
  const hosts = new Map(Object.keys(bindings).map((name, index) =>
    [name, { identifier: `$binding${index}`, mutable: false, namedArguments: isTransformConstructor(bindings[name]), configurationArguments: isConfigureBinding(bindings[name]) }]));
  const scopes = [hosts];
  const importScopes = new WeakMap();
  let nextImportScope = 0;
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
    const imported = scopes.toReversed().map(scope => importScopes.get(scope)).filter(Boolean);
    if (imported.length) return { identifier: `$imports.cell([${imported.join(', ')}], ${JSON.stringify(name)}).value`, mutable: true };
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
    callbackValue(nameNode, value) {
      if (!scene && !module) throw new SyntaxError('on requires scene or module compilation');
      if (scopes.length !== 2 || functionDepth) throw new SyntaxError('on must be declared at scene top level');
      const name = symbolName(nameNode);
      if (!['attach', 'detach', 'update', 'render', 'resize', ...inputCallbacks].includes(name)) throw new SyntaxError(`Unknown callback: ${name}`);
      if (callbacks.has(name)) throw new SyntaxError(`Duplicate callback: ${name}`);
      callbacks.add(name);
      return `$scene[${JSON.stringify(name)}] = $promises.callback(${emit(value)}, ${JSON.stringify(name)}, ${['attach', 'detach'].includes(name) ? 0 : 1}, ${!['update', 'render'].includes(name)});`;
    },
    text(nodes) {
      const builder = `$text${nextText++}`;
      const savedLoopDepth = loopDepth; loopDepth = 0;
      const savedAsync = asyncFunction; asyncFunction = false;
      textScopes.push({ builder, functionDepth });
      try { return `(function() {\nconst ${builder} = $text.create();\n${sequence(nodes)}\nreturn $text.finish(${builder});\n})()`; }
      finally { textScopes.pop(); loopDepth = savedLoopDepth; asyncFunction = savedAsync; }
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
      variable.definition = constructor; variable.mutable = module && scopes.length === 2;
      return `${nameComment(name)}\n${variable.mutable ? 'let' : 'const'} ${variable.identifier} = $descriptors[${index}];`;
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
    callback(nameNode, parameters, body, asynchronous = false) {
      if (!scene && !module) throw new SyntaxError('on requires scene or module compilation');
      if (scopes.length !== 2 || functionDepth) throw new SyntaxError('on must be declared at scene top level');
      const name = symbolName(nameNode);
      if (asynchronous && ['update', 'render'].includes(name)) throw new SyntaxError('update and render callbacks must remain synchronous');
      if (!['attach', 'detach', 'update', 'render', 'resize', ...inputCallbacks].includes(name)) throw new SyntaxError(`Unknown callback: ${name}`);
      if (callbacks.has(name)) throw new SyntaxError(`Duplicate callback: ${name}`);
      const receivesTime = name === 'update' || name === 'render' || name === 'resize' || inputCallbacks.includes(name);
      const parsed = parseParameters(parameters, { fail: (message, node) => {
        throw locate(new SyntaxError(message), source, node.start, node.end);
      } });
      if (parsed.length > (receivesTime ? 1 : 0)) {
        const argument = `${name}-context`;
        throw new SyntaxError(`${name} accepts ${receivesTime ? `at most one ${argument} parameter` : 'no parameters'}`);
      }
      callbacks.add(name);
      return `$scene[${JSON.stringify(name)}] = ${context.function(parameters, body, asynchronous)};`;
    },
    declaration(node) {
      return scopes.at(-1).get(symbolName(node)).identifier;
    },
    declarationComment(node) { return nameComment(symbolName(node)); },
    assign(node) {
      const name = symbolName(node), variable = lookup(name);
      if (variable.definition && !variable.mutable) throw new SyntaxError(`Cannot reassign struct: ${name}`);
      if (!variable.mutable) throw new SyntaxError(`Cannot assign host binding: ${name}`);
      return variable.identifier;
    },
    block(nodes) { return `{\n${sequence(nodes)}\n}`; },
    loop(name, args) {
      if (name === 'break' || name === 'continue') {
        if (args.length || !loopDepth) throw new SyntaxError(`${name} requires a loop and no arguments`);
        return { statement: `${name};` };
      }
      const conditional = name === 'while' || name === 'until';
      const minimum = conditional ? 1 : 2;
      if (args.length < minimum) throw new SyntaxError(`${name} requires ${conditional ? 'a condition' : 'a binding name and input'}`);
      if (name === 'for') args = [args[1], args[0], ...args.slice(2)];
      if (conditional) {
        const condition = context.condition(args[0]);
        loopDepth++;
        try { return { statement: `while (${name === 'until' ? `!(${condition})` : condition}) ${context.block(args.slice(1))}` }; }
        finally { loopDepth--; }
      }
      const binding = symbolName(args[1]);
      if (Object.hasOwn(forms, binding) || textScopes.length && textOperations.has(binding)) throw new SyntaxError(`Invalid loop binding: ${binding}`);
      const id = `$local${nextLocal++}`, scope = new Map([[binding, { identifier: id, mutable: true }]]);
      names.set(id, binding);
      const temp = `$loop${nextLocal++}`;
      const checked = (code, at) => trace ? hasAwait(at) ? `(await $trace.asyncAt(${at.start}, ${at.end}, async () => (${code})))` : `$trace.at(${at.start}, ${at.end}, () => (${code}))` : code;
      let prefix, header, assignment;
      const range = args[0];
      const input = range.kind === 'range' ? `$loops.range(${emit(range.from)}, ${emit(range.to)})` : `$loops.for(${emit(range)})`;
      prefix = `const ${temp} = ${checked(input, range)};`;
      header = `let ${temp}i = ${temp}.from; ${temp}.step > 0 ? ${temp}i < ${temp}.to : ${temp}i > ${temp}.to; ${temp}i += ${temp}.step`;
      assignment = `let ${id} = ${temp}.range ? ${temp}i : $loops.get(${temp}.value, ${temp}i);`;
      loopDepth++;
      try { return { statement: `{\n${prefix}\nfor (${header}) {\n${assignment}\n${sequence(args.slice(2), false, scope)}\n}\n}` }; }
      finally { loopDepth--; }
    },
    await(args) {
      if (!asyncFunction) throw new SyntaxError('await requires top-level code, an async function or a promise handler');
      if (args.length !== 1) throw new SyntaxError('await expects one value');
      return `$nil((await ${emit(args[0])}))`;
    },
    chain(args) {
      if (!args.length) throw new SyntaxError('async expects an initial expression');
      const initial = args[0];
      let code = `Promise.resolve().then(${context.function([], [{ kind: 'list', items: [{ kind: 'symbol', name: 'return', start: initial.start, end: initial.start }, initial], start: initial.start, end: initial.end }], true)})`;
      for (let i = 1; i < args.length;) {
        const marker = args[i++], name = marker?.name;
        if (!['then', 'catch', 'finally'].includes(name)) throw new SyntaxError('Expected then, catch or finally in async chain');
        let parameters = [];
        if (name !== 'finally') {
          const spec = args[i++];
          if (spec?.kind !== 'list' || parseParameters(spec.items, { fail: message => { throw new SyntaxError(message); } }).length > 1) throw new SyntaxError(`${name} expects zero or one handler parameter`);
          parameters = spec.items;
        }
        const body = args[i++];
        if (!body) throw new SyntaxError(`${name} expects a handler body`);
        const fn = context.function(parameters, body.kind === 'block' ? body.items : [body], true);
        code += name === 'catch' ? `.catch(error => (${fn})($promises.error(error)))` : `.${name}(${fn})`;
      }
      return `$promises.mark(${code})`;
    },
    function(parameters, body, asynchronous = false) {
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
      const savedAsync = asyncFunction; asyncFunction = asynchronous;
      const savedLoopDepth = loopDepth; loopDepth = 0;
      try {
        const code = `(${asynchronous ? 'async ' : ''}function(${identifiers.join(', ')}) {\n${checks.join('\n')}\n${sequence(body, false, scope)}\nreturn null;\n})`;
        return `$promises.define(${code}, ${parsed.length}, ${asynchronous})`;
      } finally { functionDepth--; loopDepth = savedLoopDepth; asyncFunction = savedAsync; }
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
        ? hasAwait(node) ? `(await $trace.asyncAt(${node.start}, ${node.end}, async () => (${result})))` : `$trace.at(${node.start}, ${node.end}, () => (${result}))`
        : result;
    } catch (error) { throw locate(error, source, node.start, node.end); }
  };
  function hasAwait(node) {
    if (node.kind === 'list') {
      if (['fn', 'async', 'text', 'sh', 'on'].includes(node.items[0]?.name)) return false;
      if (node.items[0]?.name === 'await') return true;
      return node.items.some(hasAwait);
    }
    if (node.kind === 'block') return node.items.some(hasAwait);
    if (node.kind === 'access') return hasAwait(node.target);
    if (node.kind === 'range') return hasAwait(node.from) || hasAwait(node.to);
    if (node.kind === 'template') return node.parts.some(part => part.kind === 'interpolation' && hasAwait(part.expression));
    return false;
  }
  const emitRaw = (node, statement = false) => {
    const importing = statement && standaloneImport(node);
    if (importing) {
      const target = importScopes.get(scopes.at(-1));
      const value = emit(node);
      return importing === 'await'
        ? `$imports.merge(${target}, ${value})`
        : `$promises.mark(Promise.resolve(${value}).then(namespace => $imports.merge(${target}, namespace)))`;
    }
    if (node.kind === 'range') throw new SyntaxError('Ranges are only supported as for inputs');
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
      if (textOperations.has(head.name)) {
        validateTextArity(head.name, args.length);
        if (args.every(arg => arg.kind === 'literal' ||
          arg.kind === 'symbol' && textNamedOptions[head.name]?.includes(arg.name))) {
          textOperation(createTextBuilder(), head.name, ...args.map(arg => arg.kind === 'literal' ? arg.value : arg.name));
        }
        return `$text.apply(${textScopes.at(-1).builder}, ${JSON.stringify(head.name)}${args.length ? ', ' + args.map(arg => arg.kind === 'symbol' && textNamedOptions[head.name]?.includes(arg.name) ? JSON.stringify(arg.name) : emit(arg)).join(', ') : ''})`;
      }
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
    const constructor = head.kind === 'symbol' && (lookup(head.name).definition || lookup(head.name).namedArguments || args.length !== 1 && lookup(head.name).configurationArguments);
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
      let prefix = '';
      if (nodes.some(standaloneImport)) {
        const identifier = `$importScope${nextImportScope++}`;
        const parents = scopes.slice(0, -1).toReversed().map(scope => importScopes.get(scope)).filter(Boolean);
        const reserved = [...new Set([...scopes.flatMap(scope => [...scope.keys()]), ...Object.keys(forms), ...(textScopes.length ? textOperations : [])])];
        importScopes.set(scope, identifier);
        prefix = `const ${identifier} = $imports.scope(${JSON.stringify(reserved)}, [${parents.join(', ')}]);\n`;
      }
      return prefix + nodes.map((node, index) => {
        const result = emit(node, true);
        if (typeof result !== 'string') return result.statement;
        return `${returnLast && index === nodes.length - 1 ? 'return ' : ''}${result};`;
      }).join('\n');
    } finally { scopes.pop(); }
  }
  const nodes = read(source);
  const asynchronous = nodes.some(hasAwait);
  asyncFunction = asynchronous;
  const Execute = asynchronous ? Object.getPrototypeOf(async function () {}).constructor : Function;
  const declarations = [...hosts].map(([name, variable]) =>
    `const ${variable.identifier} = $nil($bindings[${JSON.stringify(name)}]);`);
  const moduleScope = new Map();
  const body = sequence(nodes, !scene && !module, moduleScope);
  const members = [...moduleScope].map(([name, variable]) =>
    `[${JSON.stringify(name)}, () => ${variable.identifier}, value => { ${variable.identifier} = value; }]`).join(', ');
  const javascript = ['"use strict";', ...declarations,
    ...(scene || module ? ['const $scene = {};'] : []),
    body,
    module ? `return $module([${members}], $scene, ${importScopes.get(moduleScope) ?? 'undefined'});` : scene ? 'return $scene;' : 'return null;',
  ].join('\n');
  const execute = trace
    ? new Execute('$bindings', '$shaders', '$assert', '$access', '$nil', '$bool', '$setAccess', '$descriptors', '$array', '$many', '$trace', '$text', '$loops', '$promises', '$module', '$imports', javascript)
    : new Execute('$bindings', '$shaders', '$assert', '$access', '$nil', '$bool', '$setAccess', '$descriptors', '$array', '$many', '$text', '$loops', '$promises', '$module', '$imports', javascript);
  const tracer = trace ? runtimeTrace(source, names, sourceURL) : undefined;
  const textRuntime = { create: createTextBuilder, apply: textOperation, finish: builder => textRenderer(finishTextBuilder(builder)), bind: bindTextShader };
  return { javascript, scene, module, asynchronous, shaders, run: (shaderValues = []) => {
    const result = execute(bindings, shaderValues, assertType, access, normalizeNil, bool, setAccess, descriptors, createArray, createMany, ...(trace ? [tracer] : []), textRuntime, loopRuntime, promiseRuntime, moduleNamespace, importRuntime);
    return asynchronous ? promiseRuntime.mark(result) : result;
  } };
}
