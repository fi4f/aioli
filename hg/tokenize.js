import { Data } from './data.js';
import { Bindings } from './bindings.js';
import { Text } from './text.js';
import { Forms } from './forms.js';

const __keywords__ = new Set([...Object.keys(Forms), 'elif', 'else', 'then', 'catch', 'finally']);
const __builtins__ = new Set([
  ...Object.keys(Bindings),
  ...Text.textOperations,
  'sample',
  'import',
  'set-scene',
]);
const __types__ =
  /^(?:num|f32|i32|u32|str|bool|nil|function|promise|error|list|dict|struct|array|many|texture2d|vec[234](?:[fiu])?|mat[234](?:x[234]f)?)$/;

const __stringEscapes__ = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

// Modern JS string escapes. Return errors as data so editor scanning stays tolerant.
function __scanEscape__(source, start) {
  let i = start + 1;
  const result = (value = '', error = null) => ({ end: i, value, error });
  if (i >= source.length) return result('', 'Unterminated string escape');
  const character = source[i++];
  if (Object.hasOwn(__stringEscapes__, character)) return result(__stringEscapes__[character]);
  if (character === '\r') {
    if (source[i] === '\n') i++;
    return result();
  }
  if (character === '\n' || character === '\u2028' || character === '\u2029') return result();
  if (character === '0' && !/^[0-9]$/.test(source[i])) return result('\0');
  if (/^[0-9]$/.test(character))
    return result('', 'Legacy numeric string escapes are not supported');
  if (character !== 'x' && character !== 'u') return result(character);

  const braced = character === 'u' && source[i] === '{';
  if (braced) i++;
  const digitsStart = i;
  const count = character === 'x' ? 2 : 4;
  while (i < source.length && /^[\da-fA-F]$/.test(source[i]) && (braced || i - digitsStart < count))
    i++;
  const digits = source.slice(digitsStart, i);
  if (braced) {
    if (source[i] !== '}') return result('', 'Invalid Unicode string escape');
    i++;
    const codePoint = Number.parseInt(digits, 16);
    if (!digits.length || codePoint > 0x10ffff) return result('', 'Invalid Unicode string escape');
    return result(String.fromCodePoint(codePoint));
  }
  if (digits.length !== count) return result('', 'Invalid hexadecimal or Unicode string escape');
  return result(String.fromCharCode(Number.parseInt(digits, 16)));
}

function __decodeString__(source) {
  let value = '';
  for (let i = 0; i < source.length;) {
    const character = source[i];
    if (character === '\\') {
      const escape = __scanEscape__(source, i);
      if (escape.error) throw new SyntaxError(escape.error);
      value += escape.value;
      i = escape.end;
    } else {
      if (character === '"' || character === '\n' || character === '\r')
        throw new SyntaxError('Unescaped quote or newline in string');
      value += character;
      i++;
    }
  }
  return value;
}

