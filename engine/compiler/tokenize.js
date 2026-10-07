import { dict, list } from '../language/data.js';
import { bindings } from '../language/bindings.js';
import { textOperations } from '../language/text.js';
import { forms } from './forms.js';

const keywords = new Set([...Object.keys(forms), 'elif', 'else', 'then', 'catch', 'finally']);
const builtins = new Set([...Object.keys(bindings), ...textOperations, 'sample', 'import', 'set-scene']);
const types = /^(?:num|f32|i32|u32|str|bool|nil|function|promise|list|dict|struct|array|many|texture2d|vec[234](?:[fiu])?|mat[234](?:x[234]f)?)$/;

// Shared lexical boundary scanner. It records incomplete syntax instead of throwing;
// read() applies strict parser checks, while editor tools retain partial tokens.
export function scanToken(source, start) {
  let i = start;
  const c = source[i];
  const result = (kind, extra = {}) => ({ kind, start, end: i, text: source.slice(start, i), ...extra });
  if (/\s/u.test(c)) {
    while (i < source.length && /\s/u.test(source[i])) i++;
    return result('whitespace');
  }
  if (c === ';') {
    while (i < source.length && source[i] !== '\n') i++;
    return result('comment');
  }
  if (c === '"' || c === 'f' && source[i + 1] === '"') {
    const template = c === 'f';
    i += template ? 2 : 1;
    let depth = 0, closed = false;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') { i = Math.min(source.length, i + 2); continue; }
      if (depth > 0) {
        if (ch === '"' || ch === 'f' && source[i + 1] === '"' || ch === ';') {
          i = scanToken(source, i).end; continue;
        }
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        i++; continue;
      }
      if (ch === '"') { i++; closed = true; break; }
      if (template && ch === '{') {
        if (source[i + 1] === '{') { i += 2; continue; }
        depth = 1;
      }
      i++;
    }
    return result(template ? 'template' : 'string', { closed });
  }
  const number = source.slice(i).match(/^[+-]?(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?=$|[\s(){};":.])/);
  if (number) { i += number[0].length; return result('number'); }
  if ('(){}:.,'.includes(c)) {
    i += c === '.' && source[i + 1] === '.' ? 2 : 1;
    return result('punctuation');
  }
  if (c === '<' || c === '>') { i += source[i + 1] === '=' ? 2 : 1; return result('operator'); }
  // Angle-delimited type annotations belong to one symbol, including inner spaces.
  let depth = 0, malformed = false;
  i++;
  while (i < source.length) {
    if (source[i] === '<') depth++;
    else if (source[i] === '>') depth--;
    if (depth < 0) { malformed = true; break; }
    if (depth === 0 && /[\s(){};":.]/u.test(source[i])) break;
    if (depth > 0 && /[(){};":]/u.test(source[i])) { malformed = true; break; }
    i++;
  }
  return result('word', { angleDepth: depth, malformed });
}

// Tolerant lexical spans for tools. Unlike read(), this never requires a complete AST.
// Newlines delimit output rows; all other characters retain exact source offsets.
export function tokenize(source) {
  if (typeof source !== 'string') throw new TypeError('tokenize expects source text');
  const rows = [[]];
  let i = 0, head = false, annotation = false;
  const append = (kind, start, end) => {
    let from = start;
    for (let j = start; j < end; j++) if (source[j] === '\n') {
      if (j > from) rows.at(-1).push(dict('kind', kind, 'text', source.slice(from, j), 'start', from, 'end', j));
      rows.push([]); from = j + 1;
    }
    if (end > from) rows.at(-1).push(dict('kind', kind, 'text', source.slice(from, end), 'start', from, 'end', end));
  };
  while (i < source.length) {
    const token = scanToken(source, i);
    const start = i;
    i = token.end;
    if (token.kind === 'whitespace' || token.kind === 'comment') {
      append(token.kind === 'whitespace' ? 'plain' : 'comment', start, i); continue;
    }
    if (token.kind !== 'word') {
      append(token.kind === 'template' ? 'string' : token.kind, start, i);
      head = token.text === '('; annotation = token.text === ':'; continue;
    }
    const word = token.text.replace(/\s/gu, '');
    let kind = 'plain';
    if (/^(?:true|false|nil)$/.test(word)) kind = 'literal';
    else if (/^(?:NaN|[+-]?Infinity)$/.test(word)) kind = 'number';
    else if (annotation || types.test(word) || /^(?:array|many)</.test(word)) kind = 'type';
    else if (keywords.has(word)) kind = 'keyword';
    else if (/^(?:[+*/%=\-]|and|or|not)$/.test(word)) kind = 'operator';
    else if (head) kind = builtins.has(word) ? 'builtin' : 'function';
    append(kind, start, i); head = false; annotation = false;
  }
  return list(...rows.map(row => list(...row)));
}
