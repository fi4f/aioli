// Emitters return an expression string or { statement: JavaScript }.
export const forms = {
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
    return { statement: args.length ? `return ${emit(args[0])};` : 'return;' };
  },
  let(args, emit, context) {
    if (args.length !== 2) throw new SyntaxError('let expects name and value');
    if (!context.inStatement) throw new SyntaxError('let requires statement position');
    return { statement: `let ${context.declaration(args[0])} = ${emit(args[1])};` };
  },
  set(args, emit, context) {
    if (args.length !== 2) throw new SyntaxError('set expects name and value');
    return `(${context.assign(args[0])} = ${emit(args[1])})`;
  },
  if(args, emit, context) {
    if (args.length !== 3) throw new SyntaxError('if expects condition, then, else');
    const condition = emit(args[0]);
    if (context.inStatement) {
      return { statement: `if (${condition}) ${context.block([args[1]])} else ${context.block([args[2]])}` };
    }
    return `(${condition} ? ${emit(args[1])} : ${emit(args[2])})`;
  },
};

// Register block declarations before emission to preserve JavaScript's TDZ.
forms.let.declares = args => {
  if (args.length !== 2) throw new SyntaxError('let expects name and value');
  return args[0];
};
