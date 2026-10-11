import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppCore } from "../app.js";
import { Scheduler } from "../scheduler.js";
import { Compiler } from "../compiler.js";
import { Bindings } from "../bindings.js";
import { Forms } from "../forms.js";
import { Data } from "../data.js";
import { Trace } from "../trace.js";
import { Modules } from "../modules.js";

function harness(files, options = {}) {
  const requests = [], events = [];
  const runtime = AppCore.new({ baseURL: 'https://example.test/app/main.lisp',
    bindings: { record: value => events.push(value) },
    fetch: async url => {
      requests.push(url);
      const value = files[url];
      if (value === undefined) return { ok: false, status: 404 };
      return { ok: true, text: async () => typeof value === 'function' ? value() : value };
    }, ...options });
  runtime.graphics = {};
  runtime.services.graphics = { createText: (graphics, description) => description, createShader: () => { throw new Error('Unexpected shader'); },
    resetScene() {}, destroy() {} };
  runtime.requestFrame = () => 1;
  runtime.cancelFrame = () => {};
  return { runtime, requests, events };
}

test('module namespaces expose live writable top-level bindings and preserve captured function values', async () => {
  for (const trace of [true, false]) {
    const program = Compiler.compileModule(`
      (let count 1)
      (let read (fn () (return count)))
      (let increment (fn () (set count (+ count 1)) (return count)))
      (let forward (fn () (return (read))))
      (struct Point x:f32)
      (let make-point (fn () (return (Point x count))))
      (on render (fn (context) (return count)))
      999
    `, Bindings, Forms, { trace });
    const module = Compiler.run(program);
    assert.equal(Data.dataKind(module), 'dict');
    assert.deepEqual(Object.keys(Data.values(module)), ['count', 'read', 'increment', 'forward', 'Point', 'make-point', 'render']);
    const read = Data.get(module, 'read');
    Data.put(module, 'count', 7);
    assert.equal(read(), 7);
    assert.equal(Data.get(module, 'increment')(), 8);
    assert.equal(Data.get(module, 'count'), 8);
    Data.put(module, 'read', () => 42);
    assert.equal(Data.get(module, 'forward')(), 42);
    assert.equal(read(), 8);
    Data.put(module, 'Point', () => 99);
    assert.equal(Data.get(module, 'make-point')(), 99);
    Data.put(module, 'render', () => 123);
    assert.equal(Data.get(module, 'render')(null), 123);
    Data.put(module, 'new-member', 'public');
    assert.equal(Data.get(module, 'new-member'), 'public');
    assert.equal(Data.get(module, '+'), null);
    assert.throws(() => Compiler.compileModule('(let x 1) (let x 2)', Bindings, Forms, {  }), /already defined/);
  }
});

test('imports resolve from their own script and share initialization, state and patches', async () => {
  for (const trace of [true, false]) {
    const files = {
      'https://example.test/app/lib/math.lisp': '(record "math") (let value (await (async 3))) (let read (fn () (return value)))',
      'https://example.test/app/lib/nested.lisp': '(let math (await (import "./math.lisp"))) (let read (fn () (return (math.read)))) (let load-later (async (fn (path) (return (await (import path))))))',
    };
    const { runtime, requests, events } = harness(files, { trace });
    try {
      const modules = await AppCore.run(runtime, '(list (await (import "./lib/math.lisp")) (await (import "./lib/../lib/math.lisp#same")) (await (import "./lib/nested.lisp")))');
      const [math, alias, nested] = Data.values(modules);
      assert.equal(math, alias);
      assert.equal(Data.get(nested, 'math'), math);
      Data.put(math, 'read', () => 99);
      assert.equal(Data.get(nested, 'read')(), 99);
      assert.equal(await Data.get(nested, 'load-later')('./math.lisp'), math);
      assert.deepEqual(events, ['math']);
      assert.equal(requests.length, 2);
      assert.equal(await AppCore.run(runtime, '(let path "./lib/math.lisp") (let math (await (import path))) (set math.value 12) math.value'), 12);
      assert.equal(await AppCore.run(runtime, '(let math (await (import "./lib/math.lisp"))) math.value'), 12);
      assert.equal(Bindings['async?'](AppCore.run(runtime, '(import "./lib/math.lisp")')), true);
      const separate = harness(files);
      try {
        const independent = await AppCore.run(separate.runtime, '(await (import "./lib/math.lisp"))');
        assert.notEqual(independent, math);
        assert.equal(Data.get(independent, 'value'), 3);
        assert.equal(Data.get(independent, 'read')(), 3);
      }
      finally { AppCore.destroy(separate.runtime); }
    } finally { AppCore.destroy(runtime); }
  }
});

