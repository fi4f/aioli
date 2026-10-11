import { Data } from './data.js';

// Native editing only. The full mirror stays document-relative; large documents
// use a bounded native context so browser layout does not scale with file size.
function __createTextProxy__(
  canvas,
  callback,
  { toOuter = (x, y) => ({ x, y }), onEdit = () => {} } = {},
) {
  const service = { canvas, callback, toOuter, onEdit };
  if (typeof service.callback !== 'function')
    throw new TypeError('text-proxy expects an edit callback');
  service.document = service.canvas.ownerDocument;
  service.target = service.document.createElement('textarea');
  service.target.dataset.hgTextProxy = '';
  service.target.setAttribute('aria-label', 'Canvas editor text input');
  service.target.style.cssText =
    'position:fixed;opacity:0;width:1px;height:1px;padding:0;border:0;pointer-events:none;resize:none;overflow:hidden;contain:strict;';
  service.target.spellcheck = false;
  service.target.wrap = 'off';
  service.document.body.append(service.target);
  service.windowSize = 8192;
  service.threshold = 65536;
  service.disposed = false;
  service.composing = false;
  service.content = '';
  service.anchor = 0;
  service.head = 0;
  service.windowStart = 0;
  service.windowEnd = 0;
  service.nativeShadow = undefined;
  service.nativeEdit = undefined;
  service.preferredColumn = undefined;
  service.customHistory = false;
  service.undo = [];
  service.redo = [];
  service.segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  service.segmentedContent = undefined;
  service.segments = undefined;
  service.indexedContent = undefined;
  service.offsets = undefined;
  service.lastContent = undefined;
  service.lastAnchor = undefined;
  service.lastHead = undefined;
  service.lastComposing = undefined;
  service.pointerdown = (event) => __pointerdown__(service, event);
  service.canvas.addEventListener('pointerdown', service.pointerdown);
  service.listeners = {
    beforeinput: (...args) => __beforeinput__(service, ...args),
    input: (...args) => __input__(service, ...args),
    select: (...args) => __selection__(service, ...args),
    keyup: (...args) => __selection__(service, ...args),
    compositionstart: (...args) => __start__(service, ...args),
    compositionend: (...args) => __end__(service, ...args),
    keydown: (...args) => __keydown__(service, ...args),
    copy: (...args) => __copy__(service, ...args),
    cut: (...args) => __cut__(service, ...args),
  };
  for (const [name, handler] of Object.entries(service.listeners))
    service.target.addEventListener(name, handler);
  return Data.registerHostData(service);
}

function __check__(service) {
  if (service.disposed) throw new Error('Text proxy has been disposed');
}

function __boundary__(service, index) {
  index = Math.max(0, Math.min(service.content.length, index));
  if (index === service.content.length) return index;
  if (service.segmentedContent !== service.content) {
    service.segmentedContent = service.content;
    service.segments = service.segmenter.segment(service.content);
  }
  return service.segments.containing(index)?.index ?? 0;
}

function __indexLines__(service) {
  if (service.indexedContent !== service.content) {
    service.indexedContent = service.content;
    const starts = [0];
    for (
      let at = service.content.indexOf('\n');
      at !== -1;
      at = service.content.indexOf('\n', at + 1)
    )
      starts.push(at + 1);
    service.offsets = Uint32Array.from(starts);
  }
  return service.offsets;
}

function __rowOf__(service, position) {
  const starts = __indexLines__(service);
  let low = 0,
    high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= position) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function __readSelection__(service) {
  const start = service.target.selectionStart,
    end = service.target.selectionEnd,
    direction = service.target.selectionDirection;
  if (
    !service.nativeShadow ||
    start !== service.nativeShadow.start ||
    end !== service.nativeShadow.end ||
    direction !== service.nativeShadow.direction
  ) {
    service.anchor = service.windowStart + (direction === 'backward' ? end : start);
    service.head = service.windowStart + (direction === 'backward' ? start : end);
    service.nativeShadow = { start, end, direction };
  }
}

