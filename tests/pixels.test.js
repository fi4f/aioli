import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lisp.js';
import { engineServices } from '../engine-services.js';
import { launchApplication } from '../application.js';
import { stageScene } from '../scenes.js';
import { previewHook } from '../hook-preview.js';
import { GPUHost, deviceCommands, displayMetrics } from '../gpu.js';
import { DrawList } from '../drawing.js';

const art = `(init! :gain 0.25)
(defdraw plasma [speed center] ["Plasma" [2 [8 9]] [64 48]]
  (pixels [p time]
    (let [shade (* speed (get :gain))]
      (rgba shade (/ p.x width) (/ center.y height) 0.5))))
(defdraw render []
  (background "#101010")
  (scope (clip [10 20] [40 30]) (translate [10 20]) (scale 0.5) (opacity 0.4)
    (plasma 2 [8 9]))
  (fill "#ff0000") (rect [20 20] [4 4]))`;
function boot(source = art, state = {}) {
  return launchApplication({ files: { 'main.lisp': source }, state,
    makeRuntime: s => engineServices({size:()=>[160,120]}).create(s) });
}

test('primary render composes commands and pixel materials in painter order with scoped transforms', () => {
  const runtime = boot(), list = runtime.drawFrame(160, 120);
  assert.deepEqual(list.commands.map(c=>c.meta[0]), [0,8,0]);
  const command = list.commands[1];
  assert.deepEqual(command.bounds, [10,20,80,60]);
  assert.deepEqual(command.clip, [10,20,40,30]);
  assert.deepEqual(command.detail, [160,120,0.4,0]);
  assert.deepEqual(Object.values(command.pixel.values), [2,0.25,9]);
  assert.match(command.pixel.shader.pixelBody, /u\.data/);
  const next = new DrawList(800,600); next.composite(list,[0,0],[320,240]);
  assert.deepEqual(next.commands[1].bounds, [20,40,160,120]);
  assert.deepEqual(next.commands[1].detail, command.detail);
  assert.deepEqual(deviceCommands(next.commands, displayMetrics(800,600,1.25))[1].detail, command.detail);
});

test('pixel capture values change without recompiling and independent invocations do not alias uniforms', () => {
  const runtime = boot(art + '\n(defdraw render [] (plasma 2 [8 9]) (plasma 3 [8 9]))');
  const first = runtime.drawFrame(160,120);
  assert.equal(first.commands[0].pixel.shader, first.commands[1].pixel.shader);
  assert.notDeepEqual(first.commands[0].pixel.values, first.commands[1].pixel.values);
  runtime.state.gain = 0.75;
  const second = runtime.drawFrame(160,120);
  assert.equal(first.commands[0].pixel.shader, second.commands[0].pixel.shader);
  assert.equal(second.commands[0].pixel.values.capture1, 0.75);
  const source = GPUHost.prototype.pixelSource.call({}, first);
  assert.equal(source.programs.length, 1);
  assert.match(source.source, /fn pixelEffect0/);
  assert.match(source.source, /pixelData\[base/);
  assert.doesNotMatch(source.source, /u\.data/);
});

test('pixel blocks support colors, vectors, state parameters and shader locals without executing CPU effects', () => {
  const runtime = boot(`(init! :radius 5)
    (defdraw render [] (pixels [p time] (fill "#ffffff")
      (let [r (param :radius)] (circle [10 10] r)))
      (pixels [p time] "#00ff00"))`);
  assert.equal(runtime.drawFrame().commands.length,2);
  const vector = boot('(defdraw render [] (let [c [0.2 0.3 0.4]] (pixels [p time] c)))');
  assert.equal(vector.drawFrame().commands[0].pixel.shader.params.length,3);
  for (const body of ['(set! :changed 999)', '(play-sound)', '(resource-url "x.png")']) {
    const r=boot(`(init! :changed 7) (defdraw render [] (pixels [p time] ${body}))`);
    assert.throws(()=>r.drawFrame(), /pixels: .*CPU operation/);
    assert.equal(r.state.changed,7);
  }
  assert.throws(()=>boot('(defdraw render [] (pixels [x t] (rgb 1 0 0)))').drawFrame(), /pixels \[p time\]/);
});

test('scenes own their render hook and imported pixel drawables preview against private state', () => {
  const application=boot('(defdraw render [] (fill "#ff0000") (rect [0 0] [10 10]))');
  const files={'scene.lisp':'(import "art.lisp")','art.lisp':art};
  const scene=stageScene(files,'scene.lisp',application,()=>engineServices().create({}));
  assert.deepEqual(scene.runtime.drawFrame().commands.map(c=>c.meta[0]),[0,8,0]);
  const live={gain:0.6};
  const preview=previewHook({files,path:'art.lisp',name:'plasma',state:live});
  assert.deepEqual(preview.draw.commands[0].detail.slice(0,2),[64,48]);
  assert.equal(live.gain,0.6);
  assert.equal(preview.draw.commands[0].pixel.values.capture1,0.6);
});
