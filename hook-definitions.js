const symbol = (node) => node?.type === 'symbol';
const literal = (node) => {
  if (typeof node === 'number') return node;
  if (node?.type === 'string') return node.value;
  if (node?.type === 'vector') return node.items.map(literal);
  if (symbol(node) && ['true', 'false', 'nil'].includes(node.name))
    return { true: true, false: false, nil: null }[node.name];
  throw new Error('Hook preview annotations require literal values');
};

/** Runtime declarations are ordinary callable functions with optional preview metadata. */
export function hookDefinition(form) {
  if (!Array.isArray(form) || !['defdraw', 'defsound'].includes(form[0]?.name)) return null;
  const [, name, params, annotation] = form;
  if (!symbol(name) || params?.type !== 'vector' || !params.items.every(symbol))
    throw new Error(
      'Use (defdraw/defsound name [arguments] ["Title" [defaults] [width height]] body...)',
    );
  const annotated = annotation?.type === 'vector';
  const metadata = annotated ? literal(annotation) : [];
  if (metadata.length > 3 || (metadata.length && typeof metadata[0] !== 'string'))
    throw new Error('Hook annotation: ["Title" [argument defaults] [canvas width height]]');
  const defaults = metadata[1] ?? params.items.map(() => 0);
  if (!Array.isArray(defaults) || defaults.length !== params.items.length)
    throw new Error(`${name.name}: preview defaults must match arguments`);
  const size = metadata[2] ?? [320, 240];
  if (
    !Array.isArray(size) ||
    size.length !== 2 ||
    !size.every((n) => Number.isInteger(n) && n >= 1 && n <= 4096)
  )
    throw new Error(`${name.name}: canvas dimensions must be integers from 1 to 4096`);
  return {
    name: name.name,
    kind: form[0].name === 'defdraw' ? 'draw' : 'sound',
    title: metadata[0] ?? name.name,
    params: params.items.map((p) => p.name),
    defaults,
    size,
    bodyOffset: annotated ? 4 : 3,
  };
}
export function sourceHooks(forms) {
  const hooks = forms.map(hookDefinition).filter(Boolean);
  if (hooks.length > 64) throw new Error('Maximum 64 preview hooks per file');
  return hooks;
}

/** Locate top-level hook headers even in an unfinished draft. Ignore comments,
 * quoted strings (including multiline ones), and nested/local declarations. */
export function sourceHookLines(source) {
  const hooks = [];
  let depth = 0,
    row = 0,
    quoted = false,
    escaped = false,
    comment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') {
      row++;
      comment = false;
    }
    if (comment) continue;
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === ';') {
      comment = true;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === '(' || ch === '[') {
      if (depth === 0 && ch === '(') {
        const header = source
          .slice(i)
          .match(
            /^\((?:\s|;[^\n]*(?:\n|$))*(defdraw|defsound)(?:\s|;[^\n]*(?:\n|$))+([^\s()[\]";]+)/,
          );
        if (header && hooks.length < 64)
          hooks.push({ row, name: header[2], kind: header[1] === 'defdraw' ? 'draw' : 'sound' });
      }
      depth++;
    } else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
  }
  return hooks;
}
