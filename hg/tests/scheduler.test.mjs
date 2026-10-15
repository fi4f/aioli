import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler } from "../compiler.js";
import { Forms } from "../forms.js";
import { Arithmetic } from "../arithmetic.js";
import { Scheduler } from "../scheduler.js";
import { Data } from "../data.js";

function harness(options = {}) {
  let nextId = 0;
  const frames = new Map(), errors = [];
  const stage = Scheduler.new({
    ...options, onError: error => errors.push(error),
    requestFrame: fn => { const id = ++nextId; frames.set(id, fn); return id; },
    cancelFrame: id => frames.delete(id),
  });
  const tick = time => {
    const [id, fn] = frames.entries().next().value;
    frames.delete(id); fn(time);
  };
  return { stage, tick, frames, errors };
}

test('ordinary ups edits are consumed and validated at the next app frame', () => {
  const { stage, tick } = harness();
  Scheduler.replace(stage, { render() {} });
  stage.ups = 120;
  tick(0);
  assert.equal(stage.dt, 1 / 120);
  stage.ups = 0;
  tick(16);
  assert.equal(stage.failed, true);
  Scheduler.replace(stage, null);
});

test('input render requests coalesce and do not advance simulation time', async () => {
  const { stage, frames } = harness();
  let renders = 0, updates = 0;
  Scheduler.replace(stage,{ update() { updates++; }, render() { renders++; } });
  Scheduler.requestRender(stage); Scheduler.requestRender(stage); Scheduler.requestRender(stage);
  assert.equal(renders, 0);
  await Promise.resolve();
  assert.equal(renders, 1);
  assert.equal(updates, 0);
  assert.equal(stage.elapsed, 0);
  assert.equal(frames.size, 1);
  Scheduler.requestRender(stage);
  Scheduler.replace(stage,{ render() { renders += 10; } });
  Scheduler.requestRender(stage);
  await Promise.resolve();
  assert.equal(renders, 11);
  Scheduler.replace(stage,null);
});

test('input render failures use the normal scheduler error path', async () => {
  const { stage, frames, errors } = harness();
  Scheduler.replace(stage,{ render() { throw new Error('render failure'); } });
  Scheduler.requestRender(stage);
  await Promise.resolve();
  assert.equal(stage.failed, true);
  assert.equal(frames.size, 0);
  assert.match(errors[0].message, /render failure/);
  Scheduler.replace(stage,null);
});

test('update and render receive fresh dictionaries with independent clocks and current dimensions', () => {
  const dimensions = { w: 320, h: 200 };
  const { stage, tick } = harness({ updateHz: 10, maxUpdatesPerFrame: 2, dimensions: () => dimensions });
  const updated = [], rendered = [];
  Scheduler.replace(stage,{ update: context => updated.push(context), render: context => rendered.push(context) });
  tick(0); tick(350);
  assert.equal(Data.get(rendered[0], 't'), 0);
  assert.equal(Data.get(rendered[0], 'dt'), 0);
  assert.equal(Data.get(updated[0], 'dt'), 0.1);
  assert.equal(Data.get(updated[0], 't'), 0.1);
  assert.equal(Data.get(updated[1], 't'), 0.2);
  assert.equal(Data.get(rendered[1], 't'), 0.35);
  assert.equal(Data.get(rendered[1], 'dt'), 0.35);
  assert.equal(Data.get(updated[0], 'w'), 320);
  assert.equal(Data.get(updated[0], 'h'), 200);
  dimensions.w = 640; dimensions.h = 480;
  tick(450);
  assert.equal(Data.get(updated.at(-1), 't'), 0.4);
  assert.equal(Data.get(updated.at(-1), 'w'), 640);
  assert.equal(Data.get(rendered.at(-1), 'h'), 480);
  assert.equal(Data.get(updated[0], 'w'), 320);
  assert.notEqual(updated[0], updated[1]);
  assert.notEqual(rendered[0], rendered[1]);
  Scheduler.replace(stage,{ update: context => updated.push(context), render: context => rendered.push(context) });
  tick(9999); tick(10099);
  assert.equal(Data.get(updated.at(-1), 't'), 0.1);
  assert.equal(Data.get(rendered.at(-2), 't'), 0);
});

test('callbacks share scene data, fresh per execution in both modes', () => {
  for (const trace of [true, false]) {
    const output = [];
    const program = Compiler.compileScene(`
      (let time 0)
      (on attach () (print "attach"))
      (on update (context) (set time (+ time context.dt)))
      (on render () (print time))
      (on detach () (print "detach"))
    `, { ...Arithmetic.bindings, print: v => output.push(v) }, Forms, { trace });
    const a = Compiler.run(program), b = Compiler.run(program);
    a.attach(); a.update(Data.dict('dt', 0.5)); a.render(); b.render(); a.detach();
    assert.deepEqual(output, ['attach', 0.5, 0, 'detach']);
  }
});

test('invalid callback declarations fail compilation', () => {
  for (const source of ['(on nope ())', '(on update ()) (on update ())',
    '{(on render ())}', '(fn () (on attach ()))', '(on update dt)',
    '(on render (a b))', '(on attach (dt))', '(on update (a b))', '(on 1 ())', '(on update (1))']) {
    assert.throws(() => Compiler.compileScene(source, {}, Forms, {  }), SyntaxError);
  }
  assert.throws(() => Compiler.compile('(on render ())', {}, Forms), SyntaxError);
});

