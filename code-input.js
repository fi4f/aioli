import { sourceHookLines } from './hook-definitions.js';
import { sourcePath } from './project.js';
import { GLYPH_WIDTH } from './drawing.js';
import { tokenizeSourceLine } from './source-tokens.js';
import { normalizeSource, displaySource, sourceLine } from './source-text.js';

const LINE_HEIGHT = 21;
const GUTTER_WIDTH = 40;
// Lisp's repeat form is bounded to 64; buffer data observes the same bound.
const MAX_VISIBLE_ROWS = 64;
const MAX_SEGMENTS_PER_ROW = 64;

/**
 * Native text input and source layout data. This class never paints the editor.
 * editor/ui/code-input.lisp owns glyph colors, line numbers, selections and caret drawing.
 * Each buffer retains its own selection and scroll position when tabs switch.
 */
export class CodeInput {
  // Renaming a source preserves the same editing session and undo history.
  renameBuffer(oldKey, newKey) {
    for (const store of [this.sessions, this.history]) {
      if (store.has(oldKey)) {
        store.set(newKey, store.get(oldKey));
        store.delete(oldKey);
      }
    }
    if (this.tab === oldKey) this.tab = newKey;
  }
  forgetBuffer(key) {
    this.sessions.delete(key);
    this.history.delete(key);
  }
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
    // Native textarea offsets must address the same LF text as source layout.
    text = normalizeSource(text);
    if (!readOnly && tab in this.sources) this.sources[tab] = text;
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
    this.input.setAttribute('aria-label', `${sourcePath(tab)} source`);
  }

  /** Convert a canvas click/drag to a native textarea selection offset. */
  pointer(x, y, drag = false) {
    if (!this.box) return;
    const bounds = this.box;
    const session = this.session();
    const lines = session.text.split('\n');
    const visual = Math.max(0, Math.floor((y - bounds.y) / bounds.lineHeight) + session.scroll);
    const row =
      session.visual?.[Math.min(visual, session.visual.length - 1)]?.row ?? lines.length - 1;
    const line = sourceLine(lines[row]);
    const column = Math.min(
      line.width,
      Math.max(0, Math.round((x - bounds.x - bounds.gutter) / GLYPH_WIDTH) + session.col),
    );
    const index =
      lines.slice(0, row).reduce((offset, line) => offset + line.length + 1, 0) +
      line.offsetAtColumn(column);
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
   * Return vectors consumed by code-editor in editor/ui/components.lisp:
   * rows: [[numberPosition, numberText, [[tokenPosition, tokenText, kind], ...]], ...]
   * selections: [[origin, size], ...]; caret: [x,y] or null.
   * Source must remain paintable even when the strict Lisp reader rejects it.
   */
  layout(origin, size, tab, text, readOnly, now, metrics = {}) {
    this.switch(tab, text, readOnly);
    const session = this.session();
    text = session.text;
    const [x, y] = origin;
    const [width, height] = size;
    const lineHeight = Math.max(20, Number(metrics.lineHeight) || LINE_HEIGHT);
    const gutter = Math.max(24, Number(metrics.gutter) || GUTTER_WIDTH);
    this.box = { x, y, w: width, h: height, lineHeight, gutter };

    const lines = text.split('\n');
    const inline = !readOnly && !tab.startsWith('__');
    if (session.visualText !== text || session.inline !== inline) {
      session.visualText = text;
      session.inline = inline;
      const hooks = inline ? sourceHookLines(text) : [];
      session.visual = [];
      session.lineRows = [];
      for (let row = 0; row < lines.length; row++) {
        for (const hook of hooks.filter((hook) => hook.row === row))
          session.visual.push({ row, hook });
        session.lineRows.push(session.visual.length);
        session.visual.push({ row });
      }
    }
    const visual = session.visual;
    const visibleRows = Math.max(1, Math.floor(height / lineHeight));
    const visibleColumns = Math.max(1, Math.floor((width - gutter) / GLYPH_WIDTH));
    if (this.focus === 'code') {
      session.start = this.input.selectionStart;
      session.end = this.input.selectionEnd;
    }
    const caret = this.input.selectionDirection === 'backward' ? session.start : session.end;
    const beforeCaret = text.slice(0, caret).split('\n');
    const caretRow = beforeCaret.length - 1;
    const caretColumn = sourceLine(lines[caretRow]).columnAtOffset(beforeCaret.at(-1).length);

    const caretVisualRow = session.lineRows[caretRow];

    // Follow keyboard navigation/typing, but let an explicit wheel scroll stand.
    if (session.follow) {
      if (caretVisualRow < session.scroll) session.scroll = caretVisualRow;
      else if (caretVisualRow >= session.scroll + visibleRows)
        session.scroll = caretVisualRow - visibleRows + 1;
      if (caretColumn < session.col) session.col = caretColumn;
      else if (caretColumn >= session.col + visibleColumns)
        session.col = caretColumn - visibleColumns + 1;
      session.follow = false;
    }
    session.scroll = Math.min(session.scroll, Math.max(0, visual.length - visibleRows));

    const result = { rows: [], hooks: [], selections: [], caret: null };
    const offsets = [0];
    for (const line of lines) offsets.push(offsets.at(-1) + line.length + 1);
    const endRow = Math.min(
      visual.length,
      session.scroll + Math.min(visibleRows + 1, MAX_VISIBLE_ROWS),
    );
    for (let vrow = session.scroll; vrow < endRow; vrow++) {
      const { row, hook } = visual[vrow];
      const top = y + (vrow - session.scroll) * lineHeight;
      if (hook) {
        result.hooks.push([
          [x + gutter, top],
          [Math.max(1, width - gutter), lineHeight - 1],
          hook.name,
          hook.kind,
        ]);
        continue;
      }
      const lineOffset = offsets[row];
      const line = lines[row];
      const mapping = sourceLine(line);
      const textX = x + gutter;

      if (
        this.focus === 'code' &&
        session.start !== session.end &&
        session.end > lineOffset &&
        session.start <= lineOffset + line.length
      ) {
        const start = mapping.columnAtOffset(Math.max(0, session.start - lineOffset));
        const end =
          session.end > lineOffset + line.length
            ? mapping.width + 1
            : mapping.columnAtOffset(session.end - lineOffset);
        result.selections.push([
          [textX + (start - session.col) * GLYPH_WIDTH, top],
          [Math.max(2, (end - start) * GLYPH_WIDTH), lineHeight],
        ]);
      }

      const segments = [];
      let column = 0;
      for (const token of tokenizeSourceLine(line)) {
        const display = displaySource(token.text);
        const start = Math.max(session.col, column);
        const end = Math.min(session.col + visibleColumns, column + display.length);
        if (end > start) {
          segments.push([
            [textX + (start - session.col) * GLYPH_WIDTH, top],
            display.slice(start - column, end - column),
            token.kind,
          ]);
        }
        // Painting, scrolling and selection all count the same display cells.
        column += display.length;
      }
      result.rows.push([
        [x, top],
        String(row + 1).padStart(3, ' '),
        segments.slice(0, MAX_SEGMENTS_PER_ROW),
      ]);
    }

    if (this.focus === 'code' && session.start === session.end && Math.floor(now / 550) % 2 === 0) {
      result.caret = [
        x + gutter + (caretColumn - session.col) * GLYPH_WIDTH,
        y + (caretVisualRow - session.scroll) * lineHeight,
      ];
    }
    return result;
  }
}
