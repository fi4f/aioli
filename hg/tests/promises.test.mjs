import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Bindings } from "../bindings.js";
import { Forms } from "../forms.js";
import { Data } from "../data.js";
import { Scheduler } from "../scheduler.js";
const evaluate = (source, trace, extra = {}, options = {}) => Compiler.run(Compiler.compile(source, { ...Bindings, ...extra }, Forms, { trace, ...options }));

test('async functions await values, compose expressions, capture locals and preserve nil', async () => {
  for (const trace of [true,false]) {
    const events = [];
    const result = evaluate('(let load (async (fn (x:num) (record 1) (let a (await (promise x))) (record 2) (return (+ a (await (promise 3))))))) (load 2)', trace, { record: n => events.push(n) });
    assert.equal(Bindings['async?'](result),true); assert.equal(await result,5); assert.deepEqual(events,[1,2]);
    assert.equal(await evaluate('((async (fn () (return (await 7)))))',trace),7);
    assert.equal(await evaluate('((async (fn () 7)))',trace),7);
    assert.equal(await evaluate('((async (fn () (let sum 0) (for i (await 3) (set sum (+ sum i))) (return sum))))',trace),3);
    assert.equal(await evaluate('((async (fn () (let x 0) (while (< x (await 2)) (set x (+ x 1))) (return x))))',trace),2);
    assert.equal(await evaluate('((async (fn () (return $"value:{(await 2)}"))))',trace),'value:2');
    for (const source of ['(async x)','((async (fn () (await))))','((async (fn () (let f (fn () (await 1))) (return (f)))))','((async (fn () (text (await 1)))))']) assert.throws(()=>evaluate(source,trace),SyntaxError);
  }
});

test('async wraps literal definitions and function values', async () => {
  for (const trace of [true,false]) {
    const fn = evaluate('(async (fn (x) (return (+ x 1))))',trace);
    assert.equal(typeof fn,'function'); assert.equal(await fn(2),3);
    const value = await evaluate('(let callback (fn (x) (return (+ x 1)))) (async callback)',trace);
    assert.equal(typeof value,'function'); assert.equal(await value(2),3);
    assert.equal(await evaluate('(let callback (fn (x) (return (+ x 1)))) (promise (callback 2))',trace),3);
    assert.equal(typeof await evaluate('((async (fn () (return (fn () (return 7))))))',trace),'function');
    assert.throws(()=>evaluate('(async 1)',trace), /expects a function/);
    assert.throws(()=>evaluate('(async (fn))',trace), /parameter list/);
  }
});

test('promise chains support explicit settlement, normal returns, adoption and recovery', async () => {
  for (const trace of [true,false]) {
    const events = [];
    const result = evaluate(`(promise (resolve (promise 2))
      then (value) { (let finish (fn () (resolve (+ value 1)))) (finish) }
      then (value) (return (promise (* value 2)))
      finally (record "first")
      then (value) (reject "failure")
      catch (error:error) { (record error.message) (return 7) }
      catch (error) (return 99)
      finally { (record "last") (return 100) }
      then (value) (resolve (+ value 1)))`,trace,{record:value=>events.push(value)});
    assert.equal(await result,8); assert.deepEqual(events,['first','failure','last']);
    assert.equal(await evaluate('(promise (reject "oops") catch (error) (return error.message))',trace),'oops');
    assert.equal(await evaluate('(promise 1 finally (reject "cleanup") catch (error) (return error.message))',trace),'cleanup');
    assert.equal(await evaluate('(promise 1 then () (return (await (promise 3))))',trace),3);
    for (const source of ['(async)','(promise 1 then)','(promise 1 then (a b) 2)','(async 1 2)']) assert.throws(()=>evaluate(source,trace),SyntaxError);
  }
});

