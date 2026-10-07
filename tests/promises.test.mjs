import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler/compiler.js';
import { bindings } from '../engine/language/bindings.js';
import { forms } from '../engine/compiler/forms.js';
import { get } from '../engine/language/data.js';
import { Stage } from '../engine/runtime/stage.js';
const evaluate = (source, trace, extra = {}, options = {}) => compile(source, { ...bindings, ...extra }, forms, { trace, ...options }).run();

test('async functions await values, compose expressions, capture locals and preserve nil', async () => {
  for (const trace of [true,false]) {
    const events = [];
    const result = evaluate('(let load (async (fn (x:num) (record 1) (let a (await (async x))) (record 2) (return (+ a (await (async 3))))))) (load 2)', trace, { record: n => events.push(n) });
    assert.equal(bindings['async?'](result),true); assert.equal(await result,5); assert.deepEqual(events,[1,2]);
    assert.equal(await evaluate('((async (fn () (return (await 7)))))',trace),7);
    assert.equal(await evaluate('((async (fn () 7)))',trace),null);
    assert.equal(await evaluate('((async (fn () (let sum 0) (for i (await 3) (set sum (+ sum i))) (return sum))))',trace),3);
    assert.equal(await evaluate('((async (fn () (let x 0) (while (< x (await 2)) (set x (+ x 1))) (return x))))',trace),2);
    assert.equal(await evaluate('((async (fn () (return f"value:{(await 2)}"))))',trace),'value:2');
    for (const source of ['(async x)','((async (fn () (await))))','((async (fn () (let f (fn () (await 1))) (return (f)))))','((async (fn () (text (await 1)))))']) assert.throws(()=>evaluate(source,trace),SyntaxError);
  }
});

test('async distinguishes literal function definitions from dispatching function values', async () => {
  for (const trace of [true,false]) {
    const fn = evaluate('(async (fn (x) (return (+ x 1))))',trace);
    assert.equal(typeof fn,'function'); assert.equal(await fn(2),3);
    const value = await evaluate('(let callback (fn (x) (return (+ x 1)))) (async callback)',trace);
    assert.equal(typeof value,'function'); assert.equal(value(2),3);
    assert.equal(await evaluate('(let callback (fn (x) (return (+ x 1)))) (async (callback 2))',trace),3);
    assert.equal(typeof await evaluate('((async (fn () (return (fn () (return 7))))))',trace),'function');
    assert.throws(()=>evaluate('(promise 1)',trace), /Unknown symbol/);
    assert.throws(()=>evaluate('(async (fn))',trace), /parameter list/);
  }
});

test('promise chains support repeated then, catch and finally with return adoption and recovery', async () => {
  for (const trace of [true,false]) {
    const events = [];
    const result = evaluate(`(async (async 2)
      then (value) { (return (+ value 1)) }
      then (value) (return (async (* value 2)))
      finally (record "first")
      then (value) (return (async (throw "failure")))
      catch (error:dict) { (record error.message) (return 7) }
      catch (error) (return 99)
      finally { (record "last") (return 100) }
      then (value) (return (+ value 1)))`,trace,{record:value=>events.push(value)});
    assert.equal(await result,8); assert.deepEqual(events,['first','failure','last']);
    assert.equal(await evaluate('(async (throw "oops") catch (error) (return error.message))',trace),'oops');
    assert.equal(await evaluate('(async 1 finally (throw "cleanup") catch (error) (return error.message))',trace),'cleanup');
    assert.equal(await evaluate('(async 1 then () (return (await (async 3))))',trace),3);
    for (const source of ['(async)','(async 1 then)','(async 1 then (a b) 2)','(async 1 else 2)']) assert.throws(()=>evaluate(source,trace),SyntaxError);
  }
});

