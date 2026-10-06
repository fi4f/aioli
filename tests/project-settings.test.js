import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectName, projectSettings } from '../project-settings.js';
import { projectSnapshot, readProject } from '../project.js';
import { exportHTML } from '../html-export.js';

test('project settings validate together and persist while older projects receive a name fallback', () => {
  assert.equal(projectName(), 'Untitled project');
  const settings = projectSettings({
    'project-name': '  Boo Patrol  ',
    'canvas-width': 64,
    'canvas-height': 64,
  });
  assert.equal(settings['project-name'], 'Boo Patrol');
  assert.deepEqual(readProject(projectSnapshot({ main: '', game: '' }, settings)).state, settings);
  for (const name of ['', ' ', 'bad\nname', 'x'.repeat(121), 3])
    assert.throws(() => projectName({ 'project-name': name }), /Project name/);
  assert.throws(
    () => projectSettings({ 'project-name': 'Valid', 'canvas-width': 0 }),
    /Canvas dimensions/,
  );
});

test('HTML export uses the project name as an escaped title and retains the name in settings', async () => {
  const name = 'Crypt </title><script>alert(1)</script> & "friends"';
  const html = await exportHTML(
    { 'game.lisp': '(defdraw render [] nil)' },
    {},
    (path) => readFile(new URL('../' + path, import.meta.url), 'utf8'),
    { 'project-name': name },
  );
  assert.ok(
    html.includes(
      '<title>Crypt &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;friends&quot;</title>',
    ),
  );
  assert.equal((html.match(/<\/title>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.ok(html.includes('project-name'));
});
