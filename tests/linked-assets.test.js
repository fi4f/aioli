import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshLinkedAssets } from '../linked-assets.js';

test('disk-linked assets refresh, disappear and recover while embedded assets stay intact', async () => {
  const resources = {
    linked: { source: 'icon.png', mime: 'image/png', data: 'old' },
    embedded: { data: 'custom' },
  };
  const read = async () => ({ source: 'icon.png', mime: 'image/png', data: 'new' });
  assert.equal(await refreshLinkedAssets(resources, read), true);
  assert.equal(resources.linked.data, 'new');
  assert.equal(resources.embedded.data, 'custom');
  assert.equal(await refreshLinkedAssets(resources, read), false);
  assert.equal(await refreshLinkedAssets(resources, async () => null), true);
  assert.equal(resources.linked.sourceMissing, true);
  assert.equal(resources.linked.data, 'new');
  assert.equal(await refreshLinkedAssets(resources, read), true);
  assert.equal(resources.linked.sourceMissing, false);
});

test('in-flight refresh does not resurrect deleted or replaced assets', async () => {
  for (const remove of [true, false]) {
    const resources = { linked: { source: 'icon.png', data: 'old' } };
    let finish;
    const pending = refreshLinkedAssets(
      resources,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    if (remove) delete resources.linked;
    else resources.linked = { data: 'replacement' };
    finish({ source: 'icon.png', data: 'new' });
    assert.equal(await pending, false);
    assert.equal(resources.linked?.data, remove ? undefined : 'replacement');
  }
});
