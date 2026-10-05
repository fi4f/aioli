import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateEditorLayout } from '../editor-layout.js';
import { readProject, projectSnapshot } from '../project.js';
import { resolveModules } from '../module-loader.js';

test('saved editor layout migrates imports, customized icons, commands and workspace paths together', () => {
  const oldIcon = 'assets/editor-icons/code.png';
  const custom = { data: 'data:image/png;base64,AQ==', source: oldIcon };
  const loaded = readProject(
    {
      version: 14,
      files: {
        'main.lisp': '(import "./ui/components.lisp")',
        'game.lisp': '(start-scene "examples/garden.scene.lisp")',
        'ui/components.lisp': '(import "./buttons.lisp")',
        'ui/buttons.lisp':
          '(defn custom-button [] (icon "assets/editor-icons/code.png" [0 0] [16 16]))',
        'commands/center-player.command.lisp':
          '; Run explicitly from the command palette.\n(set! :x 160)\n(set! :y 190)\n(set! :vy 0)',
        'generators/custom.generator.lisp': '(defn draw [] nil)',
      },
      resources: { [oldIcon]: custom },
      state: {
        tab: 'ui/buttons.lisp',
        'open-tabs': '["main","ui/buttons.lisp"]',
        'open-folders': '["ui","commands","assets/editor-icons"]',
        'project-folders': '["commands/empty"]',
        'active-generator': 'generators/custom.generator.lisp',
      },
      applicationState: { 'active-scene': 'examples/garden.scene.lisp' },
    },
    {},
    { 'editor/icon/code.png': { data: 'data:image/png;base64,AA==' } },
  );
  assert.equal(loaded.resources[oldIcon], undefined);
  assert.deepEqual(loaded.resources['editor/icon/code.png'], {
    ...custom,
    source: 'editor/icon/code.png',
  });
  assert.match(loaded.sources['editor/ui/buttons.lisp'], /editor\/icon\/code.png/);
  assert.match(loaded.sources['examples/commands/center-player.command.lisp'], /game-set!/);
  assert.equal(loaded.state.tab, 'editor/ui/buttons.lisp');
  assert.deepEqual(JSON.parse(loaded.state['open-tabs']), ['main', 'editor/ui/buttons.lisp']);
  assert.deepEqual(JSON.parse(loaded.state['open-folders']), [
    'editor/ui',
    'examples/commands',
    'editor/icon',
  ]);
  assert.equal(loaded.state['active-generator'], 'examples/generators/custom.generator.lisp');
  assert.equal(JSON.parse(loaded.state['project-folders'])[0], 'examples/commands/empty');
  resolveModules(loaded.sources, ['main']);
  const again = readProject(
    projectSnapshot(loaded.sources, loaded.state, loaded.resources, false, loaded.applicationState),
    {},
  );
  assert.deepEqual(again.resources, loaded.resources);
});

test('layout migration preserves occupied destinations and customized commands', () => {
  const loaded = migrateEditorLayout(
    {
      main: '(import "./ui/custom.lisp")',
      'ui/custom.lisp': '; original',
      'editor/ui/custom.lisp': '; destination',
      'commands/center-player.command.lisp': '(set! :custom true)',
    },
    {},
    { 'open-tabs': '["ui/custom.lisp"]' },
    {},
  );
  assert.equal(loaded.sources['ui/custom.lisp'], '; original');
  assert.equal(loaded.sources['editor/ui/custom.lisp'], '; destination');
  assert.equal(loaded.sources.main, '(import "./ui/custom.lisp")');
  assert.equal(
    loaded.sources['examples/commands/center-player.command.lisp'],
    '(set! :custom true)',
  );
});

test('intermediate editor generator saves move into examples without changing custom recipes', () => {
  const loaded = readProject(
    {
      version: 15,
      files: {
        'main.lisp': '',
        'game.lisp': '',
        'editor/generators/custom.generator.lisp': '; custom recipe',
      },
      state: { 'active-generator': 'editor/generators/custom.generator.lisp' },
    },
    {},
  );
  assert.equal(loaded.sources['examples/generators/custom.generator.lisp'], '; custom recipe');
  assert.equal(loaded.state['active-generator'], 'examples/generators/custom.generator.lisp');
});

test('version 16 editor command samples migrate to examples with imports and selections', () => {
  const loaded = readProject(
    {
      version: 16,
      files: {
        'main.lisp': '(import "./editor/commands/helper.command.lisp")',
        'game.lisp': '',
        'editor/commands/helper.command.lisp': '(defn helper [] 1)',
      },
      state: { tab: 'editor/commands/helper.command.lisp' },
    },
    {},
  );
  assert.equal(loaded.state.tab, 'examples/commands/helper.command.lisp');
  assert.equal(loaded.sources['examples/commands/helper.command.lisp'], '(defn helper [] 1)');
  resolveModules(loaded.sources, ['main']);
});
