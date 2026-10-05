import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceIcons } from '../resource-icons.js';
import { readProject, projectSnapshot } from '../project.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
test('resource masks accept arbitrary paths, replace stale decodes, and recycle deleted slots', async () => {
  const uploads = [],
    pending = [];
  const cache = new ResourceIcons(
    (images) => uploads.push(images),
    (resource) => new Promise((resolve) => pending.push({ resource, resolve })),
  );
  const resources = { 'art/custom.png': { mime: 'image/png', data: 'first' } };
  assert.equal(cache.index('art/custom.png', resources), -1);
  resources['art/custom.png'] = { mime: 'image/png', data: 'replacement' };
  assert.equal(cache.index('art/custom.png', resources), -1);
  pending[0].resolve('stale');
  await flush();
  assert.equal(cache.index('art/custom.png', resources), -1);
  pending[1].resolve('current');
  await flush();
  assert.equal(cache.index('art/custom.png', resources), 0);
  assert.deepEqual(uploads.at(-1), ['current']);
  resources['art/renamed.png'] = resources['art/custom.png'];
  delete resources['art/custom.png'];
  assert.equal(cache.index('art/custom.png', resources), -1);
  assert.equal(cache.index('art/renamed.png', resources), -1);
  pending[2].resolve('renamed');
  await flush();
  assert.equal(cache.index('art/renamed.png', resources), 0);
});

test('older projects import bundled images once, preserving customized assets and later deletions', () => {
  const path = 'editor/icon/code.png';
  const icon = { mime: 'image/png', data: 'data:image/png;base64,AA==' };
  const custom = { mime: 'image/png', data: 'data:image/png;base64,AQ==' };
  const defaults = { 'editor/icon/folder.png': icon, [path]: icon };
  const saved = { ...projectSnapshot({ main: '', game: '' }, {}, { [path]: custom }), version: 9 };
  const loaded = readProject(saved, {}, defaults);
  assert.deepEqual(loaded.resources[path], custom);
  assert.deepEqual(loaded.resources['editor/icon/folder.png'], icon);
  delete loaded.resources[path];
  const current = projectSnapshot(loaded.sources, loaded.state, loaded.resources);
  assert.equal(readProject(current, {}, defaults).resources[path], undefined);
  assert.equal(saved.resources['editor/icon/folder.png'], undefined);
});

test('new image icon migrates once while preserving replacements and later deletions', () => {
  const path = 'editor/icon/image.png';
  const icon = { mime: 'image/png', data: 'data:image/png;base64,AA==', source: path };
  const saved = { ...projectSnapshot({ main: '', game: '' }, {}, {}), version: 11 };
  const loaded = readProject(saved, {}, { [path]: icon });
  assert.deepEqual(loaded.resources[path], icon);
  const custom = { mime: 'image/png', data: 'data:image/png;base64,AQ==' };
  saved.resources[path] = custom;
  assert.deepEqual(readProject(saved, {}, { [path]: icon }).resources[path], custom);
  delete loaded.resources[path];
  assert.equal(
    readProject(
      projectSnapshot(loaded.sources, loaded.state, loaded.resources),
      {},
      { [path]: icon },
    ).resources[path],
    undefined,
  );
});

for (const [name, version] of [
  ['generator', 12],
  ['command', 13],
]) {
  test(`new ${name} icon migrates once while preserving replacements and later deletions`, () => {
    const path = `editor/icon/${name}.png`;
    const icon = { mime: 'image/png', data: 'data:image/png;base64,AA==', source: path };
    const saved = { ...projectSnapshot({ main: '', game: '' }, {}, {}), version };
    const loaded = readProject(saved, {}, { [path]: icon });
    assert.deepEqual(loaded.resources[path], icon);
    const custom = { mime: 'image/png', data: 'data:image/png;base64,AQ==' };
    saved.resources[path] = custom;
    assert.deepEqual(readProject(saved, {}, { [path]: icon }).resources[path], custom);
    delete loaded.resources[path];
    assert.equal(
      readProject(
        projectSnapshot(loaded.sources, loaded.state, loaded.resources),
        {},
        { [path]: icon },
      ).resources[path],
      undefined,
    );
  });
}
