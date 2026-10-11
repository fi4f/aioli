import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Arithmetic } from "../arithmetic.js";
import { Trace } from "../trace.js";

const run = (source, bindings = {}) => Compiler.run(Compiler.compile(source, bindings, Forms));

test('conditional branches independently accept single statements or brace blocks', () => {
  for (const trace of [true, false]) {
    for (let mask = 0; mask < 16; mask++) {
      for (let match = 0; match < 4; match++) {
        const output = [], checks = [];
        const branch = n => mask & (1 << n) ? `{ (record ${n}) (record "after") }` : `(record ${n})`;
        Compiler.run(Compiler.compile(`(if (check 0) ${branch(0)} elif (check 1) ${branch(1)}
          elif (check 2) ${branch(2)} else ${branch(3)})`, {
          check: n => { checks.push(n); return n === match; }, record: n => output.push(n),
        }, Forms, { trace }));
        assert.deepEqual(checks, Array.from({ length: Math.min(match + 1, 3) }, (_, n) => n));
        assert.deepEqual(output, mask & (1 << match) ? [match, 'after'] : [match]);
      }
    }
    const evaluate = source => Compiler.run(Compiler.compile(source, {}, Forms, { trace }));
    assert.equal(evaluate('(let x 0) (if true (let x 1) else (let x 2)) x'), 0);
    assert.equal(evaluate('((fn () (if false (return 1) elif true (return 2) else (return 3))))'), 2);
    assert.equal(evaluate('(if false 1 elif false 2)'), null);
    assert.throws(() => evaluate('(if true (let x 1)) x'), SyntaxError);
  }
});

test('if permits an omitted else in statement and expression positions', () => {
  for (const trace of [true, false]) {
    const output = [];
    const bindings = { print: value => output.push(value) };
    const evaluate = source => Compiler.run(Compiler.compile(source, bindings, Forms, { trace }));
    evaluate('(if false { (print "skip") }) (if true { (print "yes") })');
    assert.deepEqual(output, ['yes']);
    assert.equal(evaluate('((fn () (return (if false 42))))'), null);
    assert.equal(evaluate('((fn () (return (if true 42))))'), 42);
    assert.equal(evaluate('((fn () (return (if false 42 7))))'), 7);
  }
});

test('bare elif and optional else evaluate conditions once and short circuit', () => {
  for (const trace of [true, false]) {
    for (const match of [0, 1, 2, 3]) {
      for (const fallback of ['', 'else { (record "fallback") }']) {
        const events = [];
        Compiler.run(Compiler.compile(`(if (check 0) { (record 0) }
          elif (check 1) { (record 1) }
          elif (check 2) { (record 2) } ${fallback})`, {
          check: n => { events.push(`check ${n}`); return n === match; },
          record: n => events.push(n),
        }, Forms, { trace }));
        const expected = Array.from({ length: Math.min(match + 1, 3) }, (_, n) => `check ${n}`);
        if (match < 3) expected.push(match);
        else if (fallback) expected.push('fallback');
        assert.deepEqual(events, expected);
      }
    }
  }
});

test('conditional blocks scope declarations and preserve early returns and outer mutations', () => {
  for (const trace of [true, false]) {
    const evaluate = source => Compiler.run(Compiler.compile(source, {}, Forms, { trace }));
    assert.equal(evaluate(`(let x 1)
      (if false { (let x 2) } elif true { (set x 3) } else { (set x 4) }) x`), 3);
    assert.equal(evaluate(`((fn ()
      (if false { (return 1) } elif true { (let x 2) (return x) } else { (return 3) })
      (return 4)))`), 2);
    assert.equal(evaluate(`(let x 1)
      (if true { (let x 2) } else { (let x 3) }) x`), 1);
    assert.equal(evaluate(`(let x 0)
      (if true { (if false {} elif true { (set x 5) }) }) x`), 5);
    assert.throws(() => evaluate('(if true { (let x 1) } else {}) x'), SyntaxError);
    assert.throws(() => evaluate('(if true { (let x x) } else {})'), ReferenceError);
  }
});

test('malformed conditional chains fail compilation with source traces', () => {
  const sources = [
    '(if)', '(if true)', '(if true {} elif)', '(if true {} elif true)',
    '(if true {} elif true else {})', '(if true {} else)', '(if true {} else elif true {})',
    '(if true {} else {} elif true {})', '(if true {} else {} else {})',
    '(if true 1 elif false)', '(if true {} unknown false {})',
    '(if true {} elif else {})', '(print (if true {} else {}))',
  ];
  for (const trace of [true, false]) {
    for (const source of sources) {
      assert.throws(() => Compiler.compile(source, { print() {} }, Forms, { trace }),
        error => error instanceof SyntaxError && Boolean(error.lisp), source);
    }
  }
});