test('concurrent imports share pending initialization and failures can be retried', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const files = { 'https://example.test/app/slow.lisp': '(record "start") (let value (await ready))' };
  const { runtime, requests, events } = harness(files, { bindings: { ready, record: value => events.push(value) } });
  try {
    const a = AppCore.run(runtime, '(import "./slow.lisp")');
    const b = AppCore.run(runtime, '(import "./slow.lisp")');
    release(5);
    assert.equal(await a, await b);
    assert.equal(requests.length, 1);
    assert.deepEqual(events, ['start']);
    await assert.rejects(AppCore.run(runtime, '(import "./missing.lisp")'), /HTTP 404/);
    files['https://example.test/app/missing.lisp'] = '(let value 7)';
    assert.equal(Data.get(await AppCore.run(runtime, '(import "./missing.lisp")'), 'value'), 7);
    files['https://example.test/app/broken.lisp'] = '(let value (await (promise (reject "broken"))))';
    await assert.rejects(AppCore.run(runtime, '(import "./broken.lisp")'), /broken/);
    files['https://example.test/app/broken.lisp'] = '(let value 8)';
    assert.equal(Data.get(await AppCore.run(runtime, '(import "./broken.lisp")'), 'value'), 8);
    for (const source of ['(import)', '(import "a" "b")', '(import 1)', '(import "")']) await assert.rejects(AppCore.run(runtime, source));
  } finally { AppCore.destroy(runtime); }
});

test('circular imports reject with their dependency chain instead of deadlocking', { timeout: 3000 }, async () => {
  const { runtime } = harness({
    'https://example.test/app/a.lisp': '(let b (await (import "./b.lisp")))',
    'https://example.test/app/b.lisp': '(let a (await (import "./a.lisp")))',
    'https://example.test/app/self.lisp': '(let self (await (import "./self.lisp")))',
  });
  try {
    await assert.rejects(AppCore.run(runtime, '(await (import "./a.lisp"))'), /Circular import:.*b.lisp.*a.lisp.*b.lisp/);
    await assert.rejects(AppCore.run(runtime, '(await (import "./self.lisp"))'), /Circular import:.*self.lisp/);
  } finally { AppCore.destroy(runtime); }
});

test('path-based scene activation runs fresh script state and shares imported libraries', async () => {
  const { runtime, events, requests } = harness({
    'https://example.test/app/scenes/menu.lisp': '(let shared (await (import "../lib.lisp"))) (let n 0) (on attach (fn () (record shared.value))) (on render (fn (context) (set n (+ n 1)) (return n)))',
    'https://example.test/app/lib.lisp': '(record "library") (let value 7)',
    'https://example.test/app/scenes/idle.lisp': '(record "idle")',
  });
  try {
    const a = await AppCore.run(runtime, '(await (set-scene "./scenes/menu.lisp"))');
    assert.equal(a, runtime.scene);
    assert.equal(a.render(null), 1);
    assert.equal(a.render(null), 2);
    const b = await AppCore.run(runtime, '(await (set-scene "./menu.lisp"))', { sourceURL: './scenes/controller.lisp' });
    assert.notEqual(a, b);
    assert.equal(b.render(null), 1);
    assert.deepEqual(events, ['library', 7, 7]);
    assert.equal(requests.filter(url => url.endsWith('/lib.lisp')).length, 1);
    await assert.rejects(AppCore.run(runtime, '(await (set-scene "./missing.lisp"))'), /404/);
    assert.equal(runtime.scene, b);
    const idle = await AppCore.run(runtime, '(await (set-scene "./scenes/idle.lisp"))');
    assert.deepEqual(idle, {});
    assert.equal(runtime.scene, idle);
    for (const source of ['(set-scene)', '(set-scene 1)']) await assert.rejects(AppCore.run(runtime, source));
  } finally { AppCore.destroy(runtime); }
});

