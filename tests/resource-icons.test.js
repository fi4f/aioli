import test from 'node:test';
import assert from 'node:assert/strict';
import { readProject, projectSnapshot } from '../project.js';
import { bundledResourcePaths } from '../bundled-assets.js';
import { readFileSync } from 'node:fs';
test('bundled icons are ordinary PNG files and project saves preserve replacements and deletions', () => {
  for (const path of bundledResourcePaths)
    assert.equal(readFileSync(new URL('../' + path, import.meta.url)).readUInt32BE(0), 0x89504e47);
  const icon = { mime: 'image/png', data: 'data:image/png;base64,AA==' };
  const saved = projectSnapshot({ main: '', game: '' }, {}, { 'editor/icon/x.png': icon });
  assert.deepEqual(readProject(saved).resources['editor/icon/x.png'], icon);
  delete saved.resources['editor/icon/x.png'];
  assert.deepEqual(readProject(saved).resources, {});
});