test('async helpers compose values and promises and preserve source locations', async () => {
  for (const trace of [true,false]) {
    const all = await evaluate('(async-all (list (async 1) 2 (async 3)))',trace);
    assert.deepEqual(all.values,[1,2,3]);
    assert.equal(await evaluate('(async-race (list (async 2) (async 3)))',trace),2);
    assert.equal(await evaluate('(async 2 then (x) (return (+ x 1)))',trace),3);
    assert.equal(await evaluate('(async (throw "bad") catch (error) (return error.message))',trace),'bad');
    assert.equal(await evaluate('(async 2 finally (return 9))',trace),2);
    const rejected = evaluate('((async (fn () (return (await (async (throw "bad")))))))',trace);
    await assert.rejects(rejected, error => error.message === 'bad' && (!trace || !!error.lisp));
    assert.equal(await evaluate('(async (async (throw "bad")) catch (error) (return (async (throw error))) catch (error) (return error.message))',trace),'bad');
    assert.equal(await evaluate('((async (fn (p:promise) (return (await p)))) (async 4))',trace),4);
  }
});

test('async helpers validate inputs and distinguish promises from async functions', async () => {
  for (const trace of [true, false]) {
    assert.equal(evaluate('(async? (async 1))', trace), true);
    assert.equal(evaluate('(async? (async (fn () (return 1))))', trace), false);
    assert.equal(evaluate('(async? nil)', trace), false);
    assert.deepEqual((await evaluate('(async-all (list))', trace)).values, []);
    for (const source of ['(async?)', '(async? 1 2)', '(async-all)', '(async-all 1)', '(async-all (list) (list))', '(async-race)', '(async-race 1)']) assert.throws(() => evaluate(source, trace), TypeError);
    for (const name of ['promise?', 'promise-resolve', 'promise-reject', 'promise-then', 'promise-catch', 'promise-finally', 'promise-all', 'promise-race']) {
      assert.throws(() => evaluate(`(${name} nil)`, trace), /Unknown symbol/);
    }
    await assert.rejects(evaluate('(async-all (list (async 1) (async (throw "all failed"))))', trace), /all failed/);
  }
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const results = bindings['async-all'](bindings.list(pending, 2));
  const race = bindings['async-race'](bindings.list(pending, Promise.reject(new Error('race failed'))));
  await assert.rejects(race, /race failed/);
  complete(1);
  assert.deepEqual((await results).values, [1, 2]);
});

test('async attach waits before frames, and stale completions do not start a replacement scene', async () => {
  let resolve, reject, nextId = 0; const frames = new Map(), errors = [];
  const stage = new Stage({ requestFrame: fn => { frames.set(++nextId,fn);return nextId; }, cancelFrame: id => frames.delete(id), onError: error=>errors.push(error) });
  const pending = new Promise(r=>{resolve=r;});
  stage.replace({attach:()=>pending,render(){throw new Error('early');}});
  assert.equal(frames.size,0); stage.frame(0); resolve(); await pending; await Promise.resolve(); assert.equal(frames.size,1);
  const stale = new Promise((r,j)=>{reject=j;}); stage.replace({attach:()=>stale}); stage.replace({render(){}}); reject(new Error('stale')); await Promise.resolve(); assert.equal(frames.size,1); assert.deepEqual(errors,[]);
  const bad = Promise.reject(new Error('attach failed')); stage.replace({attach:()=>bad}); await Promise.resolve(); assert.equal(stage.scene,null); assert.equal(errors.length,1);
  stage.replace(null);
});

test('async scene inputs return promises and rejected handlers are observed without blocking frames', async () => {
  for(const trace of [true,false]) {
    const values=[], errors=[], scene=evaluate('(on keydown (async (fn (event) (record (await (async event.code))))))',trace,{record:v=>values.push(v)},{scene:true});
    const stage=new Stage({requestFrame:()=>1,cancelFrame(){},onError:e=>errors.push(e)});stage.replace(scene);
    await stage.invoke(scene.keydown,bindings.dict('code','KeyW')); assert.deepEqual(values,['KeyW']);
    await stage.invoke(()=>Promise.reject(new Error('input failed')),null).catch(()=>{}); assert.equal(errors.length,1);
    assert.throws(()=>evaluate('(on render (async (fn (context) (await 1))))',trace,{}, {scene:true}), /synchronous/);
    stage.replace(null);
  }
});

