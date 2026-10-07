import { dict, list } from '../language/data.js';

// Native editing services only. This element never paints editor UI.
export function createTextProxy(canvas, callback, { toOuter = (x, y) => ({ x, y }) } = {}) {
  if (typeof callback !== 'function') throw new TypeError('text-proxy expects an edit callback');
  const document = canvas.ownerDocument;
  const target = document.createElement('textarea');
  target.dataset.aioliTextProxy = '';
  target.setAttribute('aria-label', 'Canvas editor text input');
  target.style.cssText = 'position:fixed;opacity:0;width:1px;height:1px;padding:0;border:0;pointer-events:none;resize:none;overflow:hidden;';
  target.spellcheck = false;
  document.body.append(target);
  let disposed = false, composing = false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let segmentedContent, segments, indexedContent, indexedLines;
  const boundary = (content, index) => {
    if (index === content.length) return index;
    if (segmentedContent !== content) {
      segmentedContent = content;
      segments = segmenter.segment(content);
    }
    return segments.containing(index)?.index ?? 0;
  };
  const indexLines = content => {
    if (indexedContent !== content) {
      indexedContent = content;
      let offset = 0;
      indexedLines = content.split('\n').map(text => {
        const start = offset, end = start + text.length;
        offset = end + 1;
        return { text, start, end };
      });
    }
    return indexedLines;
  };
  const check = () => { if (disposed) throw new Error('Text proxy has been disposed'); };
  const snapshot = () => {
    check();
    const content = target.value, anchor = target.selectionDirection === 'backward' ? target.selectionEnd : target.selectionStart;
    const head = target.selectionDirection === 'backward' ? target.selectionStart : target.selectionEnd;
    const rows = indexLines(content).map(({ text, start, end }) => {
      return dict('text', text, 'start', start, 'end', end,
        'caret', head >= start && head <= end ? head - start : -1,
        'selection-start', Math.max(0, Math.min(text.length, Math.min(anchor, head) - start)),
        'selection-end', Math.max(0, Math.min(text.length, Math.max(anchor, head) - start)));
    });
    return dict('content', content, 'anchor', anchor, 'head', head, 'lines', list(...rows), 'composing', composing);
  };
  let lastContent, lastStart, lastEnd, lastDirection, lastComposing;
  const notify = () => {
    if (target.value === lastContent && target.selectionStart === lastStart &&
        target.selectionEnd === lastEnd && target.selectionDirection === lastDirection && composing === lastComposing) return;
    lastContent = target.value; lastStart = target.selectionStart; lastEnd = target.selectionEnd;
    lastDirection = target.selectionDirection; lastComposing = composing;
    callback(snapshot());
  };
  const input = () => notify();
  const selection = () => { if (document.activeElement === target) notify(); };
  const start = () => { composing = true; notify(); };
  const end = () => { composing = false; notify(); };
  const keydown = event => {
    if (event.key === 'Tab' && !composing) {
      event.preventDefault();
      target.setRangeText('  ', target.selectionStart, target.selectionEnd, 'end');
      notify();
    }
  };
  // The Lisp pointer callback decides focus; suppress the later canvas default.
  const pointerdown = event => event.preventDefault();
  canvas.addEventListener('pointerdown', pointerdown);
  target.addEventListener('input', input);
  target.addEventListener('select', selection);
  target.addEventListener('keyup', selection);
  target.addEventListener('compositionstart', start);
  target.addEventListener('compositionend', end);
  target.addEventListener('keydown', keydown);
  return dict(
    'sync', (content, anchor = 0, head = anchor) => {
      check();
      if (typeof content !== 'string' || ![anchor, head].every(n => Number.isInteger(n) && n >= 0 && n <= content.length)) throw new TypeError('sync expects source and valid selection offsets');
      target.value = content.replace(/\r\n?/g, '\n');
      anchor = boundary(target.value, Math.min(anchor, target.value.length));
      head = boundary(target.value, Math.min(head, target.value.length));
      target.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), head < anchor ? 'backward' : 'forward');
    },
    'snapshot', snapshot,
    'focus', () => { check(); target.focus({ preventScroll: true }); },
    'select', (row, column, extend = false) => {
      check();
      const rows = indexLines(target.value);
      if (!Number.isInteger(row) || !Number.isInteger(column)) throw new TypeError('select expects integer row and column');
      const line = rows[Math.max(0, Math.min(rows.length - 1, row))];
      const head = boundary(target.value, line.start + Math.max(0, Math.min(line.text.length, column)));
      const anchor = extend ? (target.selectionDirection === 'backward' ? target.selectionEnd : target.selectionStart) : head;
      target.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), head < anchor ? 'backward' : 'forward');
      notify();
    },
    'caret', (position, height) => {
      check();
      const point = toOuter(position.values[0], position.values[1]);
      const rect = canvas.getBoundingClientRect();
      const left = `${rect.left + point.x * rect.width / canvas.width}px`;
      const top = `${rect.top + point.y * rect.height / canvas.height}px`;
      const nextHeight = `${Math.max(1, height * rect.height / canvas.height)}px`;
      if (target.style.left !== left) target.style.left = left;
      if (target.style.top !== top) target.style.top = top;
      if (target.style.height !== nextHeight) target.style.height = nextHeight;
    },
    'dispose', () => {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('input', input); target.removeEventListener('select', selection);
      target.removeEventListener('keyup', selection); target.removeEventListener('compositionstart', start);
      target.removeEventListener('compositionend', end); target.removeEventListener('keydown', keydown); target.remove();
      canvas.removeEventListener('pointerdown', pointerdown);
    });
}
