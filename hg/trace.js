import { Errors } from './errors.js';
import { Contracts } from './contracts.js';

function __locate__(error, source, start, end = start + 1) {
  if (Errors.isError(error)) error = Errors.toNative(error);
  if (!(error instanceof Error)) error = new Error(`Thrown value: ${String(error)}`);
  if (!error.lisp) error.lisp = { source, start, end, calls: [] };
  return error;
}

function __formatTrace__(error) {
  if (!error.lisp) return `${error.name || 'Error'}: ${error.message || String(error)}`;
  const { source, sourceURL, start, end, calls } = error.lisp;
  const excerpt = (offset, finish, sourceText = source, url = sourceURL) => {
    const source = sourceText;
    offset = Math.min(offset, source.length);
    const line = source.slice(0, offset).split('\n').length;
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    const lineEnd = source.indexOf('\n', offset);
    const text = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).replace(/\r$/, '');
    const column = offset - lineStart + 1;
    const prefix = `${line} | `;
    const width = Math.max(1, Math.min(finish - offset, text.length - column + 1));
    return `${url ?? 'source'}:${line}:${column}\n${prefix}${text}\n${' '.repeat(prefix.length)}${' '.repeat(column - 1)}${'^'.repeat(width)}`;
  };
  return (
    `${error.name}: ${error.message}\n${excerpt(start, end)}` +
    calls
      .map(
        (call) =>
          `\nCalled from ${excerpt(call.start, call.end, call.source ?? source, call.source !== undefined ? (call.sourceURL ?? 'source') : sourceURL)}`,
      )
      .join('')
  );
}

function __runtimeTrace__(source, names, sourceURL) {
  const service = { source, names, sourceURL };
  return service;
}

function __annotate__(service, error, start, end) {
  error = __locate__(error, service.source, start, end);
  if (error.lisp.source === service.source && !error.lisp.sourceURL)
    error.lisp.sourceURL = service.sourceURL;
  if (error instanceof ReferenceError) {
    error.message = error.message.replace(
      /\$(?:local|binding)\d+/g,
      (name) => service.names.get(name) || name,
    );
  }
  return error;
}

async function __asyncAt__(service, start, end, evaluate) {
  try {
    return await evaluate();
  } catch (error) {
    error = __annotate__(service, error, start, end);
    if (error.lisp.source !== service.source || error.lisp.sourceURL !== service.sourceURL) {
      const last = error.lisp.calls.at(-1);
      if (
        error.lisp.calls.length < 12 &&
        !(
          last?.source === service.source &&
          last?.sourceURL === service.sourceURL &&
          last?.start === start &&
          last?.end === end
        )
      ) {
        error.lisp.calls.push({ start, end, source: service.source, sourceURL: service.sourceURL });
      }
    }
    throw error;
  }
}

function __at__(service, start, end, evaluate) {
  try {
    return evaluate();
  } catch (error) {
    throw __annotate__(service, error, start, end);
  }
}

function __call__(service, start, end, fn, args, origin = service.sourceURL) {
  if (typeof fn !== 'function') {
    const type = fn === null ? 'nil' : typeof fn;
    const value = type === 'string' ? ` ${JSON.stringify(fn)}` : '';
    throw __annotate__(
      service,
      new TypeError(
        `Cannot call ${service.source.slice(start, end)}: expected a function, received ${type}${value}`,
      ),
      start,
      end,
    );
  }
  try {
    return Contracts.call(fn, args, origin);
  } catch (error) {
    const alreadyLocated = error instanceof Error && error.lisp;
    error = __annotate__(service, error, start, end);
    if (alreadyLocated && error.lisp.calls.length < 12)
      error.lisp.calls.push({ start, end, source: service.source, sourceURL: service.sourceURL });
    throw error;
  }
}

export const Trace = {
  new: __runtimeTrace__,
  asyncAt: __asyncAt__,
  at: __at__,
  call: __call__,
  locate: __locate__,
  formatTrace: __formatTrace__,
};
