import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, read } from '../engine/compiler.js';
import { forms } from '../engine/forms.js';
import { arithmetic } from '../engine/arithmetic.js';
import { formatTrace } from '../engine/trace.js';

const run = (source, bindings = {}) => compile(source, bindings, forms).run();

test('conditional branches independently accept single statements or brace blocks', () => {
  for (const trace of [true, false]) {
    for (let mask = 0; mask < 16; mask++) {
      for (let match = 0; match < 4; match++) {
        const output = [], checks = [];
        const branch = n => mask & (1 << n) ? `{ (record ${n}) (record "after") }` : `(record ${n})`;
        compile(`(if (check 0) ${branch(0)} elif (check 1) ${branch(1)}
          elif (check 2) ${branch(2)} else ${branch(3)})`, {
          check: n => { checks.push(n); return n === match; }, record: n => output.push(n),
        }, forms, { trace }).run();
        assert.deepEqual(checks, Array.from({ length: Math.min(match + 1, 3) }, (_, n) => n));
        assert.deepEqual(output, mask & (1 << match) ? [match, 'after'] : [match]);
      }
    }
    const evaluate = source => compile(source, {}, forms, { trace }).run();
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
    const evaluate = source => compile(source, bindings, forms, { trace }).run();
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
        compile(`(if (check 0) { (record 0) }
          elif (check 1) { (record 1) }
          elif (check 2) { (record 2) } ${fallback})`, {
          check: n => { events.push(`check ${n}`); return n === match; },
          record: n => events.push(n),
        }, forms, { trace }).run();
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
    const evaluate = source => compile(source, {}, forms, { trace }).run();
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
      assert.throws(() => compile(source, { print() {} }, forms, { trace }),
        error => error instanceof SyntaxError && Boolean(error.lisp), source);
    }
  }
});

