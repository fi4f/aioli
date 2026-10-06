import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceHookLines } from '../hook-definitions.js';
import { tokenizeSourceLine } from '../source-tokens.js';
import { CodeInput } from '../code-input.js';
import { normalizeSource, displaySource, sourceLine } from '../source-text.js';
import { DrawList } from '../drawing.js';
import { readFileSync } from 'node:fs';
import { createRuntime, parse } from '../lisp.js';

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
  assert.equal(segments.map((segment) => segment[1]).join(''), '(fill"hello');
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
  assert.deepEqual(result.rows[0][2], [
    [[40, 0], 'B', 'symbol'],
    [[80, 0], 'C', 'symbol'],
  ]);
  editor.pointer(40, 0);
  assert.equal(input.selectionStart, 3);
  editor.pointer(80, 0);
  assert.equal(input.selectionStart, 5); // End of the tab, before C.
});

test('inline hook rows ignore comments, multiline strings and nested definitions in unfinished drafts', () => {
  const source = `; (defdraw fake [] nil)
(init! :caption "text
(defsound fake [] nil)")
(defn nested [] (defdraw local [] nil))
(defdraw badge [] (fill "#fff"))
( ; header comment
 defsound beep [] (voice :sine 440 440 0.2 0.1))
(defdraw unfinished [] (rect [`;
  assert.deepEqual(sourceHookLines(source), [
    { row: 4, name: 'badge', kind: 'draw' },
    { row: 5, name: 'beep', kind: 'sound' },
    { row: 7, name: 'unfinished', kind: 'draw' },
  ]);
});

test('inline hook rows preserve source offsets, line numbers, selections and caret scrolling', () => {
  const text = '(defdraw badge []\n  (fill "#fff"))\n(defsound beep [] nil)';
  const { editor, input, sources, layout } = sourceEditor(text);
  let result = layout();
  assert.deepEqual(
    result.hooks.map((h) => [h[0][1], h[2]]),
    [
      [0, 'badge'],
      [63, 'beep'],
    ],
  );
  assert.deepEqual(
    result.rows.map((r) => [r[0][1], r[1].trim()]),
    [
      [21, '1'],
      [42, '2'],
      [84, '3'],
    ],
  );
  editor.pointer(48, 43);
  assert.equal(input.selectionStart, text.indexOf('\n') + 2);
  assert.deepEqual(layout().caret, [48, 42]);
  editor.pointer(40, 21);
  editor.pointer(48, 85, true);
  assert.equal(
    input.value.slice(input.selectionStart, input.selectionEnd),
    text.slice(0, text.lastIndexOf('\n') + 2),
  );
  assert.equal(layout().selections.length, 3, 'virtual rows are not selected text');
  input.setSelectionRange(text.length, text.length);
  editor.session().follow = true;
  result = editor.layout([0, 0], [400, 42], 'scene', sources.scene, false, 0);
  assert.ok(result.caret[1] >= 0 && result.caret[1] < 42);
  assert.equal(input.value, text);
  assert.equal(sources.scene, text);
  assert.equal(
    editor.layout([0, 0], [400, 100], '__hookArgs', '(defdraw fake [] nil)', false, 0).hooks.length,
    0,
  );
  assert.equal(editor.layout([0, 0], [400, 100], 'asset', text, true, 0).hooks.length, 0);
});

test('themed source metrics keep painting, pointer offsets and hook rows aligned', () => {
  const text = '(defdraw badge [] nil)\nnext';
  const { editor, input } = sourceEditor(text);
  const result = editor.layout([10, 10], [400, 150], 'scene', text, false, 0, {
    lineHeight: 30,
    gutter: 56,
  });
  assert.deepEqual(
    result.rows.map((row) => row[0][1]),
    [40, 70],
  );
  assert.equal(result.hooks[0][1][1], 29);
  editor.pointer(74, 72);
  assert.equal(input.selectionStart, text.indexOf('\n') + 2);
  const painted = editor.layout([10, 10], [400, 150], 'scene', text, false, 0, {
    lineHeight: 30,
    gutter: 56,
  });
  assert.deepEqual(painted.caret, [74, 70]);
});

test('scrolling large buffers reuses indexes and refreshes them after edits', () => {
  const text = Array.from({ length: 20000 }, (_, row) => `; row ${row}`).join('\n');
  const { editor, input, sources, layout } = sourceEditor(text);
  const session = editor.session();
  const lines = session.lines,
    offsets = session.offsets;
  input.setSelectionRange(text.length, text.length);
  editor.focus = 'code';
  session.follow = true;
  layout();
  assert.deepEqual(layout().caret, [128, 63]);
  for (let i = 0; i < 100; i++) {
    editor.wheel(-1, false);
    layout();
  }
  assert.equal(session.lines, lines);
  assert.equal(session.offsets, offsets);
  assert.ok(session.lineCache.size <= 128);
  const row = session.visual[session.scroll].row;
  editor.pointer(40, 0);
  assert.equal(input.selectionStart, offsets[row]);
  input.value = 'new\n' + input.value;
  input.dispatchEvent(new Event('input'));
  layout();
  assert.notEqual(session.lines, lines);
  assert.equal(session.offsets[1], 4);
  assert.equal(sources.scene, input.value);
});

test('a full viewport of dense source stays within the editor evaluation budget', () => {
  const text = Array(1000).fill('(a [1 2] :x "hi") '.repeat(30)).join('\n');
  const { editor } = sourceEditor(text);
  editor.session().scroll = 500;
  const buffer = editor.layout([0, 0], [1000, 1400], 'scene', text, false, 0);
  assert.equal(buffer.rows.length, 64);
  const draw = new DrawList(1000, 1400);
  const state = Object.fromEntries(
    [
      'line-number',
      'selection',
      'text',
      'syntax-comment',
      'syntax-delimiter',
      'syntax-number',
      'syntax-keyword',
      'syntax-string',
    ].map((key) => [`ui-${key}`, '#ffffff']),
  );
  const runtime = createRuntime(state, {
    budget: 100000,
    beginScope: () => draw.scope(),
    endScope: () => draw.restore(),
    primitives: {
      ...draw.primitives(),
      'buffer-open': () => {},
      'buffer-rows': () => buffer.rows,
      'buffer-hooks': () => [],
      'buffer-selections': () => [],
      'buffer-caret': () => null,
    },
  });
  runtime.load(
    parse(readFileSync(new URL('../editor/ui/code-input.lisp', import.meta.url), 'utf8')),
  );
  assert.doesNotThrow(() => runtime.call('code-editor', [0, 0], [1000, 1400], 'scene'));
  assert.ok(draw.commands.some((command) => command.bounds[1] === 63 * 21));
});
