import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeSourceLine } from '../source-tokens.js';
import { CodeInput } from '../code-input.js';
import { normalizeSource, displaySource, sourceLine } from '../source-text.js';
import { DrawList } from '../drawing.js';

test('display scanning preserves opening quotes and unfinished escapes', () => {
  for (const source of [
    '"',
    '(text [0 0] "hello',
    '"hello\\',
    '"a\\"b',
    '"; not a comment',
    '"hello" next',
    '"one""two"',
  ]) {
    const tokens = tokenizeSourceLine(source);
    assert.equal(tokens.map((token) => token.text).join(''), source);
    assert.ok(tokens.some((token) => token.kind === 'string' && token.text.startsWith('"')));
  }
});
test('strings keep semicolons and escapes, and trailing comments keep their text', () => {
  assert.deepEqual(tokenizeSourceLine('"a; b\\"c" ; comment'), [
    { text: '"a; b\\"c"', kind: 'string' },
    { text: ' ', kind: 'whitespace' },
    { text: '; comment', kind: 'comment' },
  ]);
});
test('display tokens retain delimiter and numeric categories without dropping text', () => {
  const text = '(+ -.5 1e2 :x [3 4])';
  const tokens = tokenizeSourceLine(text);
  assert.equal(tokens.map((token) => token.text).join(''), text);
  assert.deepEqual(
    tokens.filter((t) => t.kind === 'number').map((t) => t.text),
    ['-.5', '1e2', '3', '4'],
  );
});
test('source layout paints an unfinished quote in the correct column', () => {
  const input = {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    setAttribute() {},
  };
  const editor = new CodeInput(input, {}, () => {});
  const result = editor.layout([0, 0], [400, 100], 'scene', '(fill "hello', false, 0);
  const segments = result.rows[0][2];
  assert.equal(segments.map((segment) => segment[1]).join(''), '(fill "hello');
  assert.deepEqual(segments.at(-1), [[88, 0], '"hello', 'string']);
});

function sourceEditor(text) {
  const listeners = new Map();
  const input = {
    _value: '',
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: 'forward',
    get value() {
      return this._value;
    },
    // Model the real textarea's mandatory CR/CRLF normalization.
    set value(value) {
      this._value = normalizeSource(value);
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    setAttribute() {},
    focus() {},
  };
  const sources = { scene: text },
    editor = new CodeInput(input, sources, () => {});
  editor.layout([0, 0], [400, 100], 'scene', text, false, 0);
  return {
    editor,
    input,
    sources,
    layout: () => editor.layout([0, 0], [400, 100], 'scene', sources.scene, false, 0),
  };
}

test('CRLF and lone CR share native input offsets across rows and undo', async () => {
  const { editor, input, sources, layout } = sourceEditor('ab\r\ncd\ref');
  assert.equal(sources.scene, 'ab\ncd\nef');
  assert.equal(input.value, sources.scene);
  editor.pointer(48, 22);
  assert.equal(input.selectionStart, 4); // Between c and d, not after d.
  assert.deepEqual(layout().caret, [48, 21]);
  editor.pointer(40, 0);
  editor.pointer(48, 43, true);
  assert.equal(input.value.slice(input.selectionStart, input.selectionEnd), 'ab\ncd\ne');
  input.value += '!';
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event('input'));
  await editor.edit('undo');
  assert.equal(input.value, 'ab\ncd\nef');
  assert.equal(sources.scene, input.value);
});

test('fallback glyphs and tabs use display columns without losing source characters', () => {
  const text = 'A\u{1f642}B\t\u00e9C';
  assert.equal(displaySource(text), 'A?B    ?C');
  const mapping = sourceLine(text);
  assert.equal(mapping.columnAtOffset(3), 2); // UTF-16 offset after the emoji.
  assert.equal(mapping.offsetAtColumn(2), 3);
  assert.equal(mapping.offsetAtColumn(4), 4); // Click near the tab's left edge.
  assert.equal(mapping.offsetAtColumn(6), 5); // Click near its right edge.
  const { editor, input, layout } = sourceEditor(text);
  editor.pointer(48, 0);
  editor.pointer(64, 0, true);
  assert.equal(input.value.slice(input.selectionStart, input.selectionEnd), '\u{1f642}B');
  assert.deepEqual(layout().selections, [
    [
      [48, 0],
      [16, 21],
    ],
  ]);
  editor.pointer(104, 0);
  assert.equal(input.selectionStart, 6); // After the tab and é, before C.
  assert.deepEqual(layout().caret, [104, 0]);
  const draw = new DrawList(400, 100);
  for (const segment of layout().rows[0][2]) draw.text(segment[0], segment[1]);
  assert.equal(draw.commands.at(-1).bounds[0], 104);
  assert.equal(input.value, text);
});

test('horizontal scrolling and token clipping keep fallback glyph boundaries aligned', () => {
  const { editor, input, layout } = sourceEditor('A\u{1f642}B\tC');
  editor.session().col = 2;
  const result = layout();
  assert.equal(result.rows[0][2].map((segment) => segment[1]).join(''), 'B    C');
  editor.pointer(40, 0);
  assert.equal(input.selectionStart, 3);
  editor.pointer(80, 0);
  assert.equal(input.selectionStart, 5); // End of the tab, before C.
});