test('fast compilation emits direct calls without trace machinery', () => {
  const program = compile('(let x 2) (let twice (fn (n) (return (* n 2)))) (twice x)', arithmetic, forms, { trace: false });
  assert.equal(program.run(), 4);
  assert.doesNotMatch(program.javascript, /\$trace|\.at\(|\.call\(|=>/);
  assert.match(program.javascript, /function\(/);
  assert.match(program.javascript, /let \$local\d+ = 2;/);
});

test('trace and fast modes preserve results, side effects, and strict arithmetic', () => {
  const source = '(let x 1) (let step (fn (n) (set x (+ x n)) (return x))) {(let x 99) (print x)} (print f"total {(step 2)}") (step 3)';
  for (const trace of [true, false]) {
    const output = [];
    const program = compile(source, { ...arithmetic, print: value => output.push(value) }, forms, { trace });
    assert.equal(program.run(), 6);
    assert.deepEqual(output, [99, 'total 3']);
    assert.equal(program.run(), 6);
    assert.throws(() => compile('(+ 1 "2")', arithmetic, forms, { trace }).run(), TypeError);
    assert.throws(() => compile('(let x x)', {}, forms, { trace }).run(), ReferenceError);
    assert.throws(() => compile('(let name "Shawn") (name)', {}, forms, { trace }).run(), TypeError);
    assert.throws(() => compile('missing', {}, forms, { trace }), error => error instanceof SyntaxError && Boolean(error.lisp));
  }
});

test('invalid calls inside f-strings report Lisp names and exact spans', () => {
  const source = '(let name "Shawn")\n(print f"Hello {(name)}")';
  assert.throws(() => run(source, { print() {} }), error => {
    const message = formatTrace(error);
    assert.match(message, /Cannot call \(name\).*string "Shawn"/);
    assert.match(message, /source:2:17/);
    assert.equal(source.slice(error.lisp.start, error.lisp.end), '(name)');
    assert.doesNotMatch(message, /\$local|\$binding/);
    return true;
  });
});

test('nested function errors preserve their cause and show Lisp call sites', () => {
  const source = '(let fail (fn () (return (+ 1 "2"))))\n(fail)';
  assert.throws(() => run(source, arithmetic), error => {
    assert.ok(error instanceof TypeError);
    assert.match(formatTrace(error), /operand 2: expected num/);
    assert.equal(source.slice(error.lisp.start, error.lisp.end), '(+ 1 "2")');
    assert.match(formatTrace(error), /Called from source:2:1/);
    return true;
  });
  assert.throws(() => run('(broken)', { broken() { throw new Error('original failure'); } }),
    error => error.message === 'original failure' && Boolean(error.lisp));
});

test('compile errors and TDZ errors report source instead of generated names', () => {
  for (const source of ['(print missing)', '(let x 1) (let x 2)', '(fn (x x))', '(print']) {
    assert.throws(() => compile(source, { print() {} }, forms), error => {
      assert.ok(error.lisp);
      assert.match(formatTrace(error), /source:1:/);
      return true;
    });
  }
  assert.throws(() => run('(let x x)'), error => {
    assert.ok(error instanceof ReferenceError);
    assert.doesNotMatch(formatTrace(error), /\$local/);
    assert.match(formatTrace(error), /x/);
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

test('f-strings interpolate Lisp expressions in order', () => {
  assert.equal(run('(let name "Shawn") f"Hello, {name}!"'), 'Hello, Shawn!');
  assert.equal(run('f"Total: {(+ 2 3)}"', arithmetic), 'Total: 5');
  assert.equal(run('f"{true} {NaN} {Infinity}"'), 'true NaN Infinity');
  const calls = [];
  assert.equal(run('f"{next}{(tick)}{(tick)}"', {
    next: 'go', tick: () => { calls.push(1); return calls.length; },
  }), 'go12');
  assert.deepEqual(calls, [1, 1]);
  assert.equal(run('f"{(if true "yes" "no")}"'), 'yes');
  assert.equal(run('f"{f"nested {(+ 1 2)}"}"', arithmetic), 'nested 3');
});

test('f-string escapes are literal and malformed interpolation is rejected', () => {
  assert.equal(run('f"{{name}}"'), '{name}');
  assert.equal(run('f"` ${x}"', { x: 3 }), '` $3');
  assert.equal(run('f"plain"'), 'plain');
  assert.equal(run('f""'), '');
  assert.equal(run('f"line\\nnext"'), 'line\nnext');
  assert.equal(run('"{name}"'), '{name}');
  for (const source of ['f"{}"', 'f"{1 2}"', 'f"{1"', 'f"}"', 'f"unterminated', 'f"{missing}"', 'f"{(let x 1)}"']) {
    assert.throws(() => compile(source, {}, forms), SyntaxError);
  }
});

test('special numeric literals survive reading and compilation', () => {
  for (const [source, expected] of [
    ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['-0', -0],
  ]) {
    assert.ok(Object.is(read(source)[0].value, expected));
    assert.ok(Object.is(run(source), expected));
  }
  assert.ok(Number.isNaN(run('(+ NaN 1)', arithmetic)));
  assert.equal(run('(* -Infinity -1)', arithmetic), Infinity);
  assert.ok(Number.isNaN(run('(- Infinity Infinity)', arithmetic)));
  assert.equal(run('"Infinity"'), 'Infinity');
  assert.equal(run('Infinity', { Infinity: 42 }), Infinity);
  assert.equal(run('NaN', { NaN: 42 }).toString(), 'NaN');
  assert.throws(() => run('(let Infinity 1)'), SyntaxError);
  assert.throws(() => run('1e999'), SyntaxError);
});

test('strict arithmetic supports composition, variables, and first-class operators', () => {
  assert.equal(run('(+ 1 (* 2 3))', arithmetic), 7);
  assert.equal(run('(let x 10) (set x (- x 3)) (/ x 2)', arithmetic), 3.5);
  assert.equal(run('(let add +) (add 2 3 4)', arithmetic), 9);
  assert.equal(run('(- 5)', arithmetic), -5);
  assert.equal(run('(/ 4)', arithmetic), 0.25);
  assert.equal(run('(- 10 2 3)', arithmetic), 5);
  assert.equal(run('(/ 24 2 3)', arithmetic), 4);
});

test('arithmetic identities, remainder, and floating point behavior', () => {
  assert.equal(run('(+)', arithmetic), 0);
  assert.equal(run('(*)', arithmetic), 1);
  assert.equal(run('(% -7 3)', arithmetic), -1);
  assert.equal(run('(/ 1 0)', arithmetic), Infinity);
  assert.ok(Number.isNaN(run('(/ 0 0)', arithmetic)));
});

test('arithmetic rejects coercion and invalid arity', () => {
  for (const operator of Object.keys(arithmetic)) {
    for (const value of ['1', true, null, undefined, 1n, {}, { valueOf: () => 1 }]) {
      assert.throws(() => arithmetic[operator](2, value), TypeError);
    }
  }
  for (const source of ['(+ 1 "2")', '(* true 2)', '(-)', '(/)', '(%)', '(% 1)', '(% 1 2 3)']) {
    assert.throws(() => run(source, arithmetic), TypeError);
  }
});

test('functions are callable values with explicit returns', () => {
  assert.equal(run('(let identity (fn (value) (return value))) (identity 42)'), 42);
  assert.equal(run('((fn (value) (return value)) 7)'), 7);
  assert.equal(run('((fn ()))'), null);
  assert.equal(run('((fn () 42))'), null);
  assert.equal(run('((fn () (return)))'), null);
  assert.equal(run('((fn (x) (set x 7) (return x)) 1)'), 7);
});

test('closures capture and mutate the correct lexical binding', () => {
  const factory = run('(let factory (fn (value) (return (fn (next) (set value next) (return value))))) factory');
  const first = factory(1), second = factory(2);
  assert.equal(first(3), 3);
  assert.equal(second(4), 4);
  assert.equal(run('(let x 1) (let get (fn () (return x))) { (let x 2) (set x 3) } (set x 4) (get)'), 4);
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
  ]) assert.throws(() => compile(source, { print() {} }, forms), SyntaxError);
});