test('on accepts fn, async fn and function variables with consistent callback validation', async () => {
  for (const trace of [true,false]) {
    const events=[];
    const scene=evaluate('(let release (async (fn (event) (record (await (async event.code)))))) (on keydown (fn (event) (record event.code))) (on keyup release) (let handlers (dict "resize" (fn (event) (record event.w)))) (on resize handlers.resize)',trace,{record:v=>events.push(v)},{scene:true});
    scene.keydown(bindings.dict('code','KeyA')); await scene.keyup(bindings.dict('code','KeyB')); scene.resize(bindings.dict('w',320));
    assert.deepEqual(events,['KeyA','KeyB',320]);
    for(const source of ['(on attach (fn (event)))','(let cb (fn (a b))) (on keydown cb)','(let cb 1) (on keydown cb)','(let cb (async (fn (context)))) (on render cb)']) assert.throws(()=>evaluate(source,trace,{}, {scene:true}),Error);
    assert.throws(()=>evaluate('(on render (fn (context))) (on render ())',trace,{}, {scene:true}), /Duplicate callback/);
  }
});
import { Aioli } from '../engine/runtime/aioli.js';

test('top-level await preserves values, control flow and synchronous function boundaries', async () => {
  for (const trace of [true, false]) {
    const program = compile('(let n (await (async 3))) (let sum 0) (for i n { (set sum (+ sum (await i))) }) sum', bindings, forms, { trace });
    assert.equal(program.asynchronous, true);
    const result = program.run();
    assert.equal(bindings['async?'](result), true);
    assert.equal(await result, 3);
    assert.equal(await evaluate('(let x 0) { (set x (await 7)) } x', trace), 7);
    assert.equal(await evaluate('(if true { (await 2) }) (await 5)', trace), 5);
    assert.equal(await evaluate('f"value:{(await 2)}"', trace), 'value:2');
    assert.equal(compile('(let f (async (fn () (return (await 1))))) 2', bindings, forms).asynchronous, false);
    assert.throws(() => evaluate('(await 1) (fn () (await 2))', trace), SyntaxError);
    await assert.rejects(evaluate('(await (async (throw "initialization failed")))', trace), /initialization failed/);
  }
});

test('async scene initialization preserves the active scene and discards superseded results', async () => {
  const runtime = new Aioli();
  let resets = 0;
  runtime.graphics = { resetScene() { resets++; } };
  runtime.stage.requestFrame = () => 1;
  runtime.stage.cancelFrame = () => {};
  const scene = source => compile(source, bindings, forms, { scene: true });
  const original = runtime.activate(scene('(on render (fn (context) nil))'));
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const loading = runtime.activate(compile('(await ready) (on render (fn (context) nil))', { ...bindings, ready: pending }, forms, { scene: true }));
  assert.equal(runtime.stage.scene, original);
  const replacement = runtime.activate(scene('(on render (fn (context) nil))'));
  resolve(null);
  assert.equal(await loading, undefined);
  assert.equal(runtime.stage.scene, replacement);
  assert.equal(resets, 2);
  await assert.rejects(runtime.activate(scene('(await (async (throw "failed")))')), /failed/);
  assert.equal(runtime.stage.scene, replacement);
  const initialized = await runtime.activate(scene('(let n (await 8)) (on render (fn (context) (return n)))'));
  assert.equal(initialized.render(null), 8);
  assert.equal(runtime.stage.scene, initialized);
  assert.equal(resets, 3);
  const abandoned = new Promise(done => { resolve = done; });
  const closing = runtime.activate(compile('(await ready)', { ...bindings, ready: abandoned }, forms, { scene: true }));
  runtime.graphics.destroy = () => {};
  runtime.destroy();
  resolve(null);
  assert.equal(await closing, undefined);
  assert.equal(runtime.stage.scene, null);
  assert.equal(resets, 3);
});
