import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSource } from '../source-text.js';
import { createRuntime } from '../lisp.js';
import {
  defaults as examples,
  game as exampleUpdate,
  audio as exampleSound,
  garden,
} from '../examples.js';
import { editorSourcePaths } from '../editor-sources.js';
import { generatorSources } from '../generators.js';
import {
  resolvePath,
  resolveModules,
  cpuForms,
  pixelHook,
  replacePixelHook,
  entryPaths,
  projectSnapshot,
  readProject,
} from '../project.js';
import { compileShader } from '../shader.js';

const defaults = {
  ...examples,
  ui: readFileSync(new URL('../editor/ui/components.lisp', import.meta.url), 'utf8').replaceAll(
    '\"./',
    '\"./editor/ui/',
  ),
  editor: readFileSync(new URL('../main.lisp', import.meta.url), 'utf8'),
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
  assert.equal(snapshot.version, 21);
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
test('a stock widget library inside a save is upgraded by content', () => {
  const oldUI = defaults.ui.split('; Shared window shell')[0];
  const saved = projectSnapshot({ ...defaults, ui: oldUI }, { x: 4 });
  assert.equal(readProject(saved, defaults).sources.ui, normalizeSource(defaults.ui));
  saved.files['ui.lisp'] = oldUI + '\n; human customization';
  assert.equal(readProject(saved, defaults).sources.ui, normalizeSource(saved.files['ui.lisp']));
});
test('v2 migration retains custom source and state and installs generator files', () => {
  const source = { ...examples, editor: defaults.editor + '\n; customized', ui: defaults.ui };
  const migrated = readProject({ version: 2, sources: source, state: { x: 17 } }, defaults);
  assert.equal(
    migrated.sources.main,
    '(import "./editor/ui/components.lisp")\n' +
      normalizeSource(source.editor) +
      '\n(defn draw [] (editor))',
  );
  assert.equal(migrated.state.x, 17);
  assert.ok(migrated.sources['examples/generators/image.generator.lisp']);
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

test('stock component upgrades preserve custom editor changes', () => {
  const path = 'editor/ui/buttons.lisp';
  // Reconstruct the historical stock prefix, rather than a newly themed custom subset.
  const old = normalizeSource(defaults[path])
    .split('\n; A compact pixel play glyph')[0]
    .replaceAll('(get :ui-hover)', '"#252e29"')
    .replaceAll('(get :ui-button)', '"#191f1b"')
    .replaceAll('(get :ui-active-text)', '"#162019"');
  const stock = projectSnapshot({ ...defaults, [path]: old }, {}, {});
  assert.equal(readProject(stock, defaults).sources[path], normalizeSource(defaults[path]));
  const custom = old + '\n; My custom buttons\n';
  const edited = projectSnapshot({ ...defaults, [path]: custom }, {}, {});
  assert.equal(readProject(edited, defaults).sources[path], custom);
});

test('v4 has only two entry roots and never recreates ordinary modules', () => {
  assert.deepEqual(entryPaths, { main: 'main.lisp', game: 'game.lisp' });
  const main = '(defpixel render [p time] (background "#000000"))';
  const editor = '(defn editor [] (background "#000000"))';
  const loaded = readProject(projectSnapshot({ main, editor }, {}), defaults);
  assert.deepEqual(Object.keys(loaded.sources).sort(), ['editor', 'main']);
  const modules = resolveModules({ ...loaded.sources, scene: '(unknown-call)', audio: '(' }, [
    'main',
    'editor',
  ]);
  assert.equal(modules.length, 2);
  assert.match(
    compileShader(pixelHook(resolveModules(loaded.sources, ['main']), 'render')).code,
    /@fragment/,
  );
  assert.throws(() => readProject(projectSnapshot({ editor }, {}), defaults), /Missing main.lisp/);
});

test('v3 migrates implicit scene/audio loading into imports and a CPU update wrapper', () => {
  const old = {
    game: '(init! :ticks 0) (defn update [dt] (set! :ticks (+ (get :ticks) dt)))',
    scene:
      '(init! :scene-ticks 0) (defn scene-update [dt] (set! :scene-ticks (+ (get :scene-ticks) dt))) (defpixel old-scene [p time] (background "#000000"))',
    audio: '(defn sound [] (voice :sine 440 440 0.1 0.2))',
    ui: defaults.ui,
    editor: defaults.editor,
  };
  const saved = { ...projectSnapshot(old, {}), version: 3 };
  const loaded = readProject(saved, defaults);
  const modules = resolveModules(loaded.sources, ['game']);
  assert.deepEqual(
    modules.map((module) => module.path),
    ['audio.lisp', 'scene.lisp', 'game.lisp'],
  );
  const state = {},
    runtime = createRuntime(state);
  modules.forEach((module) => runtime.load(cpuForms(module.forms)));
  runtime.call('update', 0.5);
  assert.equal(state.ticks, 0.5);
  assert.equal(state['scene-ticks'], 0.5);
  assert.equal(typeof runtime.global.sound, 'function');
  assert.match(compileShader(pixelHook(modules, 'render')).code, /@fragment/);
});

test('named render selection allows other pixel programs and presets preserve CPU comments', () => {
  const source =
    '; CPU comment with (parentheses)\n(init! :label "(hello)")\n(defpixel helper [p time] (background "#ffffff"))\n(defpixel render [p time] ; ) ignored\n(background "#000000"))\n; Keep this too\n(defn update [dt] nil)';
  const modules = resolveModules({ game: source }, ['game']);
  assert.equal(pixelHook(modules, 'render').length, 1);
  const replacement = '(defpixel render [p time] (background "#123456"))';
  const changed = replacePixelHook(source, 'render', replacement);
  assert.equal(
    changed,
    source.replace('(defpixel render [p time] ; ) ignored\n(background "#000000"))', replacement),
  );
  assert.throws(
    () =>
      pixelHook(
        resolveModules({ game: '(defpixel other [p time] (background "#000000"))' }, ['game']),
        'render',
      ),
    /defpixel render/,
  );
});

test('v4 game entry migrates to main while customized modules stay intact', () => {
  const source = '(defpixel render [p time] (background "#000000"))';
  const saved = {
    version: 4,
    files: { 'game.lisp': source, 'editor.lisp': '(defn editor [] nil)', 'ui.lisp': '; custom ui' },
    state: { tab: 'game', 'open-tabs': '["game","editor"]' },
  };
  const loaded = readProject(saved, defaults);
  assert.equal(loaded.sources.game, source);
  assert.equal('game' in loaded.sources, true);
  assert.equal(loaded.sources.ui, '; custom ui');
  assert.equal(loaded.state.tab, 'game');
  assert.equal(loaded.state['open-tabs'], '["game","main"]');
});

test('v4 stock UI facade is retired while its imports move into ui/', () => {
  const saved = {
    version: 4,
    files: {
      'game.lisp': '(defpixel render [p time] (background "#000000"))',
      'editor.lisp': '(import "./ui.lisp") (defn editor [] nil)',
      'ui.lisp': defaults.ui,
    },
    state: {},
  };
  const loaded = readProject(saved, defaults);
  assert.equal('ui' in loaded.sources, false);
  assert.match(loaded.sources.main, /ui\/components\.lisp/);
  resolveModules(loaded.sources, ['main', 'game']);
});

test('unchanged legacy bundled examples migrate to named scene resources', () => {
  const saved = {
    version: 4,
    files: {
      'game.lisp': '(import "./audio.lisp")\n(import "./scene.lisp")\n' + exampleUpdate,
      'audio.lisp': exampleSound,
      'scene.lisp': garden.replace('(defpixel garden', '(defpixel render'),
      'editor.lisp': '(defn editor [] nil)',
    },
    state: { tab: 'scene', 'open-tabs': '["scene","game","audio"]' },
  };
  const loaded = readProject(saved, defaults);
  assert.equal('scene' in loaded.sources, false);
  assert.equal('audio' in loaded.sources, false);
  assert.ok(loaded.sources.game.includes('start-scene'));
  assert.equal(loaded.state['active-scene'], 'scenes/garden.scene.lisp');
  assert.ok(loaded.sources['scenes/garden.scene.lisp'].includes('defpixel render'));
});