test('async helpers compose values and promises and preserve source locations', async () => {
  for (const trace of [true,false]) {
    const all = await evaluate('(async-all (list (promise 1) 2 (promise 3)))',trace);
    assert.deepEqual(Data.values(all),[1,2,3]);
    assert.equal(await evaluate('(async-race (list (promise 2) (promise 3)))',trace),2);
    assert.equal(await evaluate('(promise 2 then (x) (return (+ x 1)))',trace),3);
    assert.equal(await evaluate('(promise (reject "bad") catch (error) (return error.message))',trace),'bad');
    assert.equal(await evaluate('(promise 2 finally (return 9))',trace),2);
    const rejected = evaluate('((async (fn () (return (await (promise (reject "bad")))))))',trace);
    await assert.rejects(rejected, reason => trace ? reason.message.endsWith('bad') && !!reason.lisp : reason === 'bad');
    assert.equal(await evaluate('(promise (promise (reject "bad")) catch (error) (return (promise (reject error))) catch (error) (return error.message))',trace),'bad');
    assert.equal(await evaluate('((async (fn (p:promise) (return (await p)))) (promise 4))',trace),4);
  }
});

test('async helpers validate inputs and distinguish promises from async functions', async () => {
  for (const trace of [true, false]) {
    assert.equal(evaluate('(async? (promise 1))', trace), true);
    assert.equal(evaluate('(async? (async (fn () (return 1))))', trace), false);
    assert.equal(evaluate('(async? nil)', trace), false);
    assert.deepEqual(Data.values(await evaluate('(async-all (list))', trace)), []);
    for (const source of ['(async?)', '(async? 1 2)', '(async-all)', '(async-all 1)', '(async-all (list) (list))', '(async-race)', '(async-race 1)']) assert.throws(() => evaluate(source, trace), TypeError);
    for (const name of ['promise?', 'promise-resolve', 'promise-reject', 'promise-then', 'promise-catch', 'promise-finally', 'promise-all', 'promise-race']) {
      assert.throws(() => evaluate(`(${name} nil)`, trace), /Unknown symbol/);
    }
    await assert.rejects(evaluate('(async-all (list (promise 1) (promise (reject "all failed"))))', trace), reason => reason === 'all failed');
  }
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const results = Bindings['async-all'](Bindings.list(pending, 2));
  const race = Bindings['async-race'](Bindings.list(pending, Promise.reject(new Error('race failed'))));
  await assert.rejects(race, /race failed/);
  complete(1);
  assert.deepEqual(Data.values(await results), [1, 2]);
});

test('async attach waits before frames, and stale completions do not start a replacement scene', async () => {
  let resolve, reject, nextId = 0; const frames = new Map(), errors = [];
  const stage = Scheduler.new({ requestFrame: fn => { frames.set(++nextId,fn);return nextId; }, cancelFrame: id => frames.delete(id), onError: error=>errors.push(error) });
  const pending = new Promise(r=>{resolve=r;});
  Scheduler.replace(stage,{attach:()=>pending,render(){throw new Error('early');}});
  assert.equal(frames.size,0); Scheduler.frame(stage,0); resolve(); await pending; await Promise.resolve(); assert.equal(frames.size,1);
  const stale = new Promise((r,j)=>{reject=j;}); Scheduler.replace(stage,{attach:()=>stale}); Scheduler.replace(stage,{render(){}}); reject(new Error('stale')); await Promise.resolve(); assert.equal(frames.size,1); assert.deepEqual(errors,[]);
  const bad = Promise.reject(new Error('attach failed')); Scheduler.replace(stage,{attach:()=>bad}); await Promise.resolve(); assert.equal(stage.scene,null); assert.equal(errors.length,1);
  Scheduler.replace(stage,null);
});

test('async scene inputs return promises and rejected handlers are observed without blocking frames', async () => {
  for(const trace of [true,false]) {
    const values=[], errors=[], scene=evaluateScene('(on keydown (async (fn (event) (record (await (promise event.code))))))', trace, {record:v=>values.push(v)});
    const stage=Scheduler.new({requestFrame:()=>1,cancelFrame(){},onError:e=>errors.push(e)});Scheduler.replace(stage,scene);
    await Scheduler.invoke(stage,scene.keydown,Bindings.dict('code','KeyW')); assert.deepEqual(values,['KeyW']);
    await Scheduler.invoke(stage,()=>Promise.reject(new Error('input failed')),null).catch(()=>{}); assert.equal(errors.length,1);
    assert.throws(()=>evaluateScene('(on render (async (fn (context) (await 1))))', trace, {}), /synchronous/);
    Scheduler.replace(stage,null);
  }
});