test('destroying the runtime prevents pending imports from being initialized', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { runtime, events } = harness({ 'https://example.test/app/pending.lisp': () => pending });
  const loading = AppCore.run(runtime, '(await (import "./pending.lisp"))');
  // Let the fetch reach its pending response body.
  await new Promise(resolve => setTimeout(resolve, 0));
  AppCore.destroy(runtime);
  release('(record "should not run")');
  await assert.rejects(loading, /disposed/);
  assert.deepEqual(events, []);
});

test('standalone awaited imports merge live names while assigned imports stay namespaced', async () => {
  for (const trace of [true, false]) {
    const { runtime } = harness({
      'https://example.test/app/library.lisp': '(let value 5) (let test (fn () (return value))) (let forward (fn () (return (test))))',
      'https://example.test/app/combined.lisp': '(await (import "./library.lisp")) (let own 7) (let read (fn () (return (test))))',
    }, { trace });
    try {
      assert.equal(await AppCore.run(runtime, '(await (import "./library.lisp")) (test)'), 5);
      assert.equal(await AppCore.run(runtime, '(await (import "./library.lisp")) (set value 9) (test)'), 9);
      const merged = await AppCore.run(runtime, '(await (import "./library.lisp")) (set test (fn () (return 42))) (forward)');
      assert.equal(merged, 42);
      assert.equal(await AppCore.run(runtime, '(let lib (await (import "./library.lisp"))) (lib.test)'), 42);
      assert.throws(() => AppCore.compile(runtime,'(let lib (await (import "./library.lisp"))) (test)'), /Unknown symbol: test/);
      assert.equal(await AppCore.run(runtime, '(await (import "./library.lisp")) (await (import "./library.lisp")) (test)'), 42);
      assert.equal(await AppCore.run(runtime, '(let f (async (fn () (await (import "./library.lisp")) (return (test))))) (await (f))'), 42);
      const combined = await AppCore.run(runtime, '(let combined (await (import "./combined.lisp"))) combined');
      assert.equal(Data.get(combined, 'own'), 7);
      Data.put(combined, 'value', 11);
      assert.equal(Data.get(combined, 'value'), 11);
      const library = await AppCore.run(runtime, '(let lib (await (import "./library.lisp"))) lib');
      assert.equal(Data.get(library, 'value'), 11);
      assert.equal(Data.get(combined, 'read')(), 42);
      assert.equal(await AppCore.run(runtime, '(await (import "./library.lisp")) (let local (fn (value) (return value))) (local 3)'), 3);
      assert.throws(() => AppCore.compile(runtime,'{ (await (import "./library.lisp")) } (test)'), /Unknown symbol: test/);
      await assert.rejects(AppCore.run(runtime, '(await (import "./library.lisp")) (missing)'), /Unknown symbol: missing/);
      const importing = AppCore.run(runtime, '(import "./library.lisp")');
      assert.equal(Bindings['async?'](importing), true);
      assert.equal(await importing, library);
    } finally { AppCore.destroy(runtime); }
  }
});

