import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRuntime, parse } from '../lisp.js';
import { layoutUI } from '../ui-layout.js';
import { tabLayout } from '../code-tabs.js';

// A deliberately small Lisp layout prototype: label-only columns with default
// dimensions. It produces the same entries as the native layout for this subset;
// production layout also handles flexible space, nesting, padding and scrolling.
const prototype = createRuntime({}, { budget: 100000 });
prototype.load(
  parse(`
  (defn column-layout [root origin size]
    (let [children (lookup root :children) sizes (mapv (fn [child] [(* (count (lookup child :label)) 8) 18]) children)
          height (+ (reduce (fn [sum child] (+ sum (nth child 1))) 0 sizes) (* (max 0 (- (count children) 1)) 8))
          x (nth origin 0) y (nth origin 1) w (nth size 0) h (nth size 1)]
      (concat [[root origin size [x y w h] height]]
        (mapv (fn [i]
          (let [top (+ y (* i 26))]
            [(nth children i) [x top] [w 18] [x top w (max 0 (- (min (+ top 18) (+ y h)) top))] 18]))
          (range (count children))))))`),
);

function milliseconds(fn, iterations = 100) {
  for (let i = 0; i < 20; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return (performance.now() - start) / iterations;
}

for (const count of [128, 511]) {
  const root = {
    type: 'column',
    children: Array.from({ length: count }, (_, i) => ({ type: 'label', label: `Row ${i}` })),
  };
  const native = () => layoutUI(root, [0, 0], [400, 1000]);
  const lisp = () => prototype.call('column-layout', root, [0, 0], [400, 1000]);
  assert.deepEqual(lisp(), native());
  console.log(
    `${count + 1} components: native ${milliseconds(native).toFixed(3)} ms, Lisp subset ${milliseconds(lisp).toFixed(3)} ms per layout`,
  );
}

const sources = Object.fromEntries(
  Array.from({ length: 256 }, (_, i) => [`file${i}.lisp`, '; source']),
);
const state = { tab: 'file255.lisp', 'open-tabs': Object.keys(sources) };
assert.equal(tabLayout(state, sources, sources, 500).rows.at(-1)[0], 'file255.lisp');
console.log(
  `256 tabs: ${milliseconds(() => tabLayout(state, sources, sources, 500)).toFixed(3)} ms per warm layout`,
);