function __mirror__(service, force = false) {
  if (service.composing && !force) return;
  const large = service.content.length > service.threshold;
  service.customHistory ||= large;
  const fits =
    Math.min(service.anchor, service.head) >= service.windowStart &&
    Math.max(service.anchor, service.head) <= service.windowEnd;
  const nearEdge =
    (service.head - service.windowStart < 128 && service.windowStart > 0) ||
    (service.windowEnd - service.head < 128 && service.windowEnd < service.content.length);
  if (
    force ||
    !fits ||
    nearEdge ||
    (!large && (service.windowStart !== 0 || service.windowEnd !== service.content.length)) ||
    (large && service.windowEnd - service.windowStart > service.windowSize * 2)
  ) {
    service.windowStart = large
      ? Math.max(
          0,
          Math.min(
            service.head - service.windowSize / 2,
            service.content.length - service.windowSize,
          ),
        )
      : 0;
    if (large && Math.abs(service.head - service.anchor) < service.windowSize / 2)
      service.windowStart = Math.max(
        0,
        Math.min(
          Math.min(service.anchor, service.head) - service.windowSize / 4,
          service.content.length - service.windowSize,
        ),
      );
    service.windowEnd = large
      ? Math.min(service.content.length, service.windowStart + service.windowSize)
      : service.content.length;
    service.target.value = service.content.slice(service.windowStart, service.windowEnd);
  }
  const start = Math.max(
    0,
    Math.min(
      service.target.value.length,
      Math.min(service.anchor, service.head) - service.windowStart,
    ),
  );
  const end = Math.max(
    0,
    Math.min(
      service.target.value.length,
      Math.max(service.anchor, service.head) - service.windowStart,
    ),
  );
  const direction = service.head < service.anchor ? 'backward' : 'forward';
  service.nativeShadow = { start, end, direction };
  if (
    service.target.selectionStart !== start ||
    service.target.selectionEnd !== end ||
    service.target.selectionDirection !== direction
  )
    service.target.setSelectionRange(start, end, direction);
}

function __snapshot__(service) {
  __check__(service);
  __readSelection__(service);
  const source = service.content,
    a = service.anchor,
    h = service.head,
    starts = __indexLines__(service);
  const rows = Data.lazyList(starts.length, (index) => {
    const start = starts[index],
      end = index + 1 < starts.length ? starts[index + 1] - 1 : source.length;
    const text = source.slice(start, end);
    return Data.dict(
      'text',
      text,
      'start',
      start,
      'end',
      end,
      'caret',
      h >= start && h <= end ? h - start : -1,
      'selection-start',
      Math.max(0, Math.min(text.length, Math.min(a, h) - start)),
      'selection-end',
      Math.max(0, Math.min(text.length, Math.max(a, h) - start)),
    );
  });
  return Data.dict(
    'content',
    source,
    'anchor',
    a,
    'head',
    h,
    'lines',
    rows,
    'composing',
    service.composing,
  );
}

function __notify__(service) {
  __readSelection__(service);
  if (
    service.content === service.lastContent &&
    service.anchor === service.lastAnchor &&
    service.head === service.lastHead &&
    service.composing === service.lastComposing
  )
    return;
  service.lastContent = service.content;
  service.lastAnchor = service.anchor;
  service.lastHead = service.head;
  service.lastComposing = service.composing;
  service.callback(__snapshot__(service));
}

function __state__(service) {
  return { content: service.content, anchor: service.anchor, head: service.head };
}

function __remember__(service, previous) {
  if (!service.customHistory) return;
  service.undo.push(previous);
  if (service.undo.length > 64) service.undo.shift();
  service.redo.length = 0;
}

function __restore__(service, from, to) {
  if (!from.length) return;
  __readSelection__(service);
  to.push(__state__(service));
  const previous = service.content,
    saved = from.pop();
  service.content = saved.content;
  service.anchor = saved.anchor;
  service.head = saved.head;
  service.onEdit({ previous, source: service.content, start: 0, end: previous.length });
  __mirror__(service, true);
  __notify__(service);
}

