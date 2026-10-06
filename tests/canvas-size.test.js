import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasSize } from '../canvas-size.js';
import { engineServices } from '../engine-services.js';
import { parse } from '../lisp.js';
import { compilePixelShader } from '../shader.js';
import { projectSnapshot, readProject } from '../project.js';
import { DrawList } from '../drawing.js';

test('canvas dimensions validate and round-trip through project settings without exposing editor state', () => {
  assert.deepEqual(canvasSize(), [320, 240]);
  const settings = { 'canvas-width': 641, 'canvas-height': 359 };
  const saved = projectSnapshot({ main: '', game: '' }, settings);
  assert.deepEqual(canvasSize(readProject(saved, {}).state), [641, 359]);
  for (const width of [0, 15, 2049, 3.5, '640', NaN, Infinity])
    assert.throws(() => canvasSize({ 'canvas-width': width }), /whole numbers/);
  const game = engineServices({ size: () => canvasSize(settings) }).create({});
  game.load(parse('(init! :cw (canvas-width)) (init! :ch (canvas-height))'));
  assert.deepEqual([game.state.cw, game.state.ch], [641, 359]);
  assert.equal('canvas-width' in game.state, false);
});

test('shader dimensions use GPU size uniforms through symbols and canvas accessors', () => {
  const shader = compilePixelShader(
    parse(`(background "#000000")
    (circle [(/ (canvas-width) 2) (/ height 2)] (/ (canvas-height) 4))`),
  );
  assert.match(shader.code, /u\.data\[0\]\.y/);
  assert.match(shader.code, /u\.data\[0\]\.z/);
  assert.deepEqual(shader.params, []);
});

test('game surfaces preserve logical commands until rendered into their pixel buffer', () => {
  const game = new DrawList(64, 64);
  game.circle([32, 32], 20);
  const host = new DrawList(1000, 800);
  host.rasterComposite(game, [20, 30], [512, 512]);
  assert.equal(host.commands.length, 1);
  assert.deepEqual(host.commands[0].bounds, [20, 30, 512, 512]);
  assert.equal(host.commands[0].surface, game);
  assert.deepEqual(game.commands[0].bounds, [12, 12, 40, 40]);
});