test('fast compilation emits direct calls without trace machinery', () => {
  const program = Compiler.compile('(let x 2) (let twice (fn (n) (return (* n 2)))) (twice x)', Arithmetic.bindings, Forms, { trace: false });
  assert.equal(Compiler.run(program), 4);
  assert.doesNotMatch(program.javascript, /\$trace|\.at\(|\.call\(|=>/);
  assert.match(program.javascript, /function\(/);
  assert.match(program.javascript, /let \$local\d+ = 2;/);
});

test('trace and fast modes preserve results, side effects, and strict arithmetic', () => {
  const source = '(let x 1) (let step (fn (n) (set x (+ x n)) (return x))) {(let x 99) (print x)} (print $"total {(step 2)}") (step 3)';
  for (const trace of [true, false]) {
    const output = [];
    const program = Compiler.compile(source, { ...Arithmetic.bindings, print: value => output.push(value) }, Forms, { trace });
    assert.equal(Compiler.run(program), 6);
    assert.deepEqual(output, [99, 'total 3']);
    assert.equal(Compiler.run(program), 6);
    assert.throws(() => Compiler.run(Compiler.compile('(+ 1 "2")', Arithmetic.bindings, Forms, { trace })), TypeError);
    assert.throws(() => Compiler.run(Compiler.compile('(let x x)', {}, Forms, { trace })), ReferenceError);
    assert.throws(() => Compiler.run(Compiler.compile('(let name "Shawn") (name)', {}, Forms, { trace })), TypeError);
    assert.throws(() => Compiler.compile('missing', {}, Forms, { trace }), error => error instanceof SyntaxError && Boolean(error.lisp));
  }
});

test('invalid calls inside templates report Lisp names and exact spans', () => {
  const source = '(let name "Shawn")\n(print $"Hello {(name)}")';
  assert.throws(() => run(source, { print() {} }), error => {
    const message = Trace.formatTrace(error);
    assert.match(message, /Cannot call \(name\).*string "Shawn"/);
    assert.match(message, /source:2:17/);
    assert.equal(source.slice(error.lisp.start, error.lisp.end), '(name)');
    assert.doesNotMatch(message, /\$local|\$binding/);
    return true;
  });
});

test('nested function errors preserve their cause and show Lisp call sites', () => {
  const source = '(let fail (fn () (return (+ 1 "2"))))\n(fail)';
  assert.throws(() => run(source, Arithmetic.bindings), error => {
    assert.ok(error instanceof TypeError);
    assert.match(Trace.formatTrace(error), /operand 2: expected num/);
    assert.equal(source.slice(error.lisp.start, error.lisp.end), '(+ 1 "2")');
    assert.match(Trace.formatTrace(error), /Called from source:2:1/);
    return true;
  });
  assert.throws(() => run('(broken)', { broken() { throw new Error('original failure'); } }),
    error => error.message === 'original failure' && Boolean(error.lisp));
});

test('compile errors and TDZ errors report source instead of generated names', () => {
  for (const source of ['(print missing)', '(let x 1) (let x 2)', '(fn (x x))', '(print']) {
    assert.throws(() => Compiler.compile(source, { print() {} }, Forms), error => {
      assert.ok(error.lisp);
      assert.match(Trace.formatTrace(error), /source:1:/);
      return true;
    });
  }
  assert.throws(() => run('(let x x)'), error => {
    assert.ok(error instanceof ReferenceError);
    assert.doesNotMatch(Trace.formatTrace(error), /\$local/);
    assert.match(Trace.formatTrace(error), /x/);
    return true;
  });
});

test('trace instrumentation evaluates callee and arguments once in order', () => {
  const events = [];
  assert.equal(run('((get-call) (next) (next))', {
    'get-call': () => { events.push('callee'); return (a, b) => a + b; },
    next: () => { events.push('arg'); return events.length; },
  }), 5);
  assert.deepEqual(events, ['callee', 'arg', 'arg']);
});

test('templates interpolate Lisp expressions in order', () => {
  assert.equal(run('(let name "Shawn") $"Hello, {name}!"'), 'Hello, Shawn!');
  assert.equal(run('$"Total: {(+ 2 3)}"', Arithmetic.bindings), 'Total: 5');
  assert.throws(() => run('$"{true} {NaN} {Infinity}"'), SyntaxError);
  const calls = [];
  assert.equal(run('$"{next}{(tick)}{(tick)}"', {
    next: 'go', tick: () => { calls.push(1); return calls.length; },
  }), 'go12');
  assert.deepEqual(calls, [1, 1]);
  assert.equal(run('$"{(if true "yes" "no")}"'), 'yes');
  assert.equal(run('$"{$"nested {(+ 1 2)}"}"', Arithmetic.bindings), 'nested 3');
});

test('template escapes are literal and malformed interpolation is rejected', () => {
  assert.equal(run('$"{{name}}"'), '{name}');
  assert.equal(run('$"` ${x}"', { x: 3 }), '` $3');
  assert.equal(run('$"plain"'), 'plain');
  assert.equal(run('$""'), '');
  assert.equal(run('$"line\\nnext"'), 'line\nnext');
  assert.equal(run('"{name}"'), '{name}');
  for (const source of ['$"{}"', '$"{1 2}"', '$"{1"', '$"}"', '$"unterminated', '$"{missing}"', '$"{(let x 1)}"']) {
    assert.throws(() => Compiler.compile(source, {}, Forms), SyntaxError);
  }
});

test('numeric literals preserve negative zero and reject non-finite values', () => {
  for (const [source, expected] of [
    ['-0', -0],
  ]) {
    assert.ok(Object.is(Compiler.read(source)[0].value, expected));
    assert.ok(Object.is(run(source), expected));
  }
  assert.throws(() => run('(+ NaN 1)', Arithmetic.bindings), SyntaxError);
  assert.throws(() => run('(* -Infinity -1)', Arithmetic.bindings), SyntaxError);
  assert.throws(() => run('(- Infinity Infinity)', Arithmetic.bindings), SyntaxError);
  assert.equal(run('"Infinity"'), 'Infinity');
  assert.throws(() => run('Infinity', { Infinity: 42 }), SyntaxError);
  assert.throws(() => run('NaN', { NaN: 42 }), SyntaxError);
  assert.throws(() => run('(let Infinity 1)'), SyntaxError);
  assert.throws(() => run('1e999'), SyntaxError);
});

test('strict arithmetic supports composition, variables, and first-class operators', () => {
  assert.equal(run('(+ 1 (* 2 3))', Arithmetic.bindings), 7);
  assert.equal(run('(let x 10) (set x (- x 3)) (/ x 2)', Arithmetic.bindings), 3.5);
  assert.equal(run('(let add +) (add 2 3 4)', Arithmetic.bindings), 9);
  assert.equal(run('(- 5)', Arithmetic.bindings), -5);
  assert.equal(run('(/ 4)', Arithmetic.bindings), 0.25);
  assert.equal(run('(- 10 2 3)', Arithmetic.bindings), 5);
  assert.equal(run('(/ 24 2 3)', Arithmetic.bindings), 4);
});

test('arithmetic identities, remainder, and floating point behavior', () => {
  assert.equal(run('(+)', Arithmetic.bindings), 0);
  assert.equal(run('(*)', Arithmetic.bindings), 1);
  assert.equal(run('(% -7 3)', Arithmetic.bindings), -1);
  assert.throws(() => run('(/ 1 0)', Arithmetic.bindings), TypeError);
  assert.throws(() => run('(/ 0 0)', Arithmetic.bindings), TypeError);
});

test('arithmetic rejects coercion and invalid arity', () => {
  for (const operator of Object.keys(Arithmetic.bindings)) {
    for (const value of ['1', true, null, undefined, 1n, {}, { valueOf: () => 1 }]) {
      assert.throws(() => Arithmetic.bindings[operator](2, value), TypeError);
    }
  }
  for (const source of ['(+ 1 "2")', '(* true 2)', '(-)', '(/)', '(%)', '(% 1)', '(% 1 2 3)']) {
    assert.throws(() => run(source, Arithmetic.bindings), TypeError);
  }
});

test('functions are callable values with implicit and explicit returns', () => {
  assert.equal(run('(let identity (fn (value) (return value))) (identity 42)'), 42);
  assert.equal(run('((fn (value) (return value)) 7)'), 7);
  assert.equal(run('((fn ()))'), null);
  assert.equal(run('((fn () 42))'), 42);
  assert.equal(run('((fn () (return)))'), null);
  assert.equal(run('((fn (x) (set x 7) (return x)) 1)'), 7);
});

test('closures capture and mutate the correct lexical binding', () => {
  const factory = run('(let factory (fn (value) (return (fn (next) (set value next) (return value))))) factory');
  const first = factory(1), second = factory(2);
  assert.equal(first(3), 3);
  assert.equal(second(4), 4);
  assert.equal(run('(let x 1) (let read-x (fn () (return x))) { (let x 2) (set x 3) } (set x 4) (read-x)'), 4);
});

test('recursive functions and early returns in nested blocks', () => {
  const output = [];
  assert.equal(run(`
    (let countdown (fn (n)
      (if (zero n) { (return "done") } {})
      (print n)
      (return (countdown (dec n)))
    ))
    (countdown 3)
  `, { zero: n => n === 0, dec: n => n - 1, print: n => output.push(n) }), 'done');
  assert.deepEqual(output, [3, 2, 1]);
});

test('parameter scopes preserve JS declaration and initialization rules', () => {
  assert.equal(run('((fn (x) { (let x 2) } (return x)) 1)'), 1);
  assert.throws(() => run('((fn (x) (let x 2)) 1)'), SyntaxError);
  assert.throws(() => run('((fn () (return x) (let x 1)))'), ReferenceError);
  assert.throws(() => run('(let f (fn (x))) x'), SyntaxError);
  assert.throws(() => run('((fn () { (let x 1) } (return x)))'), SyntaxError);
});

test('invalid function syntax and misplaced returns fail compilation', () => {
  for (const source of [
    '(fn)', '(fn 1)', '(fn (1))', '(fn (x x))',
    '(fn (if))', '(return 1)', '(fn () (print (return 1)))',
    '(fn () (return 1 2))',
  ]) assert.throws(() => Compiler.compile(source, { print() {} }, Forms), SyntaxError);
});
