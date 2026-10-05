import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lisp.js';
import { inspectorFields, liveFields } from '../inspector-fields.js';

test('live scene fields retain declared limits and stable inferred limits without clamping simulation state', () => {
  const state = { radius: 22, timer: 4, 'active-scene': 'level.lisp' };
  const declared = inspectorFields('level.lisp', parse('(init! :radius 20 ["Radius" 5 80 0.5])'));
  const fields = liveFields(declared, state);
  assert.equal(fields.find((field) => field.key === 'radius').step, 0.5);
  assert.equal(fields.find((field) => field.key === 'timer').high, 8);
  state.timer = 100;
  assert.equal(liveFields(declared, state).find((field) => field.key === 'timer').high, 8);
  assert.equal(state.timer, 100);
  assert.equal(
    fields.some((field) => field.key === 'active-scene'),
    false,
  );
});
