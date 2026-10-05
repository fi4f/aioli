import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStaticServer } from '../server.js';

const pages = [
  'index.html',
  'language.html',
  'api.html',
  'editor.html',
  'projects.html',
  'contributing.html',
];

async function serve(t, basePath) {
  const server = createStaticServer({ basePath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}${basePath}`;
}

test('documentation directory and every local link work at root and project subpaths', async (t) => {
  for (const basePath of ['/', '/aioli/']) {
    const base = await serve(t, basePath);
    const directory = await fetch(base + 'docs', { redirect: 'manual' });
    assert.equal(directory.status, 302);
    assert.equal(directory.headers.get('location'), basePath + 'docs/');
    for (const page of pages) {
      const url = new URL('docs/' + page, base);
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      const html = await response.text();
      assert.match(html, /<h1>/);
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        const target = new URL(href, url);
        if (target.origin !== url.origin) continue;
        assert.ok(target.pathname.startsWith(basePath), `Link escaped project prefix: ${href}`);
        const linked = await fetch(target);
        assert.equal(linked.status, 200, `${page}: ${href}`);
        if (target.hash) {
          const content = await linked.text();
          assert.ok(content.includes(`id="${target.hash.slice(1)}"`), `Missing anchor ${href}`);
        }
      }
      assert.doesNotMatch(html, /<script/, 'Documentation should not require JavaScript');
    }
    const source = await fetch(base + 'editor.lisp');
    assert.equal(source.status, 200);
    assert.match(await source.text(), /import.*editor\/workspace.lisp/);
    for (const path of (await import('../editor-sources.js')).editorSourcePaths)
      assert.equal((await fetch(base + path)).status, 200, path);
  }
});

test('documented Lisp snippets have balanced, readable syntax', async () => {
  const { parse } = await import('../lisp.js');
  for (const page of pages) {
    const html = await readFile(new URL('../docs/' + page, import.meta.url), 'utf8');
    for (const [, code] of html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)) {
      const decoded = code.replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
      if (!/^\s*[;(]/.test(decoded)) continue;
      assert.doesNotThrow(() => parse(decoded), `Invalid example in ${page}`);
    }
  }
});
