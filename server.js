import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = path.dirname(modulePath);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.lisp': 'text/plain; charset=utf-8',
};

/**
 * Serve the repository as static files, just as GitHub Pages will.
 * basePath can simulate a Pages project URL such as /aioli/ during local checks.
 * The app does not depend on this server or on server-side routes in production.
 */
export function createStaticServer({ rootDirectory = repositoryRoot, basePath = '/' } = {}) {
  const root = path.resolve(rootDirectory);
  const prefix = '/' + basePath.split('/').filter(Boolean).join('/') + '/';
  const normalizedPrefix = prefix === '//' ? '/' : prefix;

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (normalizedPrefix !== '/' && url.pathname === normalizedPrefix.slice(0, -1)) {
        response.writeHead(302, { Location: normalizedPrefix + url.search }).end();
        return;
      }
      if (!url.pathname.startsWith(normalizedPrefix)) {
        response.writeHead(404).end('Not found');
        return;
      }

      const relativePath = decodeURIComponent(url.pathname.slice(normalizedPrefix.length));
      let file = path.resolve(root, relativePath);
      // Resolve before checking containment; never pass an unchecked path to fs.
      if (file !== root && !file.startsWith(root + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      if ((await stat(file)).isDirectory()) {
        // A trailing slash is required for relative scripts and documentation links.
        if (!url.pathname.endsWith('/')) {
          response.writeHead(302, { Location: url.pathname + '/' + url.search }).end();
          return;
        }
        file = path.join(file, 'index.html');
      }

      const data = await readFile(file);
      response
        .writeHead(200, {
          'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        })
        .end(data);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404).end('Not found');
    }
  });
}

// Importing the server in tests does not open a port. npm start uses this entry.
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const port = Number(process.env.PORT || 4173);
  const basePath = process.env.BASE_PATH || '/';
  createStaticServer({ basePath }).listen(port, '127.0.0.1', () => {
    console.log(`aioli → http://127.0.0.1:${port}${basePath}`);
  });
}
