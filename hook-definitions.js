import { functionInfo } from './metadata.js';
import { policy } from './editor-policy.js';
export function hookDefinition(form) {
  const info = functionInfo(form);
  return info && ['draw', 'sound'].includes(info.kind)
    ? policy('editor-preview-info', [info])
    : null;
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
