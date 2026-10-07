import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, scanToken } from '../engine/compiler/tokenize.js';
import { read } from '../engine/compiler/compiler.js';

const rows = source => tokenize(source).values.map(row => row.values.map(span => span.values));
test('tokenization preserves every source character and UTF-16 offset, including incomplete edits', () => {
  for (const source of ['', '(let x 1)\n', '; comment\n\n', '(text "unfinished\nnext', 'f"{unfinished', 'f"hello {(str "Ada")}"', '(let café "👋")', '(vec2 1.2 -3e-2).xy', '(for i 0..10', '(fn (x:many<vec2,10>)', '>= <=']) {
    const lines = rows(source);
    assert.equal(lines.map(line => line.map(span => span.text).join('')).join('\n'), source);
    for (const line of lines) for (const span of line) assert.equal(source.slice(span.start, span.end), span.text);
  }
  assert.throws(() => tokenize(null), /expects source text/);
});

test('strict reader and tolerant tools share string, numeric, and generic-type boundaries', () => {
  assert.equal(scanToken('"a\\\"b" trailing', 0).text, '"a\\\"b"');
  assert.equal(read('"a\\\"b"')[0].value, 'a"b');
  assert.equal(scanToken('2.5e-3 rest', 0).text, '2.5e-3');
  assert.equal(read('2.5e-3')[0].value, 0.0025);
  const template = 'f"hello {(str "Ada")}"';
  assert.equal(scanToken(template, 0).end, template.length);
  assert.equal(read(template)[0].kind, 'template');
  assert.equal(scanToken('many<vec2, 10>', 0).text, 'many<vec2, 10>');
  assert.equal(read('many<vec2, 10>')[0].name, 'many<vec2,10>');
  assert.equal(scanToken('many<vec2', 0).angleDepth, 1);
  assert.throws(() => read('many<vec2'), /Missing closing angle bracket/);
});
test('tokenization distinguishes comments, escaped strings, forms, calls, literals, and types', () => {
  const spans = rows('(let value:vec2 (vec2 0.5 1)) ; label\n(text (span "a;\\\"b")) (my-tool true nil)').flat();
  const kind = text => spans.find(span => span.text === text)?.kind;
  assert.equal(kind('let'), 'keyword');
  assert.equal(kind('vec2'), 'type');
  assert.equal(kind('0.5'), 'number');
  assert.equal(kind('; label'), 'comment');
  assert.equal(kind('span'), 'builtin');
  assert.equal(kind('"a;\\\"b"'), 'string');
  assert.equal(kind('my-tool'), 'function');
  assert.equal(kind('true'), 'literal');
  assert.equal(kind('nil'), 'literal');
});
