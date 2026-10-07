import { parseConditional } from './conditionals.js';
// Emitters return an expression string or { statement: JavaScript }.
export const forms = {
  struct(args, emit, context) {
    if (!context.inStatement) throw new SyntaxError('struct requires statement position');
    return { statement: context.struct(args) };
  },
  many(args, emit, context) { return context.array(args, "many"); },
  array(args, emit, context) { return context.array(args); },
  and(args, emit, context) { return context.selector(args, 'and'); },
  or(args, emit, context) { return context.selector(args, 'or'); },
  not(args, emit, context) {
    if (args.length !== 1) throw new SyntaxError('not expects exactly one operand');
    return `(!${boolOperand('not', args[0], 0, emit, context)})`;
  },
  sh(args, emit, context) { return context.shader(context.node); },
  on(args, emit, context) {
    if (args.length < 2 || args[1].kind !== 'list') {
      throw new SyntaxError('on expects callback name, parameter list, and body statements');
    }
    if (!context.inStatement) throw new SyntaxError('on requires statement position');
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
    return { statement: `let ${context.declaration(args[0])} = ${emit(args[1])}; ${context.declarationComment(args[0])}` };
  },
  set(args, emit, context) {
    if (args.length !== 2) throw new SyntaxError('set expects name and value');
    if (args[0].kind === 'access') return context.setAccess(args[0], args[1]);
    return `(${context.assign(args[0])} = ${emit(args[1])})`;
  },
  if(args, emit, context) {
    const parsed = parseConditional(args, message => { throw new SyntaxError(message); });
    if (context.inStatement) {
      const code = parsed.branches.map(branch => `if (${context.condition(branch.condition)}) ${context.block(branch.body)}`).join(' else ');
      return { statement: code + (parsed.otherwise ? ` else ${context.block(parsed.otherwise)}` : '') };
    }
    if (parsed.explicit) throw new SyntaxError('if branch chains require statement position');
    const condition = context.condition(args[0]);
    return `(${condition} ? ${emit(args[1])} : ${args[2] ? emit(args[2]) : 'null'})`;
  },
};

function boolOperand(name, node, index, emit, context) {
  return context.assertion(emit(node), { kind: 'symbol', name: 'bool', start: node.start, end: node.end },
    `${name} operand ${index + 1}`, node);
}

// Register block declarations before emission to preserve JavaScript's TDZ.
forms.let.declares = args => {
  if (args.length !== 2) throw new SyntaxError('let expects name and value');
  return args[0];
};
forms.struct.declares = args => {
  if (!args.length) throw new SyntaxError('struct expects a name and fields');
  return args[0];
};
