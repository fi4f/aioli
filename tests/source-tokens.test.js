import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeSourceLine } from '../source-tokens.js';
import { CodeInput } from '../code-input.js';

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
