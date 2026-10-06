import { locate, runtimeDiagnostics } from './diagnostics.js';
import { compileShader } from './shader.js';
import { assertType, parseParameters, typeNames } from './types.js';

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
      const node = readExpression();
      return { ...node, start, end: i };
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
    while (i < source.length && !/[\s(){};":]/.test(source[i])) i++;
    const token = source.slice(start, i);
    if (token === 'NaN' || token === 'Infinity' || token === '-Infinity') {
      return { kind: 'literal', value: Number(token) };
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) fail('Number must be finite');
      return { kind: 'literal', value };
    }
    if (token === 'true' || token === 'false') return { kind: 'literal', value: token === 'true' };
    return { kind: 'symbol', name: token };
  };
  const expressions = [];
  skip();
  while (i < source.length) { expressions.push(expression()); skip(); }
  return expressions;
}

// Bindings are runtime values/functions; forms are trusted compile-time emitters.
export function compile(source, bindings = {}, forms = {}, { debug = true, scene = false } = {}) {
  let nextLocal = 0;
  let functionDepth = 0;
  const hosts = new Map(Object.keys(bindings).map((name, index) =>
    [name, { identifier: `$binding${index}`, mutable: false }]));
  const scopes = [hosts];
  const names = new Map([...hosts].map(([name, variable]) => [variable.identifier, name]));
  const callbacks = new Set();
  const shaders = [];
  const lookup = name => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(name)) return scopes[i].get(name);
    }
    throw new SyntaxError(`Unknown symbol: ${name}`);
  };
  const symbolName = node => {
    if (node?.kind !== 'symbol') throw new SyntaxError('Variable name must be a symbol');
    return node.name;
  };
  const context = {
    assertion(value, annotation, label, at) {
      if (annotation.kind !== 'symbol' || !typeNames.has(annotation.name)) {
        throw locate(new SyntaxError(`Unknown assertion type: ${annotation.name || annotation.kind}`), source, annotation.start, annotation.end);
      }
      const code = `$assert(${value}, ${JSON.stringify(annotation.name)}, ${JSON.stringify(label)})`;
      return debug ? `$debug.at(${at.start}, ${at.end}, () => (${code}))` : code;
    },
    shader(node) {
      const index = shaders.length;
      shaders.push(compileShader(node, source));
      return `$shaders[${index}]`;
    },
    callback(nameNode, parameters, body) {
      if (!scene) throw new SyntaxError('on requires scene compilation');
      if (scopes.length !== 2 || functionDepth) throw new SyntaxError('on must be declared at scene top level');
      const name = symbolName(nameNode);
      if (!['attach', 'detach', 'update', 'render'].includes(name)) throw new SyntaxError(`Unknown callback: ${name}`);
      if (callbacks.has(name)) throw new SyntaxError(`Duplicate callback: ${name}`);
      const receivesTime = name === 'update' || name === 'render';
      const parsed = parseParameters(parameters, { fail: (message, node) => {
        throw locate(new SyntaxError(message), source, node.start, node.end);
      } });
      if (parsed.length > (receivesTime ? 1 : 0)) {
        const argument = name === 'render' ? 'render-context' : 'dt';
        throw new SyntaxError(`${name} accepts ${receivesTime ? `at most one ${argument} parameter` : 'no parameters'}`);
      }
      callbacks.add(name);
      return `$scene[${JSON.stringify(name)}] = ${context.function(parameters, body)};`;
    },
    declaration(node) {
      return scopes.at(-1).get(symbolName(node)).identifier;
    },
    assign(node) {
      const name = symbolName(node), variable = lookup(name);
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
        if (scope.has(name) || Object.hasOwn(forms, name)) {
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
      const identifiers = [...scope.values()].map(variable => variable.identifier);
      functionDepth++;
      try {
        return `(function(${identifiers.join(', ')}) {\n${checks.join('\n')}\n${sequence(body, false, scope)}\n})`;
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
      return debug && typeof result === 'string'
        ? `$debug.at(${node.start}, ${node.end}, () => (${result}))`
        : result;
    } catch (error) { throw locate(error, source, node.start, node.end); }
  };
  const emitRaw = (node, statement = false) => {
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
    if (node.kind === 'block') {
      if (!statement) throw new SyntaxError('Block requires statement position');
      return { statement: context.block(node.items) };
    }
    const [head, ...args] = node.items;
    if (!head) throw new SyntaxError('Empty list is not callable');
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
    const argumentsCode = args.map(arg => emit(arg)).join(', ');
    return debug
      ? `$debug.call(${node.start}, ${node.end}, ${callee}, [${argumentsCode}])`
      : `(${callee})(${argumentsCode})`;
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
          if (scope.has(declaredName) || Object.hasOwn(forms, declaredName)) {
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
    `const ${variable.identifier} = $bindings[${JSON.stringify(name)}];`);
  const javascript = ['"use strict";', ...declarations,
    ...(scene ? ['const $scene = {};'] : []),
    sequence(read(source), !scene),
    ...(scene ? ['return $scene;'] : []),
  ].join('\n');
  const execute = debug
    ? new Function('$bindings', '$shaders', '$assert', '$debug', javascript)
    : new Function('$bindings', '$shaders', '$assert', javascript);
  const diagnostics = debug ? runtimeDiagnostics(source, names) : undefined;
  return { javascript, scene, shaders, run: (shaderValues = []) => execute(bindings, shaderValues, assertType, diagnostics) };
}
