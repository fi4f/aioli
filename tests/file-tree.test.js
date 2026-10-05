import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTree, toggleFolder, assetKind } from '../file-tree.js';
const files = [
  ['scene.lisp', 'lisp', 'scene'],
  ['lib/math.lisp', 'lisp', 'lib/math.lisp'],
  ['lib/actors/player.lisp', 'lisp', 'lib/actors/player.lisp'],
  ['assets/sprite.png', 'asset', 'assets/sprite.png'],
];
test('project tree groups directories before files and hides collapsed descendants', () => {
  assert.deepEqual(
    projectTree(files, '[]').map((row) => [row[0], row[1], row[4]]),
    [
      ['assets', 'folder', 0],
      ['lib', 'folder', 0],
      ['scene.lisp', 'lisp', 0],
    ],
  );
  const open = toggleFolder('[]', 'lib');
  assert.deepEqual(
    projectTree(files, open).map((row) => row[0]),
    ['assets', 'lib', 'lib/actors', 'lib/math.lisp', 'scene.lisp'],
  );
  const nested = toggleFolder(open, 'lib/actors');
  const player = projectTree(files, nested).find((row) => row[0] === 'lib/actors/player.lisp');
  assert.deepEqual(player, [
    'lib/actors/player.lisp',
    'lisp',
    'lib/actors/player.lisp',
    'player.lisp',
    2,
    false,
    'code',
  ]);
  assert.equal(
    projectTree(files, toggleFolder(nested, 'lib')).some((row) => row[0] === player[0]),
    false,
  );
  assert.equal(
    projectTree(files, toggleFolder(toggleFolder(nested, 'lib'), 'lib')).some(
      (row) => row[0] === player[0],
    ),
    true,
  );
});
test('asset leaves and empty/stale expansion are safe', () => {
  assert.equal(
    projectTree(files, '["assets"]').find((row) => row[0] === 'assets/sprite.png')[1],
    'asset',
  );
  assert.deepEqual(projectTree([], '["missing"]'), []);
  assert.deepEqual(projectTree(files, 'invalid'), projectTree(files, '[]'));
});

test('asset types recognize MIME and filename extensions', () => {
  assert.equal(assetKind('sprite.data', 'asset', 'image/png'), 'image');
  assert.equal(assetKind('sound.wav', 'asset'), 'audio');
  assert.equal(assetKind('scene.lisp', 'lisp'), 'code');
  assert.equal(assetKind('notes.bin', 'asset'), 'asset');
});
