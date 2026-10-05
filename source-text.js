/** Match the browser textarea's newline convention at every source boundary. */
export function normalizeSource(text) {
  return text.replace(/\r\n?/g, '\n');
}

/** Painting uses ASCII cells, but clipboard/editing retain the original Unicode.
 * The renderer emits one fallback glyph per code point and four cells per tab.
 */
export function displaySource(text) {
  let display = '';
  for (const character of text) {
    const code = character.codePointAt(0);
    display += character === '\t' ? '    ' : code >= 32 && code <= 126 ? character : '?';
  }
  return display;
}

/** Convert between native UTF-16 offsets and painted columns. Boundaries avoid
 * splitting surrogate pairs, and a click within a tab chooses its nearest edge.
 */
export function sourceLine(text) {
  const offsets = [0],
    columns = [0];
  let offset = 0,
    column = 0;
  for (const character of text) {
    offset += character.length;
    column += character === '\t' ? 4 : 1;
    offsets.push(offset);
    columns.push(column);
  }
  function boundary(values, value) {
    let low = 0,
      high = values.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (values[middle] <= value) low = middle;
      else high = middle - 1;
    }
    return low;
  }
  return {
    width: column,
    columnAtOffset(value) {
      return columns[boundary(offsets, value)];
    },
    offsetAtColumn(value) {
      const index = boundary(columns, value);
      const next = Math.min(index + 1, columns.length - 1);
      return offsets[value - columns[index] < columns[next] - value ? index : next];
    },
  };
}
