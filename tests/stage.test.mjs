import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../engine/compiler/compiler.js';
import { forms } from '../engine/compiler/forms.js';
import { arithmetic } from '../engine/language/arithmetic.js';
import { Stage } from '../engine/runtime/stage.js';
import { dict, get } from '../engine/language/data.js';

function harness(options = {}) {
  let nextId = 0;
  const frames = new Map(), errors = [];
  const stage = new Stage({
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

test('update and render receive fresh dictionaries with independent clocks and current dimensions', () => {
  const dimensions = { w: 320, h: 200 };
  const { stage, tick } = harness({ updateHz: 10, maxUpdatesPerFrame: 2, dimensions: () => dimensions });
  const updated = [], rendered = [];
  stage.replace({ update: context => updated.push(context), render: context => rendered.push(context) });
  tick(0); tick(350);
  assert.equal(get(rendered[0], 't'), 0);
  assert.equal(get(rendered[0], 'dt'), 0);
  assert.equal(get(updated[0], 'dt'), 0.1);
  assert.equal(get(updated[0], 't'), 0.1);
  assert.equal(get(updated[1], 't'), 0.2);
  assert.equal(get(rendered[1], 't'), 0.35);
  assert.equal(get(rendered[1], 'dt'), 0.35);
  assert.equal(get(updated[0], 'w'), 320);
  assert.equal(get(updated[0], 'h'), 200);
  dimensions.w = 640; dimensions.h = 480;
  tick(450);
  assert.equal(get(updated.at(-1), 't'), 0.4);
  assert.equal(get(updated.at(-1), 'w'), 640);
  assert.equal(get(rendered.at(-1), 'h'), 480);
  assert.equal(get(updated[0], 'w'), 320);
  assert.notEqual(updated[0], updated[1]);
  assert.notEqual(rendered[0], rendered[1]);
  stage.replace({ update: context => updated.push(context), render: context => rendered.push(context) });
  tick(9999); tick(10099);
  assert.equal(get(updated.at(-1), 't'), 0.1);
  assert.equal(get(rendered.at(-2), 't'), 0);
});

test('callbacks share scene data, fresh per execution in both modes', () => {
  for (const trace of [true, false]) {
    const output = [];
    const program = compile(`
      (let time 0)
      (on attach () (print "attach"))
      (on update (context) (set time (+ time context.dt)))
      (on render () (print time))
      (on detach () (print "detach"))
    `, { ...arithmetic, print: v => output.push(v) }, forms, { scene: true, trace });
    const a = program.run(), b = program.run();
    a.attach(); a.update(dict('dt', 0.5)); a.render(); b.render(); a.detach();
    assert.deepEqual(output, ['attach', 0.5, 0, 'detach']);
  }
});

test('invalid callback declarations fail compilation', () => {
  for (const source of ['(on nope ())', '(on update ()) (on update ())',
    '{(on render ())}', '(fn () (on attach ()))', '(on update dt)',
    '(on render (a b))', '(on attach (dt))', '(on update (a b))', '(on 1 ())', '(on update (1))']) {
    assert.throws(() => compile(source, {}, forms, { scene: true }), SyntaxError);
  }
  assert.throws(() => compile('(on render ())', {}, forms), SyntaxError);
});

test('fixed steps accumulate across frames; rendering follows updates', () => {
  const { stage, tick } = harness({ updateHz: 120 });
  const events = [], intervals = [];
  stage.replace({ attach: () => events.push('attach'),
    update: context => { events.push('update'); intervals.push(get(context, 'dt')); }, render: () => events.push('render') });
  tick(0); tick(4); tick(20); tick(25);
  assert.deepEqual(events, ['attach', 'render', 'render', 'update', 'update', 'render', 'update', 'render']);
  assert.deepEqual(intervals, [1 / 120, 1 / 120, 1 / 120]);
});

test('render receives variable frame dt independently of fixed updates', () => {
  const { stage, tick } = harness({ updateHz: 120, maxUpdatesPerFrame: 1 });
  const rendered = [], updated = [];
  const scene = compile('(on update (context) (update-time context.dt)) (on render (context) (render-time context.dt))', {
    'update-time': dt => updated.push(dt), 'render-time': dt => rendered.push(dt),
  }, forms, { scene: true }).run();
  stage.replace(scene);
  tick(100); tick(104); tick(124); tick(124);
  assert.deepEqual(rendered, [0, 0.004, 0.02, 0]);
  assert.deepEqual(updated, [1 / 120, 1 / 120]);
  stage.replace(scene);
  tick(9999);
  assert.equal(rendered.at(-1), 0);
});

test('catch-up is bounded without dropping accumulated time', () => {
  const { stage, tick } = harness({ updateHz: 10, maxUpdatesPerFrame: 2 });
  let updates = 0, renders = 0;
  stage.replace({ update: () => updates++, render: () => renders++ });
  tick(0); tick(500);
  assert.equal(updates, 2);
  tick(500); tick(500);
  assert.equal(updates, 5); assert.equal(renders, 4);
});

test('replacement calls detach/attach once and resets timing', () => {
  const { stage, tick, frames } = harness();
  const events = [];
  stage.replace({ attach: () => events.push('a+'), detach: () => events.push('a-') });
  tick(0);
  stage.replace({ attach: () => events.push('b+'), detach: () => events.push('b-'), update: () => events.push('update') });
  tick(9999);
  stage.replace(null); stage.replace(null);
  assert.deepEqual(events, ['a+', 'a-', 'b+', 'b-']); assert.equal(frames.size, 0);
});

test('callback failures stop frames and report once', () => {
  const { stage, tick, frames, errors } = harness();
  const error = new Error('render failed');
  stage.replace({ render() { throw error; } }); tick(0);
  assert.deepEqual(errors, [error]); assert.equal(frames.size, 0);
  assert.throws(() => stage.replace({ attach() { throw error; } }), /render failed/);
  assert.equal(stage.scene, null);
});

test('invalid timing settings are rejected', () => {
  for (const updateHz of [0, -1, Infinity, NaN, '60']) assert.throws(() => harness({ updateHz }), TypeError);
  assert.throws(() => harness({ maxUpdatesPerFrame: 0 }), TypeError);
});

test('ups changes preserve accumulated backlog and rendering follows every browser frame', () => {
  const { stage, tick } = harness({ ups: 120, maxUpdatesPerFrame: 1 });
  const updates = [], renders = [];
  stage.replace({ update: context => updates.push(get(context, 'dt')), render: context => renders.push(get(context, 'dt')) });
  tick(0); tick(1000 / 60);
  assert.deepEqual(updates, [1 / 120]);
  stage.configureUps(240);
  tick(1000 / 60); tick(1000 / 60);
  assert.deepEqual(updates, [1 / 120, 1 / 240, 1 / 240]);
  assert.equal(stage.accumulator, 0);
  assert.equal(renders.length, 4);
  for (const ups of [0, -1, Infinity, NaN, '60', null, Number.MIN_VALUE]) assert.throws(() => stage.configureUps(ups), /ups/);
  assert.equal(stage.requestedUps, 240);
});

test('ups changes from an update callback wait until the next frame', () => {
  const { stage, tick } = harness({ ups: 120 });
  const updates = [];
  stage.replace({ update: context => { updates.push(get(context, 'dt')); stage.configureUps(60); } });
  tick(0); tick(1000 / 60);
  assert.deepEqual(updates, [1 / 120, 1 / 120]);
  tick(2000 / 60);
  assert.deepEqual(updates, [1 / 120, 1 / 120, 1 / 60]);
});
