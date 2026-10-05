import test from 'node:test';
import assert from 'node:assert/strict';
import { planFileMove } from '../file-moves.js';
import { resolveModules } from '../module-loader.js';

test('file moves preserve imported dependencies, scene references and comments', () => {
  const sources = {
    main: '',
    game: '(import "./lib/helper.lisp") (start-scene "lib/level.scene.lisp")',
    'lib/helper.lisp': '(defn helper [] 7)',
    'lib/level.scene.lisp':
      '(import ; dependency\n "./helper.lisp")\n; keep lib/level.scene.lisp\n(defn render [] (helper))',
  };
  const plan = planFileMove(sources, {}, 'lib/level.scene.lisp', 'examples/level.scene.lisp');
  assert.ok(plan.sources.game.includes('examples/level.scene.lisp'));
  assert.ok(plan.sources['examples/level.scene.lisp'].includes('../lib/helper.lisp'));
  assert.ok(plan.sources['examples/level.scene.lisp'].includes('; keep lib/level.scene.lisp'));
  assert.equal(
    resolveModules(plan.sources, ['examples/level.scene.lisp'])[0].path,
    'lib/helper.lisp',
  );
  assert.ok(sources['lib/level.scene.lisp']);
  const helper = planFileMove(plan.sources, {}, 'lib/helper.lisp', 'examples/helper.lisp');
  assert.ok(helper.sources.game.includes('./examples/helper.lisp'));
  assert.ok(helper.sources['examples/level.scene.lisp'].includes('./helper.lisp'));
});
test('asset moves update literal paths without losing data, and reject collisions and entry moves', () => {
  const resources = { 'assets/code.png': { mime: 'image/png', data: 'original' } };
  const moved = planFileMove(
    { main: '(icon "assets/code.png" [0 0] [16 16])' },
    resources,
    'assets/code.png',
    'images/code.png',
  );
  assert.equal(moved.resources['images/code.png'].data, 'original');
  assert.ok(moved.sources.main.includes('images/code.png'));
  assert.ok(resources['assets/code.png']);
  assert.throws(
    () => planFileMove({ main: '', game: '' }, {}, 'game.lisp', 'examples/game.lisp'),
    /entry/,
  );
  assert.throws(
    () => planFileMove({ main: '', 'a.lisp': '', 'b.lisp': '' }, {}, 'a.lisp', 'b.lisp'),
    /exists/,
  );
});