test('on accepts fn, async fn and function variables with consistent callback validation', async () => {
  for (const trace of [true,false]) {
    const events=[];
    const scene=evaluateScene('(let release (async (fn (event) (record (await (promise event.code)))))) (on keydown (fn (event) (record event.code))) (on keyup release) (let handlers (dict "resize" (fn (event) (record event.w)))) (on resize handlers.resize)', trace, {record:v=>events.push(v)});
    scene.keydown(Bindings.dict('code','KeyA')); await scene.keyup(Bindings.dict('code','KeyB')); scene.resize(Bindings.dict('w',320));
    assert.deepEqual(events,['KeyA','KeyB',320]);
    for(const source of ['(on attach (fn (event)))','(let cb (fn (a b))) (on keydown cb)','(let cb 1) (on keydown cb)','(let cb (async (fn (context)))) (on render cb)']) assert.throws(()=>evaluateScene(source, trace, {}),Error);
    assert.throws(()=>evaluateScene('(on render (fn (context))) (on render ())', trace, {}), /Duplicate callback/);
  }
});
import { AppCore } from "../app.js";

test('top-level await preserves values, control flow and synchronous function boundaries', async () => {
  for (const trace of [true, false]) {
    const program = Compiler.compile('(let n (await (promise 3))) (let sum 0) (for i n { (set sum (+ sum (await i))) }) sum', Bindings, Forms, { trace });
    assert.equal(program.asynchronous, true);
    const result = Compiler.run(program);
    assert.equal(Bindings['async?'](result), true);
    assert.equal(await result, 3);
    assert.equal(await evaluate('(let x 0) { (set x (await 7)) } x', trace), 7);
    assert.equal(await evaluate('(if true { (await 2) }) (await 5)', trace), 5);
    assert.equal(await evaluate('$"value:{(await 2)}"', trace), 'value:2');
    assert.equal(Compiler.compile('(let f (async (fn () (return (await 1))))) 2', Bindings, Forms).asynchronous, false);
    assert.throws(() => evaluate('(await 1) (fn () (await 2))', trace), SyntaxError);
    await assert.rejects(evaluate('(await (promise (reject "initialization failed")))', trace), /initialization failed/);
  }
});

test('async scene initialization preserves the active scene and discards superseded results', async () => {
  const runtime = AppCore.new();
  let resets = 0;
  runtime.graphics = {};
  runtime.services.graphics = { resetScene() { resets++; } };
  runtime.requestFrame = () => 1;
  runtime.cancelFrame = () => {};
  const scene = source => Compiler.compileScene(source, Bindings, Forms, {  });
  const original = AppCore.activate(runtime,scene('(on render (fn (context) nil))'));
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const loading = AppCore.activate(runtime,Compiler.compileScene('(await ready) (on render (fn (context) nil))', { ...Bindings, ready: pending }, Forms, {  }));
  assert.equal(runtime.scene, original);
  const replacement = AppCore.activate(runtime,scene('(on render (fn (context) nil))'));
  resolve(null);
  assert.equal(await loading, undefined);
  assert.equal(runtime.scene, replacement);
  assert.equal(resets, 2);
  await assert.rejects(AppCore.activate(runtime,scene('(await (promise (reject "failed")))')), /failed/);
  assert.equal(runtime.scene, replacement);
  const initialized = await AppCore.activate(runtime,scene('(let n (await 8)) (on render (fn (context) (return n)))'));
  assert.equal(initialized.render(null), 8);
  assert.equal(runtime.scene, initialized);
  assert.equal(resets, 3);
  const abandoned = new Promise(done => { resolve = done; });
  const closing = AppCore.activate(runtime,Compiler.compileScene('(await ready)', { ...Bindings, ready: abandoned }, Forms, {  }));
  runtime.services.graphics.destroy = () => {};
  AppCore.destroy(runtime);
  resolve(null);
  assert.equal(await closing, undefined);
  assert.equal(runtime.scene, null);
  assert.equal(resets, 3);
});

const evaluateScene = (source, trace, extra = {}) => Compiler.run(Compiler.compileScene(source, { ...Bindings, ...extra }, Forms, { trace }));