test('fixed steps accumulate across frames; rendering follows updates', () => {
  const { stage, tick } = harness({ updateHz: 120 });
  const events = [], intervals = [];
  Scheduler.replace(stage,{ attach: () => events.push('attach'),
    update: context => { events.push('update'); intervals.push(Data.get(context, 'dt')); }, render: () => events.push('render') });
  tick(0); tick(4); tick(20); tick(25);
  assert.deepEqual(events, ['attach', 'render', 'render', 'update', 'update', 'render', 'update', 'render']);
  assert.deepEqual(intervals, [1 / 120, 1 / 120, 1 / 120]);
});

test('render receives variable frame dt independently of fixed updates', () => {
  const { stage, tick } = harness({ updateHz: 120, maxUpdatesPerFrame: 1 });
  const rendered = [], updated = [];
  const scene = Compiler.run(Compiler.compileScene('(on update (context) (update-time context.dt)) (on render (context) (render-time context.dt))', {
    'update-time': dt => updated.push(dt), 'render-time': dt => rendered.push(dt),
  }, Forms, {  }));
  Scheduler.replace(stage,scene);
  tick(100); tick(104); tick(124); tick(124);
  assert.deepEqual(rendered, [0, 0.004, 0.02, 0]);
  assert.deepEqual(updated, [1 / 120, 1 / 120]);
  Scheduler.replace(stage,scene);
  tick(9999);
  assert.equal(rendered.at(-1), 0);
});

test('catch-up is bounded without dropping accumulated time', () => {
  const { stage, tick } = harness({ updateHz: 10, maxUpdatesPerFrame: 2 });
  let updates = 0, renders = 0;
  Scheduler.replace(stage,{ update: () => updates++, render: () => renders++ });
  tick(0); tick(500);
  assert.equal(updates, 2);
  tick(500); tick(500);
  assert.equal(updates, 5); assert.equal(renders, 4);
});

test('replacement calls detach/attach once and resets timing', () => {
  const { stage, tick, frames } = harness();
  const events = [];
  Scheduler.replace(stage,{ attach: () => events.push('a+'), detach: () => events.push('a-') });
  tick(0);
  Scheduler.replace(stage,{ attach: () => events.push('b+'), detach: () => events.push('b-'), update: () => events.push('update') });
  tick(9999);
  Scheduler.replace(stage,null); Scheduler.replace(stage,null);
  assert.deepEqual(events, ['a+', 'a-', 'b+', 'b-']); assert.equal(frames.size, 0);
});

test('callback failures stop frames and report once', () => {
  const { stage, tick, frames, errors } = harness();
  const error = new Error('render failed');
  Scheduler.replace(stage,{ render() { throw error; } }); tick(0);
  assert.deepEqual(errors, [error]); assert.equal(frames.size, 0);
  assert.throws(() => Scheduler.replace(stage,{ attach() { throw error; } }), /render failed/);
  assert.equal(stage.scene, null);
});

test('install accepts an already attached immutable scene without calling attach again', () => {
  const { stage, frames } = harness();
  const events = [];
  Scheduler.replace(stage, { detach: () => events.push('old detach') });
  const scene = Object.freeze({ attach: () => events.push('new attach'), render() {} });
  scene.attach();
  Scheduler.install(stage, scene);
  assert.equal(stage.scene, scene);
  assert.deepEqual(events, ['new attach', 'old detach']);
  assert.equal(frames.size, 1);
  Scheduler.replace(stage, null);
});

test('runtime failure cancels queued rendering, reports once, and replacement recovers', async () => {
  const { stage, frames, errors } = harness();
  let renders = 0;
  Scheduler.replace(stage, { render() { renders++; } });
  Scheduler.requestRender(stage);
  const error = new Error('native input failed');
  Scheduler.fail(stage, error);
  Scheduler.fail(stage, new Error('secondary failure'));
  await Promise.resolve();
  assert.deepEqual(errors, [error]);
  assert.equal(renders, 0);
  assert.equal(frames.size, 0);
  Scheduler.replace(stage, { render() { renders++; } });
  Scheduler.requestRender(stage);
  await Promise.resolve();
  assert.equal(stage.failed, false);
  assert.equal(renders, 1);
  assert.equal(frames.size, 1);
  Scheduler.replace(stage, null);
});

test('invalid timing settings are rejected', () => {
  for (const updateHz of [0, -1, Infinity, NaN, '60']) assert.throws(() => harness({ updateHz }), TypeError);
  assert.throws(() => harness({ maxUpdatesPerFrame: 0 }), TypeError);
});

test('ups changes preserve accumulated backlog and rendering follows every browser frame', () => {
  const { stage, tick } = harness({ ups: 120, maxUpdatesPerFrame: 1 });
  const updates = [], renders = [];
  Scheduler.replace(stage,{ update: context => updates.push(Data.get(context, 'dt')), render: context => renders.push(Data.get(context, 'dt')) });
  tick(0); tick(1000 / 60);
  assert.deepEqual(updates, [1 / 120]);
  Scheduler.configureUps(stage,240);
  tick(1000 / 60); tick(1000 / 60);
  assert.deepEqual(updates, [1 / 120, 1 / 240, 1 / 240]);
  assert.equal(stage.accumulator, 0);
  assert.equal(renders.length, 4);
  for (const ups of [0, -1, Infinity, NaN, '60', null, Number.MIN_VALUE]) assert.throws(() => Scheduler.configureUps(stage,ups), /ups/);
  assert.equal(stage.requestedUps, 240);
});

test('ups changes from an update callback wait until the next frame', () => {
  const { stage, tick } = harness({ ups: 120 });
  const updates = [];
  Scheduler.replace(stage,{ update: context => { updates.push(Data.get(context, 'dt')); Scheduler.configureUps(stage,60); } });
  tick(0); tick(1000 / 60);
  assert.deepEqual(updates, [1 / 120, 1 / 120]);
  tick(2000 / 60);
  assert.deepEqual(updates, [1 / 120, 1 / 120, 1 / 60]);
});
