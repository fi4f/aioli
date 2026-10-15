import { Conditionals } from './conditionals.js';
// Emitters return an expression string or { statement: JavaScript }.
const __forms__ = {
  type(args, emit) {
    if (args.length !== 1) throw new SyntaxError('type expects exactly one value');
    return `$type(${emit(args[0])})`;
  },
  get(args, emit) {
    if (args.length !== 1 || !['symbol', 'access'].includes(args[0]?.kind))
      throw new SyntaxError('get expects one binding name or dot path');
    return emit(args[0]);
  },
  async(args, emit, context) {
    if (args.length !== 1) throw new SyntaxError('async expects one function');
    if (args[0]?.kind === 'list' && args[0].items[0]?.name === 'fn') {
      const [, parameters, ...body] = args[0].items;
      if (parameters?.kind !== 'list') throw new SyntaxError('async fn expects a parameter list');
      return context.function(parameters.items, body, true);
    }
    return `$promises.fn(${emit(args[0])})`;
  },
  promise(args, emit, context) {
    return context.chain(args);
  },
  resolve(args, emit, context) {
    if (!context.inStatement) throw new SyntaxError('resolve requires statement position');
    return context.settle('resolve', args);
  },
  reject(args, emit, context) {
    if (!context.inStatement) throw new SyntaxError('reject requires statement position');
    return context.settle('reject', args);
  },
  await(args, emit, context) {
    return context.await(args);
  },
  while: __loopForm__('while'),
  until: __loopForm__('until'),
  for: __loopForm__('for'),
  break: __loopForm__('break'),
  continue: __loopForm__('continue'),
  text(args, emit, context) {
    return context.text(args);
  },
  struct(args, emit, context) {
    if (!context.inStatement) throw new SyntaxError('struct requires statement position');
    return { statement: context.struct(args) };
  },
  many(args, emit, context) {
    return context.array(args, 'many');
  },
  array(args, emit, context) {
    return context.array(args);
  },
  and(args, emit, context) {
    return context.selector(args, 'and');
  },
  or(args, emit, context) {
    return context.selector(args, 'or');
  },
  not(args, emit, context) {
    if (args.length !== 1) throw new SyntaxError('not expects exactly one operand');
    return `(!${context.condition(args[0])})`;
  },
  sh(args, emit, context) {
    return context.shader(context.node);
  },
  on(args, emit, context) {
    // In value position, construct a Lisp-owned component handler. Scene hooks
    // retain their statement-only contract and their fixed parameter limits.
    if (args.length === 2 && args[1]?.kind === 'list' && args[1].items[0]?.name === 'fn') {
      const [, parameters, ...body] = args[1].items;
      if (parameters?.kind !== 'list')
        throw new SyntaxError(`fn ${context.inStatement ? 'callback' : 'handler'} expects a parameter list`);
      if (!context.inStatement) return context.handler(args[0], parameters.items, body);
      return { statement: context.callback(args[0], parameters.items, body) };
    }
    if (args.length === 2 && args[1]?.kind === 'list' && args[1].items[0]?.name === 'async') {
      if (!context.inStatement) return context.handlerValue(args[0], args[1]);
      const wrapped = args[1].items[1];
      if (args[1].items.length !== 2) throw new SyntaxError('async expects one function');
      if (wrapped?.kind !== 'list' || wrapped.items[0]?.name !== 'fn')
        return { statement: context.callbackValue(args[0], args[1]) };
      const [, parameters, ...body] = wrapped.items;
      if (parameters?.kind !== 'list')
        throw new SyntaxError('async callback expects a parameter list');
      return { statement: context.callback(args[0], parameters.items, body, true) };
    }
    if (args.length === 2 && ['symbol', 'access'].includes(args[1]?.kind)) {
      if (!context.inStatement) return context.handlerValue(args[0], args[1]);
      return { statement: context.callbackValue(args[0], args[1]) };
    }
    if (args.length < 2 || args[1]?.kind !== 'list') {
      if (!context.inStatement)
        throw new SyntaxError('on handler expects a name, parameter list, and body');
      throw new SyntaxError('on expects callback name, parameter list, and body statements');
    }
    if (!context.inStatement) return context.handler(args[0], args[1].items, args.slice(2));
    return { statement: context.callback(args[0], args[1].items, args.slice(2)) };
  },
  fn(args, emit, context) {
    if (!args.length || args[0].kind !== 'list') {
      throw new SyntaxError('fn expects a parameter list followed by body statements');
    }
    return context.function(args[0].items, args.slice(1));
  },
  return(args, emit, context) {
    if (!context.inFunction) throw new SyntaxError('return requires a function');
    if (!context.inStatement) throw new SyntaxError('return requires statement position');
    if (args.length > 1) throw new SyntaxError('return expects at most one value');
    return { statement: args.length ? `return ${emit(args[0])};` : 'return null;' };
  },
  let(args, emit, context) {
    if (args.length !== 2) throw new SyntaxError('let expects name and value');
    if (!context.inStatement) throw new SyntaxError('let requires statement position');
    return {
      statement: `${context.declarationComment(args[0])}\n${context.declarationKind(args[0])} ${context.declaration(args[0])} = ${context.declarationValue(args[0], args[1], emit)};`,
    };
  },
  set(args, emit, context) {
    if (args.length !== 2) throw new SyntaxError('set expects name and value');
    if (args[0].kind === 'access') return context.setAccess(args[0], args[1]);
    return `(${context.assign(args[0])} = ${emit(args[1])})`;
  },
  if(args, emit, context) {
    const parsed = Conditionals.parseConditional(args, (message) => {
      throw new SyntaxError(message);
    });
    if (context.inStatement) {
      const code = parsed.branches
        .map(
          (branch) =>
            `if (${context.condition(branch.condition)}) ${context.block(branch.body, context.returnLast && !branch.block)}`,
        )
        .join(' else ');
      return {
        statement:
          code +
          (parsed.otherwise
            ? ` else ${context.block(parsed.otherwise, context.returnLast && !parsed.otherwiseBlock)}`
            : ''),
      };
    }
    if (parsed.explicit) throw new SyntaxError('if branch chains require statement position');
    const condition = context.condition(args[0]);
    return `(${condition} ? ${emit(args[1])} : ${args[2] ? emit(args[2]) : 'null'})`;
  },
};
function __loopForm__(name) {
  return (args, emit, context) => {
    if (!context.inStatement) throw new SyntaxError(`${name} requires statement position`);
    return context.loop(name, args);
  };
}

// Register block declarations before emission to preserve JavaScript's TDZ.
__forms__.let.declares = (args) => {
  if (args.length !== 2) throw new SyntaxError('let expects name and value');
  return args[0];
};
__forms__.struct.declares = (args) => {
  if (!args.length) throw new SyntaxError('struct expects a name and fields');
  return args[0];
};

export const Forms = __forms__;
