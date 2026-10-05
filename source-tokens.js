/**
 * Tokenize source for display, not evaluation.
 *
 * The Lisp reader correctly rejects unfinished strings, but an editor must show
 * them while they are being typed. This scanner consumes every character exactly
 * once, including a lone quote or trailing escape. Never use the strict parser
 * as a prerequisite for painting a source buffer.
 *
 * @returns {{text: string, kind: string}[]} Lossless, ordered display tokens.
 */
export function tokenizeSourceLine(line) {
  const tokens = [];
  let position = 0;

  while (position < line.length) {
    const start = position;
    const character = line[position];
    let kind = 'symbol';

    if (character === ';') {
      kind = 'comment';
      position = line.length;
    } else if (character === '"') {
      kind = 'string';
      position++;
      while (position < line.length) {
        const next = line[position++];
        if (next === '\\') {
          // Keep both the escape and its character, if one has been typed yet.
          if (position < line.length) position++;
        } else if (next === '"') {
          break;
        }
      }
    } else if ('()[]'.includes(character)) {
      kind = 'delimiter';
      position++;
    } else if (/\s/.test(character)) {
      kind = 'whitespace';
      while (position < line.length && /\s/.test(line[position])) position++;
    } else {
      while (position < line.length && !/[\s()[\]";]/.test(line[position])) position++;
      const text = line.slice(start, position);
      if (text.startsWith(':')) kind = 'keyword';
      else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) kind = 'number';
    }

    tokens.push({ text: line.slice(start, position), kind });
  }

  return tokens;
}