// Shared lexical boundary scanner. It records incomplete syntax instead of throwing;
// read() applies strict parser checks, while editor tools retain partial tokens.
function __scanToken__(source, start) {
  let i = start;
  const c = source[i];
  const result = (kind, extra = {}) => ({
    kind,
    start,
    end: i,
    text: source.slice(start, i),
    ...extra,
  });
  if (/\s/u.test(c)) {
    while (i < source.length && /\s/u.test(source[i])) i++;
    return result('whitespace');
  }
  if (c === ';') {
    while (i < source.length && source[i] !== '\n') i++;
    return result('comment');
  }
  if (c === '"' || (c === '$' && source[i + 1] === '"')) {
    const template = c === '$';
    i += template ? 2 : 1;
    let depth = 0,
      closed = false;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        i = __scanEscape__(source, i).end;
        continue;
      }
      if (depth > 0) {
        if (ch === '"' || (ch === '$' && source[i + 1] === '"') || ch === ';') {
          i = __scanToken__(source, i).end;
          continue;
        }
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        i++;
        continue;
      }
      if (ch === '"') {
        i++;
        closed = true;
        break;
      }
      if (template && ch === '{') {
        if (source[i + 1] === '{') {
          i += 2;
          continue;
        }
        depth = 1;
      }
      i++;
    }
    return result(template ? 'template' : 'string', { closed });
  }
  const number = source
    .slice(i)
    .match(
      /^(?:0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|[+-]?(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?::[iuf])?(?=$|[\s(){};":.])/,
    );
  if (number) {
    i += number[0].length;
    return result('number');
  }
  if ('(){}:.,'.includes(c)) {
    i += c === '.' && source[i + 1] === '.' ? 2 : 1;
    return result('punctuation');
  }
  if (c === '<' || c === '>') {
    i += source[i + 1] === '=' ? 2 : 1;
    return result('operator');
  }
  // Angle-delimited type annotations belong to one symbol, including inner spaces.
  let depth = 0,
    malformed = false;
  i++;
  while (i < source.length) {
    if (source[i] === '<') depth++;
    else if (source[i] === '>') depth--;
    if (depth < 0) {
      malformed = true;
      break;
    }
    if (depth === 0 && /[\s(){};":.]/u.test(source[i])) break;
    if (depth > 0 && /[(){};":]/u.test(source[i])) {
      malformed = true;
      break;
    }
    i++;
  }
  return result('word', { angleDepth: depth, malformed });
}

// Tolerant lexical spans for tools. Unlike read(), this never requires a complete AST.
// Newlines delimit output rows; all other characters retain exact source offsets.
function __classify__(token, head, annotation) {
  if (token.kind === 'whitespace' || token.kind === 'comment')
    return [token.kind === 'whitespace' ? 'plain' : 'comment', head, annotation];
  if (token.kind !== 'word')
    return [
      token.kind === 'template' ? 'string' : token.kind,
      token.text === '(',
      token.text === ':',
    ];
  const word = token.text.replace(/\s/gu, '');
  let kind = 'plain';
  if (/^(?:true|false|nil)$/.test(word)) kind = 'literal';
  else if (/^(?:NaN|[+-]?Infinity)$/.test(word)) kind = 'number';
  else if (annotation || __types__.test(word) || /^(?:array|many)</.test(word)) kind = 'type';
  else if (__keywords__.has(word)) kind = 'keyword';
  else if (/^(?:[+*/%=\-]|and|or|not)$/.test(word)) kind = 'operator';
  else if (head) kind = __builtins__.has(word) ? 'builtin' : 'function';
  return [kind, false, false];
}
function __matchingLength__(maximum, matches) {
  let low = 0,
    high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (matches(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}
function __project__(tokens, starts, source) {
  // Text/category records are immutable; only private source offsets are shifted
  // during later edits. Capture those offsets compactly for this snapshot.
  const records = tokens;
  const rows = [0];
  for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1))
    rows.push(at + 1);
  return Data.lazyList(rows.length, (row) => {
    const from = rows[row],
      end = row + 1 < rows.length ? rows[row + 1] - 1 : source.length;
    let low = 0,
      high = starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= from) low = middle + 1;
      else high = middle;
    }
    const spans = [];
    for (let i = Math.max(0, low - 1); i < records.length && starts[i] < end; i++) {
      const token = records[i],
        start = Math.max(from, starts[i]),
        finish = Math.min(end, starts[i] + token.text.length);
      if (finish > start)
        spans.push([token.color, token.text, start - starts[i], finish - starts[i], start, finish]);
    }
    return Data.lazyList(spans.length, (index) => {
      const [kind, text, from, to, start, end] = spans[index];
      const values = {
        kind,
        text: text.slice(from, to),
        start,
        end,
      };
      return values;
    });
  });
}
// A runtime owns one incremental lexer cache. Published spans remain fresh,
// mutable language snapshots; edits never mutate an earlier result.
function __createTokenizer__() {
  return { __previous__: '', __cached__: [], __positions__: new Uint32Array(), __hint__: null };
}
function __tokenizeWith__(lexer, source) {
  if (typeof source !== 'string') throw new TypeError('tokenize expects source text');
  if (source === lexer.__previous__)
    return __project__(lexer.__cached__, lexer.__positions__, source);
  const shared = Math.min(lexer.__previous__.length, source.length);
  const known =
    lexer.__hint__ &&
    lexer.__hint__.previous === lexer.__previous__ &&
    lexer.__hint__.source === source;
  const prefix = known
    ? lexer.__hint__.start
    : __matchingLength__(shared, (length) =>
        source.startsWith(lexer.__previous__.slice(0, length)),
      );
  const suffix = known
    ? lexer.__previous__.length - lexer.__hint__.end
    : __matchingLength__(shared - prefix, (length) =>
        source.endsWith(lexer.__previous__.slice(lexer.__previous__.length - length)),
      );
  lexer.__hint__ = undefined;
  let low = 0,
    high = lexer.__cached__.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lexer.__positions__[middle] + lexer.__cached__[middle].text.length < prefix)
      low = middle + 1;
    else high = middle;
  }
  const restart = Math.min(low, Math.max(0, lexer.__cached__.length - 1));
  let result = lexer.__cached__.slice(0, restart);
  const newPositions = Array.from(lexer.__positions__.subarray(0, restart));
  let i = 0,
    head = false,
    annotation = false;
  if (lexer.__cached__[restart]) {
    i = lexer.__positions__[restart];
    head = lexer.__cached__[restart].head;
    annotation = lexer.__cached__[restart].annotation;
  }
  const delta = source.length - lexer.__previous__.length;
  low = restart;
  high = lexer.__cached__.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lexer.__positions__[middle] < lexer.__previous__.length - suffix) low = middle + 1;
    else high = middle;
  }
  let tail = low;
  while (i < source.length) {
    while (tail < lexer.__cached__.length && lexer.__positions__[tail] + delta < i) tail++;
    if (
      i >= source.length - suffix &&
      tail < lexer.__cached__.length &&
      lexer.__positions__[tail] + delta === i &&
      lexer.__cached__[tail].head === head &&
      lexer.__cached__[tail].annotation === annotation
    ) {
      result = result.concat(lexer.__cached__.slice(tail));
      for (let j = tail; j < lexer.__cached__.length; j++) {
        newPositions.push(lexer.__positions__[j] + delta);
      }
      break;
    }
    const token = __scanToken__(source, i);
    const [color, nextHead, nextAnnotation] = __classify__(token, head, annotation);
    result.push({ ...token, color, head, annotation });
    newPositions.push(token.start);
    i = token.end;
    head = nextHead;
    annotation = nextAnnotation;
  }
  lexer.__previous__ = source;
  lexer.__cached__ = result;
  lexer.__positions__ = Uint32Array.from(newPositions);
  return __project__(result, lexer.__positions__, source);
}
const __tokenize__ = (source) => __tokenizeWith__(__createTokenizer__(), source);
function __noteEdit__(lexer, edit) {
  lexer.__hint__ = edit;
}

export const Tokenizer = {
  scanToken: __scanToken__,
  scanEscape: __scanEscape__,
  decodeString: __decodeString__,
  new: __createTokenizer__,
  tokenize: __tokenize__,
  tokenizeWith: __tokenizeWith__,
  noteEdit: __noteEdit__,
};