function __beforeinput__(service, event) {
  __readSelection__(service);
  if (
    service.customHistory &&
    (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') &&
    event.cancelable
  ) {
    event.preventDefault();
    __restore__(
      service,
      event.inputType === 'historyUndo' ? service.undo : service.redo,
      event.inputType === 'historyUndo' ? service.redo : service.undo,
    );
    return;
  }
  service.nativeEdit = {
    ...__state__(service),
    nativeStart: service.target.selectionStart,
    nativeEnd: service.target.selectionEnd,
  };
}

function __input__(service) {
  const previous = service.nativeEdit || __state__(service),
    oldWindow = service.content.slice(service.windowStart, service.windowEnd),
    next = service.target.value;
  let prefix = 0,
    suffix = 0;
  while (prefix < Math.min(oldWindow.length, next.length) && oldWindow[prefix] === next[prefix])
    prefix++;
  while (
    suffix < Math.min(oldWindow.length, next.length) - prefix &&
    oldWindow[oldWindow.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  let start = service.windowStart + prefix,
    end = service.windowStart + oldWindow.length - suffix;
  let replacement = next.slice(prefix, next.length - suffix);
  const clippedSelection =
    service.nativeEdit &&
    (Math.min(previous.anchor, previous.head) < service.windowStart ||
      Math.max(previous.anchor, previous.head) > service.windowEnd);
  if (clippedSelection) {
    start = Math.min(previous.anchor, previous.head);
    end = Math.max(previous.anchor, previous.head);
    replacement = next.slice(
      previous.nativeStart,
      next.length - (oldWindow.length - previous.nativeEnd),
    );
    service.windowStart = Math.min(service.windowStart, start);
  }
  if (oldWindow !== next || clippedSelection) {
    service.customHistory ||=
      service.content.length - (end - start) + replacement.length > service.threshold;
    __remember__(service, previous);
    const source = service.content;
    service.content = service.content.slice(0, start) + replacement + service.content.slice(end);
    service.onEdit({ previous: source, source: service.content, start, end });
  }
  service.windowEnd = service.windowStart + next.length;
  service.nativeShadow = undefined;
  __readSelection__(service);
  service.nativeEdit = undefined;
  service.preferredColumn = undefined;
  __mirror__(service);
  __notify__(service);
}

function __selection__(service) {
  if (service.document.activeElement === service.target) {
    __readSelection__(service);
    __mirror__(service);
    __notify__(service);
  }
}

function __start__(service) {
  service.composing = true;
  __notify__(service);
}

function __end__(service) {
  service.composing = false;
  __readSelection__(service);
  __mirror__(service);
  __notify__(service);
}

function __setSelection__(service, next, extend) {
  if (!extend) service.anchor = next;
  service.head = next;
  __mirror__(service);
  __notify__(service);
}

function __keydown__(service, event) {
  if (service.composing) return;
  __readSelection__(service);
  if (service.customHistory && (event.ctrlKey || event.metaKey) && !event.altKey) {
    if (event.key.toLowerCase() === 'a') {
      event.preventDefault();
      service.anchor = 0;
      service.head = service.content.length;
      __mirror__(service, true);
      __notify__(service);
      return;
    }
    if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
      event.preventDefault();
      const forward = event.shiftKey || event.key.toLowerCase() === 'y';
      __restore__(
        service,
        forward ? service.redo : service.undo,
        forward ? service.undo : service.redo,
      );
      return;
    }
  }
  if (service.customHistory && (event.key === 'Home' || event.key === 'End')) {
    event.preventDefault();
    const row = __rowOf__(service, service.head),
      starts = __indexLines__(service);
    const next =
      event.ctrlKey || event.metaKey
        ? event.key === 'Home'
          ? 0
          : service.content.length
        : event.key === 'Home'
          ? starts[row]
          : row + 1 < starts.length
            ? starts[row + 1] - 1
            : service.content.length;
    service.preferredColumn = undefined;
    __setSelection__(service, next, event.shiftKey);
    return;
  }
  if (
    service.customHistory &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    ['ArrowUp', 'ArrowDown'].includes(event.key)
  ) {
    event.preventDefault();
    const row = __rowOf__(service, service.head),
      starts = __indexLines__(service);
    service.preferredColumn ??= service.head - starts[row];
    const next = Math.max(0, Math.min(starts.length - 1, row + (event.key === 'ArrowUp' ? -1 : 1)));
    const finish = next + 1 < starts.length ? starts[next + 1] - 1 : service.content.length;
    __setSelection__(
      service,
      __boundary__(service, Math.min(finish, starts[next] + service.preferredColumn)),
      event.shiftKey,
    );
    return;
  }
  if (
    service.customHistory &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    ['ArrowLeft', 'ArrowRight'].includes(event.key)
  ) {
    event.preventDefault();
    service.preferredColumn = undefined;
    let next;
    if (!event.shiftKey && service.anchor !== service.head)
      next =
        event.key === 'ArrowLeft'
          ? Math.min(service.anchor, service.head)
          : Math.max(service.anchor, service.head);
    else if (event.key === 'ArrowLeft') next = __boundary__(service, service.head - 1);
    else if (service.head >= service.content.length) next = service.content.length;
    else {
      __boundary__(service, service.head);
      const segment = service.segments.containing(service.head);
      next = segment ? segment.index + segment.segment.length : service.content.length;
    }
    __setSelection__(service, next, event.shiftKey);
    return;
  }
  service.preferredColumn = undefined;
  if (event.key === 'Tab') {
    event.preventDefault();
    __beforeinput__(service, {});
    service.target.setRangeText(
      '  ',
      service.target.selectionStart,
      service.target.selectionEnd,
      'end',
    );
    __input__(service);
  } else __mirror__(service);
}

function __copy__(service, event) {
  if (!service.customHistory || !event.clipboardData) return;
  __readSelection__(service);
  event.preventDefault();
  event.clipboardData.setData(
    'text/plain',
    service.content.slice(
      Math.min(service.anchor, service.head),
      Math.max(service.anchor, service.head),
    ),
  );
}

function __cut__(service, event) {
  if (!service.customHistory || !event.clipboardData) return;
  __copy__(service, event);
  if (service.anchor === service.head) return;
  const previous = __state__(service),
    start = Math.min(service.anchor, service.head),
    end = Math.max(service.anchor, service.head);
  __remember__(service, previous);
  service.content = service.content.slice(0, start) + service.content.slice(end);
  service.anchor = service.head = start;
  service.onEdit({ previous: previous.content, source: service.content, start, end });
  __mirror__(service, true);
  __notify__(service);
}

function __pointerdown__(service, event) {
  return event.preventDefault();
}

function __sync__(service, source, a = 0, h = a) {
  __check__(service);
  if (
    typeof source !== 'string' ||
    ![a, h].every((n) => Number.isInteger(n) && n >= 0 && n <= source.length)
  )
    throw new TypeError('sync expects source and valid selection offsets');
  service.content = source.replace(/\r\n?/g, '\n');
  service.anchor = __boundary__(service, a);
  service.head = __boundary__(service, h);
  service.customHistory = service.content.length > service.threshold;
  service.undo.length = service.redo.length = 0;
  __mirror__(service, true);
}

function __focus__(service) {
  __check__(service);
  service.target.focus({ preventScroll: true });
}

function __select__(service, row, column, extend = false) {
  __check__(service);
  __readSelection__(service);
  if (!Number.isInteger(row) || !Number.isInteger(column))
    throw new TypeError('select expects integer row and column');
  const starts = __indexLines__(service),
    index = Math.max(0, Math.min(starts.length - 1, row));
  const finish = index + 1 < starts.length ? starts[index + 1] - 1 : service.content.length;
  service.preferredColumn = undefined;
  __setSelection__(
    service,
    __boundary__(service, starts[index] + Math.max(0, Math.min(finish - starts[index], column))),
    extend,
  );
}

function __caret__(service, position, height) {
  __check__(service);
  const point = service.toOuter(Data.component(position, 0), Data.component(position, 1)),
    rect = service.canvas.getBoundingClientRect();
  const left = `${rect.left + (point.x * rect.width) / service.canvas.width}px`,
    top = `${rect.top + (point.y * rect.height) / service.canvas.height}px`;
  const nextHeight = `${Math.max(1, (height * rect.height) / service.canvas.height)}px`;
  if (service.target.style.left !== left) service.target.style.left = left;
  if (service.target.style.top !== top) service.target.style.top = top;
  if (service.target.style.height !== nextHeight) service.target.style.height = nextHeight;
}

function __dispose__(service) {
  if (service.disposed) return;
  service.disposed = true;
  for (const [name, handler] of Object.entries(service.listeners))
    service.target.removeEventListener(name, handler);
  service.__onDispose__?.();
  service.target.remove();
  service.canvas.removeEventListener('pointerdown', service.pointerdown);
}

export const TextProxy = {
  new: __createTextProxy__,
  sync: __sync__,
  snapshot: __snapshot__,
  focus: __focus__,
  select: __select__,
  caret: __caret__,
  dispose: __dispose__,
};
