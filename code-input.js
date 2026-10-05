import { GLYPH_WIDTH } from './drawing.js';
import { tokenizeSourceLine } from './source-tokens.js';

const LINE_HEIGHT = 21;
const GUTTER_WIDTH = 40;
// Lisp's repeat form is bounded to 64; buffer data observes the same bound.
const MAX_VISIBLE_ROWS = 64;
const MAX_SEGMENTS_PER_ROW = 64;

/**
 * Native text input and source layout data. This class never paints the editor.
 * ui.lisp owns glyph colors, line numbers, selections, and caret drawing.
 * Each buffer retains its own selection and scroll position when tabs switch.
 */
export class CodeInput {
  constructor(input, sources, onEdit) {
    this.input = input;
    this.sources = sources;
    this.onEdit = onEdit;
    this.sessions = new Map();
    this.tab = null;
    this.focus = 'world';
    this.box = null;
    this.drag = false;
    this.history = new Map();
    this.restoring = false;

    input.addEventListener('input', () => {
      const session = this.session();
      if (!session) return;
      const history = this.historyForTab();
      if (!this.restoring && session.text !== input.value) {
        history.undo.push({ text: session.text, start: session.start, end: session.end });
        if (history.undo.length > 100) history.undo.shift();
        history.redo = [];
      }
      session.text = input.value;
      session.start = input.selectionStart;
      session.end = input.selectionEnd;
      session.follow = true;
      this.sources[this.tab] = input.value;
      onEdit(this.tab, input.value);
    });
    input.addEventListener('select', () => {
      if (!this.tab) return;
      const session = this.session();
      session.start = input.selectionStart;
      session.end = input.selectionEnd;
    });
    input.addEventListener('keyup', () => {
      if (this.tab) this.session().follow = true;
    });
    input.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        this.edit(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (event.key === 'Tab' && !input.readOnly) {
        event.preventDefault();
        input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input'));
      }
    });
  }

  session() {
    return this.sessions.get(this.tab);
  }
  historyForTab() {
    if (!this.history.has(this.tab)) this.history.set(this.tab, { undo: [], redo: [] });
    return this.history.get(this.tab);
  }
  canEdit(action) {
    if (!this.session()) return false;
    if (action === 'select-all') return true;
    if (action === 'copy') return this.session().end > this.session().start;
    if (this.input.readOnly) return false;
    if (action === 'cut') return this.canEdit('copy');
    if (action === 'undo' || action === 'redo') return this.historyForTab()[action].length > 0;
    return action === 'paste';
  }
  /** Edit the active buffer's native input, preserving selection after menu focus.
   * Undo/redo belong to a buffer, rather than the browser's one textarea history.
   */
  async edit(action) {
    if (!this.canEdit(action)) return;
    const input = this.input,
      session = this.session();
    const tab = this.tab;
    this.focus = 'code';
    input.focus({ preventScroll: true });
    input.setSelectionRange(session.start, session.end);
    if (action === 'select-all') {
      input.select();
      session.start = 0;
      session.end = input.value.length;
      return;
    }
    if (action === 'copy' || action === 'cut') {
      await navigator.clipboard.writeText(input.value.slice(session.start, session.end));
      if (this.tab !== tab || this.session() !== session)
        throw new Error('Buffer changed during clipboard access');
      if (action === 'copy') return;
      input.setRangeText('', session.start, session.end, 'end');
    } else if (action === 'paste') {
      const text = await navigator.clipboard.readText();
      if (this.tab !== tab || this.session() !== session)
        throw new Error('Buffer changed during clipboard access');
      input.setRangeText(text, session.start, session.end, 'end');
    } else {
      const history = this.historyForTab(),
        next = history[action].pop();
      history[action === 'undo' ? 'redo' : 'undo'].push({
        text: session.text,
        start: session.start,
        end: session.end,
      });
      input.value = next.text;
      input.setSelectionRange(next.start, next.end);
      this.restoring = true;
    }
    try {
      input.dispatchEvent(new Event('input'));
    } finally {
      this.restoring = false;
    }
  }

  switch(tab, text, readOnly = false) {
    if (this.tab === tab && this.session()?.text === text) return;
    let session = this.sessions.get(tab);
    if (!session || session.text !== text) {
      if (session) this.history.delete(tab);
      session = { text, start: 0, end: 0, scroll: 0, col: 0, follow: false };
      this.sessions.set(tab, session);
    }
    this.tab = tab;
    this.input.value = text;
    this.input.readOnly = readOnly;
    this.input.setSelectionRange(session.start, session.end);
    this.input.setAttribute('aria-label', `${tab}.lisp source`);
  }

  /** Convert a canvas click/drag to a native textarea selection offset. */
  pointer(x, y, drag = false) {
    if (!this.box) return;
    const bounds = this.box;
    const session = this.session();
    const lines = session.text.split('\n');
    const row = Math.min(
      lines.length - 1,
      Math.max(0, Math.floor((y - bounds.y) / LINE_HEIGHT) + session.scroll),
    );
    const column = Math.min(
      lines[row].length,
      Math.max(0, Math.round((x - bounds.x - GUTTER_WIDTH) / GLYPH_WIDTH) + session.col),
    );
    const index =
      lines.slice(0, row).reduce((offset, line) => offset + line.length + 1, 0) + column;
    if (!drag) this.anchor = index;
    session.start = Math.min(this.anchor, index);
    session.end = Math.max(this.anchor, index);
    this.input.setSelectionRange(session.start, session.end);
    this.focus = 'code';
    this.input.focus({ preventScroll: true });
    this.drag = true;
  }

  wheel(delta, horizontal) {
    const session = this.session();
    if (!session) return;
    if (horizontal) session.col = Math.max(0, session.col + Math.sign(delta) * 4);
    else session.scroll = Math.max(0, session.scroll + Math.sign(delta) * 3);
  }

  /**
   * Return vectors consumed by code-editor in ui.lisp:
   * rows: [[numberPosition, numberText, [[tokenPosition, tokenText, kind], ...]], ...]
   * selections: [[origin, size], ...]; caret: [x,y] or null.
   * Source must remain paintable even when the strict Lisp reader rejects it.
   */
  layout(origin, size, tab, text, readOnly, now) {
    this.switch(tab, text, readOnly);
    const session = this.session();
    const [x, y] = origin;
    const [width, height] = size;
    this.box = { x, y, w: width, h: height };

    const lines = text.split('\n');
    const visibleRows = Math.max(1, Math.floor(height / LINE_HEIGHT));
    const visibleColumns = Math.max(1, Math.floor((width - GUTTER_WIDTH) / GLYPH_WIDTH));
    if (this.focus === 'code') {
      session.start = this.input.selectionStart;
      session.end = this.input.selectionEnd;
    }
    const caret = this.input.selectionDirection === 'backward' ? session.start : session.end;
    const beforeCaret = text.slice(0, caret).split('\n');
    const caretRow = beforeCaret.length - 1;
    const caretColumn = beforeCaret.at(-1).length;

    // Follow keyboard navigation/typing, but let an explicit wheel scroll stand.
    if (session.follow) {
      if (caretRow < session.scroll) session.scroll = caretRow;
      else if (caretRow >= session.scroll + visibleRows)
        session.scroll = caretRow - visibleRows + 1;
      if (caretColumn < session.col) session.col = caretColumn;
      else if (caretColumn >= session.col + visibleColumns)
        session.col = caretColumn - visibleColumns + 1;
      session.follow = false;
    }
    session.scroll = Math.min(session.scroll, Math.max(0, lines.length - visibleRows));

    const result = { rows: [], selections: [], caret: null };
    let lineOffset = lines
      .slice(0, session.scroll)
      .reduce((offset, line) => offset + line.length + 1, 0);
    const endRow = Math.min(
      lines.length,
      session.scroll + Math.min(visibleRows + 1, MAX_VISIBLE_ROWS),
    );

    for (let row = session.scroll; row < endRow; row++) {
      const top = y + (row - session.scroll) * LINE_HEIGHT;
      const line = lines[row];
      const textX = x + GUTTER_WIDTH;

      if (
        this.focus === 'code' &&
        session.start !== session.end &&
        session.end > lineOffset &&
        session.start <= lineOffset + line.length
      ) {
        const start = Math.max(0, session.start - lineOffset);
        const end = Math.min(line.length + 1, session.end - lineOffset);
        result.selections.push([
          [textX + (start - session.col) * GLYPH_WIDTH, top],
          [Math.max(2, (end - start) * GLYPH_WIDTH), LINE_HEIGHT],
        ]);
      }

      const segments = [];
      let column = 0;
      for (const token of tokenizeSourceLine(line)) {
        const start = Math.max(session.col, column);
        const end = Math.min(session.col + visibleColumns, column + token.text.length);
        if (end > start) {
          segments.push([
            [textX + (start - session.col) * GLYPH_WIDTH, top],
            token.text.slice(start - column, end - column),
            token.kind,
          ]);
        }
        // Count every character, including unfinished quotes and escapes.
        column += token.text.length;
      }
      result.rows.push([
        [x, top],
        String(row + 1).padStart(3, ' '),
        segments.slice(0, MAX_SEGMENTS_PER_ROW),
      ]);
      lineOffset += line.length + 1;
    }

    if (this.focus === 'code' && session.start === session.end && Math.floor(now / 550) % 2 === 0) {
      result.caret = [
        x + GUTTER_WIDTH + (caretColumn - session.col) * GLYPH_WIDTH,
        y + (caretRow - session.scroll) * LINE_HEIGHT,
      ];
    }
    return result;
  }
}
