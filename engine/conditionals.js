// Scene and shader compilers share branch syntax, but emit different targets.
export function parseConditional(args, fail) {
  if (args.length < 2) fail('if expects condition and then branch');
  const keyword = node => node?.kind === 'symbol' && ['elif', 'else'].includes(node.name);
  if (keyword(args[1])) fail('if expects a branch statement or block after its condition', args[1]);
  const body = node => node.kind === 'block' ? node.items : [node];
  const explicit = keyword(args[2]) || args.length > 3;
  if (!explicit) return {
    branches: [{ condition: args[0], body: body(args[1]) }],
    otherwise: args[2] ? body(args[2]) : null, explicit,
  };
  const branches = [{ condition: args[0], body: body(args[1]) }];
  let otherwise = null;
  for (let i = 2; i < args.length;) {
    const marker = args[i++];
    if (!keyword(marker)) fail('Expected elif or else after if branch', marker);
    if (marker.name === 'else') {
      const fallback = args[i++];
      if (!fallback || keyword(fallback)) fail('else expects a branch statement or block', fallback || marker);
      if (i !== args.length) fail('else must be the final branch', args[i]);
      otherwise = body(fallback);
    } else {
      const condition = args[i++], branch = args[i++];
      if (!condition || keyword(condition) || !branch || keyword(branch)) fail('elif expects a condition and branch statement or block', branch || condition || marker);
      branches.push({ condition, body: body(branch) });
    }
  }
  return { branches, otherwise, explicit };
}