test('merged imports reject conflicts atomically with locals, builtins and other modules', async () => {
  const scope = Modules.imports.scope(['collision'], []);
  assert.throws(() => Modules.imports.merge(scope, Bindings.dict('first', 1, 'collision', 2)), /Import name conflict: collision/);
  assert.equal(scope.entries.size, 0);
  for (const trace of [true, false]) {
    const { runtime } = harness({
      'https://example.test/app/a.lisp': '(let shared 1)',
      'https://example.test/app/b.lisp': '(let first 2) (let shared 3)',
      'https://example.test/app/builtins.lisp': '(let print (fn () nil))',
    }, { trace });
    try {
      await assert.rejects(AppCore.run(runtime, '(let shared 0) (await (import "./a.lisp"))'), /Import name conflict: shared/);
      await assert.rejects(AppCore.run(runtime, '(await (import "./a.lisp")) (let shared 0)'), /Import name conflict: shared/);
      await assert.rejects(AppCore.run(runtime, '(await (import "./a.lisp")) (await (import "./b.lisp"))'), /Import name conflict: shared/);
      await assert.rejects(AppCore.run(runtime, '(await (import "./builtins.lisp"))'), /Import name conflict: print/);
      assert.equal(await AppCore.run(runtime, '(let a (await (import "./a.lisp"))) (let b (await (import "./b.lisp"))) (+ a.shared b.shared)'), 4);
    } finally { AppCore.destroy(runtime); }
  }
});

test('newer scene requests supersede pending path loads without replacing the active scene on failure', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { runtime, events } = harness({
    'https://example.test/app/slow.lisp': () => pending,
    'https://example.test/app/fast.lisp': '(record "fast")',
    'https://example.test/app/fail.lisp': '(await (promise (reject "failed")))',
  });
  try {
    const initial = AppCore.setScene(runtime,'(record "initial")');
    const slow = AppCore.run(runtime, '(set-scene "./slow.lisp")');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(runtime.scene, initial);
    const fast = await AppCore.run(runtime, '(set-scene "./fast.lisp")');
    release('(record "superseded")');
    assert.equal(await slow, undefined);
    assert.equal(runtime.scene, fast);
    await assert.rejects(AppCore.run(runtime, '(set-scene "./fail.lisp")'), /failed/);
    assert.equal(runtime.scene, fast);
    assert.deepEqual(events, ['initial', 'fast']);
  } finally { AppCore.destroy(runtime); }
});

test('imported function failures report the module and caller source locations', async () => {
  const { runtime } = harness({
    'https://example.test/app/lib/broken.lisp': '(let fail (fn () (return (+ 1 "bad"))))',
    'https://example.test/app/lib/syntax.lisp': '(let missing)',
    'https://example.test/app/lib/parse.lisp': '(let missing (fn ()',
  });
  try {
    await assert.rejects(AppCore.run(runtime, '(let lib (await (import "./lib/broken.lisp")))\n(lib.fail)', { sourceURL: './main.lisp' }), error => {
      const trace = Trace.formatTrace(error);
      assert.match(trace, /lib\/broken.lisp:1:/);
      assert.match(trace, /Called from https:\/\/example.test\/app\/main.lisp:2:1/);
      assert.match(trace, /\(lib.fail\)/);
      return true;
    });
    await assert.rejects(AppCore.run(runtime, '(await (import "./lib/syntax.lisp"))'), error => {
      assert.match(Trace.formatTrace(error), /lib\/syntax.lisp:1:/);
      return true;
    });
    await assert.rejects(AppCore.run(runtime, '(await (import "./lib/parse.lisp"))'), error => {
      const trace = Trace.formatTrace(error);
      assert.match(trace, /lib\/parse.lisp:1:/);
      assert.match(trace, /Called from source:1:/);
      assert.match(trace, /\(await \(import/);
      return true;
    });
    await assert.rejects(AppCore.run(runtime, '(let lib (await (import "./lib/broken.lisp")))\n(lib.fail)'), error => {
      assert.match(Trace.formatTrace(error), /Called from source:2:1/);
      return true;
    });
  } finally { AppCore.destroy(runtime); }
});
