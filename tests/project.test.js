import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSource } from '../source-text.js';
import { createRuntime } from '../lisp.js';
import { defaults as examples } from '../examples.js';
import { editorSourcePaths } from '../editor-sources.js';
import { generatorSources } from '../generators.js';
import {
  resolvePath,
  resolveModules,
  cpuForms,
  pixelHook,
  projectSnapshot,
  readProject,
} from '../project.js';
import { compileShader } from '../shader.js';

const defaults = {
  ...examples,
  ui: readFileSync(new URL('../ui.lisp', import.meta.url), 'utf8'),
  editor: readFileSync(new URL('../editor.lisp', import.meta.url), 'utf8'),
  ...generatorSources,
  ...Object.fromEntries(
    editorSourcePaths.map((path) => [
      path,
      readFileSync(new URL('../' + path, import.meta.url), 'utf8'),
    ]),
  ),
};
test('imports resolve relative and project-root paths, deduplicating shared dependencies', () => {
  const sources = {
    game: '(import "./lib/actor.lisp") (import "/lib/math.lisp") (init! :answer (answer))',
    'lib/actor.lisp': '(import "../lib/math.lisp") (defn answer [] (twice 21))',
    'lib/math.lisp': '(init! :loads 0) (set! :loads (+ (get :loads) 1)) (defn twice [x] (* x 2))',
  };
  const modules = resolveModules(sources, ['game']);
  assert.deepEqual(
    modules.map((module) => module.path),
    ['lib/math.lisp', 'lib/actor.lisp', 'game.lisp'],
  );
  const state = {},
    runtime = createRuntime(state);
  modules.forEach((module) => runtime.load(cpuForms(module.forms)));
  assert.equal(state.answer, 42);
  assert.equal(state.loads, 1);
});
test('imports reject missing files, cycles, malformed imports and escaping paths', () => {
  assert.throws(
    () => resolveModules({ scene: '(import "missing.lisp")' }, ['scene']),
    /Missing import missing.lisp from scene.lisp/,
  );
  assert.throws(
    () =>
      resolveModules({ scene: '(import "a.lisp")', 'a.lisp': '(import "scene.lisp")' }, ['scene']),
    /Import cycle/,
  );
  assert.throws(() => resolveModules({ scene: '(import :oops)' }, ['scene']), /use \(import/);
  assert.throws(() => resolvePath('../../secret.lisp', 'lib/a.lisp'), /escapes/);
  assert.throws(() => resolvePath('https://example.com/source.lisp'), /Invalid/);
});
test('mixed scenes evaluate CPU forms and compile only a single reachable pixel hook', () => {
  const sources = {
    scene:
      '(import "render/pixels.lisp") (init! :r 16) (defn scene-update [dt] (set! :r (+ (get :r) dt)))',
    'render/pixels.lisp':
      '(defpixel scene [p time] (background "#000000") (fill "#ffffff") (circle [160 120] (param :r)))',
  };
  const modules = resolveModules(sources, ['scene']);
  const state = {},
    runtime = createRuntime(state);
  modules.forEach((module) => runtime.load(cpuForms(module.forms)));
  runtime.call('scene-update', 2);
  assert.equal(state.r, 18);
  assert.equal(compileShader(pixelHook(modules), state).params[0].key, 'r');
  assert.throws(
    () =>
      pixelHook(
        resolveModules(
          {
            ...sources,
            scene: sources.scene + ' (defpixel other [p time] (background "#000000"))',
          },
          ['scene'],
        ),
      ),
    /exactly one/,
  );
});
test('v3 saves preserve extra source files and binary assets while excluding transient input', () => {
  const sources = {
    ...defaults,
    'lib/helper.lisp': '(defn helper [] 1)',
    __palette: '(set! :x 0)',
  };
  const resources = {
    'assets/example.png': { mime: 'image/png', data: 'data:image/png;base64,AAAA' },
  };
  const snapshot = projectSnapshot(sources, { x: 7 }, resources);
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.files.__palette, undefined);
  const imported = readProject(JSON.parse(JSON.stringify(snapshot)), defaults);
  assert.equal(imported.sources['lib/helper.lisp'], sources['lib/helper.lisp']);
  assert.deepEqual(imported.resources, resources);
  assert.equal(imported.state.x, 7);
  assert.equal(
    readProject(projectSnapshot(sources, { x: 7 }, resources, true), defaults).recovery,
    true,
  );
});
test('a stock widget library inside an existing v3 save is upgraded by content', () => {
  const oldUI = defaults.ui.split('; Shared window shell')[0];
  const saved = projectSnapshot({ ...defaults, ui: oldUI }, { x: 4 });
  assert.equal(readProject(saved, defaults).sources.ui, normalizeSource(defaults.ui));
  saved.files['ui.lisp'] = oldUI + '\n; human customization';
  assert.equal(readProject(saved, defaults).sources.ui, normalizeSource(saved.files['ui.lisp']));
});
test('v2 migration retains custom source and state and installs generator files', () => {
  const source = { ...examples, editor: defaults.editor + '\n; customized', ui: defaults.ui };
  const migrated = readProject({ version: 2, sources: source, state: { x: 17 } }, defaults);
  assert.equal(migrated.sources.editor, normalizeSource(source.editor));
  assert.equal(migrated.state.x, 17);
  assert.ok(migrated.sources['generators/image.lisp']);
  assert.throws(
    () =>
      readProject(
        {
          version: 3,
          files: { ...projectSnapshot(defaults, {}).files, '../bad.lisp': '' },
          state: {},
        },
        defaults,
      ),
    /escapes/,
  );
});

test('project loading and saving normalize source newlines without replacing Unicode', () => {
  const text = '; \u{1f642}\r\n(defn example [] "\u00e9")\r';
  const saved = projectSnapshot({ ...defaults, 'lib/line-endings.lisp': text }, {});
  assert.equal(saved.files['lib/line-endings.lisp'], '; \u{1f642}\n(defn example [] "\u00e9")\n');
  saved.files['lib/line-endings.lisp'] = text;
  const loaded = readProject(saved, defaults);
  assert.equal(
    loaded.sources['lib/line-endings.lisp'],
    '; \u{1f642}\n(defn example [] "\u00e9")\n',
  );
});
