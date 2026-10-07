export function locate(error, source, start, end = start + 1) {
  if (!(error instanceof Error)) error = new Error(`Thrown value: ${String(error)}`);
  if (!error.lisp) error.lisp = { source, start, end, calls: [] };
  return error;
}

export function formatTrace(error) {
  if (!error.lisp) return `${error.name || 'Error'}: ${error.message || String(error)}`;
  const { source, start, end, calls } = error.lisp;
  const excerpt = (offset, finish) => {
    offset = Math.min(offset, source.length);
    const line = source.slice(0, offset).split('\n').length;
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = source.indexOf('\n', offset);
    const text = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).replace(/\r$/, '');
    const column = offset - lineStart + 1;
    const prefix = `${line} | `;
    const width = Math.max(1, Math.min(finish - offset, text.length - column + 1));
    return `source:${line}:${column}\n${prefix}${text}\n${' '.repeat(prefix.length)}${' '.repeat(column - 1)}${'^'.repeat(width)}`;
  };
  return `${error.name}: ${error.message}\n${excerpt(start, end)}` +
    calls.map(call => `\nCalled from ${excerpt(call.start, call.end)}`).join('');
}

export function runtimeTrace(source, names) {
  const annotate = (error, start, end) => {
    error = locate(error, source, start, end);
    if (error instanceof ReferenceError) {
      error.message = error.message.replace(/\$(?:local|binding)\d+/g, name => names.get(name) || name);
    }
    return error;
  };
  return {
    at(start, end, evaluate) {
      try { return evaluate(); }
      catch (error) { throw annotate(error, start, end); }
    },
    call(start, end, fn, args) {
      if (typeof fn !== 'function') {
        const type = fn === null ? 'nil' : typeof fn;
        const value = type === 'string' ? ` ${JSON.stringify(fn)}` : '';
        throw annotate(new TypeError(`Cannot call ${source.slice(start, end)}: expected a function, received ${type}${value}`), start, end);
      }
      try { return fn(...args); }
      catch (error) {
        const alreadyLocated = error instanceof Error && error.lisp;
        error = annotate(error, start, end);
        if (alreadyLocated && error.lisp.calls.length < 12) error.lisp.calls.push({ start, end });
        throw error;
      }
    },
  };
}
