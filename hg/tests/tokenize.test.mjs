import { Data } from '../data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tokenizer } from '../tokenize.js';
import { Compiler } from '../compiler.js';

const rows = (source) =>
  Data.values(Tokenizer.tokenize(source)).map((row) =>
    Data.values(row).map((span) => Data.values(span)),
  );
test('unread token rows preserve their original source after later edits', () => {
  const incremental = Tokenizer.new();
  const source = '(let x 1)\n; original\n(text "before")';
  const unread = Tokenizer.tokenizeWith(incremental, source);
  Tokenizer.tokenizeWith(incremental, '(let longer 2)\n; revised\n(text "after")');
  assert.equal(Data.serializeData(unread), Data.serializeData(Tokenizer.tokenize(source)));
});
test('tokenization preserves every source character and UTF-16 offset, including incomplete edits', () => {
  for (const source of [
    '',
    '(let x 1)\n',
    '; comment\n\n',
    '(text "unfinished\nnext',
    '$"{unfinished',
    '$"hello {(str "Ada")}"',
    '(let café "👋")',
    '(vec2 1.2 -3e-2).xy',
    '(for i 0..10',
    '(fn (x:many<vec2,10>)',
    '>= <=',
  ]) {
    const lines = rows(source);
    assert.equal(lines.map((line) => line.map((span) => span.text).join('')).join('\n'), source);
    for (const line of lines)
      for (const span of line) assert.equal(source.slice(span.start, span.end), span.text);
  }
  assert.throws(() => Tokenizer.tokenize(null), /expects source text/);
});

test('strict reader and tolerant tools share string, numeric, and generic-type boundaries', () => {
  assert.equal(Tokenizer.scanToken('"a\\\"b" trailing', 0).text, '"a\\\"b"');
  assert.equal(Compiler.read('"a\\\"b"')[0].value, 'a"b');
  assert.equal(Tokenizer.scanToken('2.5e-3:f rest', 0).text, '2.5e-3:f');
  assert.equal(Compiler.read('2.5e-3:f')[0].value, Math.fround(0.0025));
  const template = '$"hello {(str "Ada")}"';
  assert.equal(Tokenizer.scanToken(template, 0).end, template.length);
  assert.equal(Compiler.read(template)[0].kind, 'template');
  assert.equal(Tokenizer.scanToken('many<vec2, 10>', 0).text, 'many<vec2, 10>');
  assert.equal(Compiler.read('many<vec2, 10>')[0].name, 'many<vec2,10>');
  assert.equal(Tokenizer.scanToken('many<vec2', 0).angleDepth, 1);
  assert.throws(() => Compiler.read('many<vec2'), /Missing closing angle bracket/);
});

test('incremental tokenization matches fresh lexing through edits and preserves prior snapshots', () => {
  const incremental = Tokenizer.new();
  let source = '(let value:vec2 (vec2 1 2))\n; comment\n$"value {(str value)}"\n';
  const first = Tokenizer.tokenizeWith(incremental, source);
  const saved = Data.serializeData(first);
  const compare = () =>
    assert.equal(
      Data.serializeData(Tokenizer.tokenizeWith(incremental, source)),
      Data.serializeData(Tokenizer.tokenize(source)),
    );
  compare();
  const fragments = ['x', '\n', '"', ';', '{', '}', '<', '>', ' ', 'true', '0..5', '\\', '👋'];
  let seed = 12345;
  for (let i = 0; i < 200; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const position = seed % (source.length + 1);
    if (i % 3 === 0 && source.length)
      source = source.slice(0, position) + source.slice(position + 1);
    else
      source = source.slice(0, position) + fragments[i % fragments.length] + source.slice(position);
    compare();
  }
  assert.equal(Data.serializeData(first), saved);
  Data.values(Data.values(Data.values(first)[0])[0]).text = 'changed by caller';
  compare();
  source = '';
  compare();
  source = '(print "new")';
  compare();
});
test('tokenization distinguishes comments, escaped strings, forms, calls, literals, and types', () => {
  const spans = rows(
    '(let value:vec2 (vec2 0.5 1)) ; label\n(text (span "a;\\\"b")) (my-tool true nil)',
  ).flat();
  const kind = (text) => spans.find((span) => span.text === text)?.kind;
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
