import { Data } from './data.js';
import { Promises } from './promises.js';
import { Contracts } from './contracts.js';
import { zip } from './zip.js';

const __promise__ = (work) => Promises.registerPromise(Promise.resolve().then(work));
function __bytes__(resource) {
  if (!resource || typeof resource.data !== 'string')
    throw new TypeError('Resource contents must be a string');
  if (resource.encoding === 'utf8') return new TextEncoder().encode(resource.data);
  if (
    resource.encoding !== 'base64' ||
    typeof resource.data !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(resource.data)
  )
    throw new TypeError('Invalid resource encoding');
  return Uint8Array.from(atob(resource.data), (c) => c.charCodeAt(0));
}
function __base64__(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 16384)
    result += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(result);
}
function __pickFiles__({ directory = false, multiple = false, accept = '' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = multiple; input.accept = accept;
    if (directory) input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
    input.addEventListener('change', () => {
      const files = Array.from(input.files);
      input.remove(); resolve(files.length ? files : null);
    }, { once: true });
    try { input.click(); } catch (error) { input.remove(); reject(error); }
  });
}
async function __readFile__(file, path) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { path, kind: 'file', resource: { status: 200, ok: true,
    mime: file.type || 'application/octet-stream', encoding: 'base64', data: __base64__(bytes), size: bytes.length } };
}
function __download__(name, blob) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link);
  try { link.click(); } finally {
    link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return null;
}
export function resourceResponse(resource) {
  if (resource instanceof Response) return resource;
  const status = resource.status ?? 200;
  return new Response([204, 205, 304].includes(status) ? null : __bytes__(resource), {
    status,
    headers: { ...resource.headers, 'Content-Type': resource.mime || 'application/octet-stream' },
  });
}
export const Resources = Data.registerHostData({
  withOrigin: Contracts.withOrigin,
  require(condition, message) {
    if (!condition) throw new Error(message);
    return true;
  },
  now: () => Date.now(),
  copyText(text) {
    return Promises.registerPromise((async () => {
      if (typeof text !== 'string') throw new TypeError('copyText expects a string');
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(text);
      return true;
    })());
  },
  resolve: (reference, base) => new URL(reference, base).href,
  path: (url) => decodeURIComponent(new URL(url).pathname),
  directoryURL(url) {
    const value = new URL(url);
    if (!['http:', 'https:'].includes(value.protocol))
      throw new TypeError('Asset base URL must use HTTP or HTTPS');
    if (!value.pathname.endsWith('/')) value.pathname += '/';
    value.hash = '';
    value.search = '';
    return value.href;
  },
  owns: (url, base) => {
    const candidate = new URL(url),
      root = new URL(base);
    return candidate.protocol === root.protocol && candidate.host === root.host;
  },
  fetch(url) {
    return __promise__(async () => {
      const response = await fetch(url, { cache: 'no-store' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        url: response.url,
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers),
        mime: response.headers.get('content-type') || '',
        encoding: 'base64',
        data: __base64__(bytes),
        size: bytes.length,
      };
    });
  },
  text: (resource) => new TextDecoder('utf-8', { fatal: true }).decode(__bytes__(resource)),
  bytes: (resource) => Array.from(__bytes__(resource)),
  fromText(text, mime = 'text/plain;charset=utf-8') {
    if (typeof text !== 'string' || typeof mime !== 'string')
      throw new TypeError('Expected text and MIME strings');
    return {
      status: 200,
      ok: true,
      mime,
      encoding: 'utf8',
      data: text,
      size: new TextEncoder().encode(text).length,
    };
  },
  fromBytes(bytes, mime = 'application/octet-stream') {
    if (
      !Array.isArray(bytes) ||
      Array.from(bytes).some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      throw new TypeError('Expected a list of bytes');
    return {
      status: 200,
      ok: true,
      mime,
      encoding: 'base64',
      data: __base64__(Uint8Array.from(bytes)),
      size: bytes.length,
    };
  },
  validate(resource) {
    if (typeof resource.mime !== 'string' || typeof resource.data !== 'string')
      throw new TypeError('Invalid resource data');
    const size = __bytes__(resource).length;
    if (resource.size != null && resource.size !== size)
      throw new TypeError('Incorrect resource size');
    resource.size = size;
    return resource;
  },
  openText() {
    return Promises.registerPromise((async () => {
      const files = await __pickFiles__({ accept: '.json,application/json' });
      return files ? { name: files[0].name, text: await files[0].text() } : null;
    })());
  },
  openFiles(directory = false) {
    return Promises.registerPromise((async () => {
      try {
        if (directory && globalThis.showDirectoryPicker) {
          const root = await globalThis.showDirectoryPicker({ mode: 'read' }), entries = [];
          const visit = async (handle, path) => {
            if (handle.kind === 'file') entries.push(await __readFile__(await handle.getFile(), path));
            else {
              entries.push({ path, kind: 'directory' });
              for await (const child of handle.values()) await visit(child, `${path}/${child.name}`);
            }
          };
          await visit(root, root.name);
          return entries;
        }
        const files = await __pickFiles__({ directory, multiple: true });
        return files ? await Promise.all(files.map(file => __readFile__(file,
          directory ? file.webkitRelativePath : file.name))) : null;
      } catch (error) {
        if (error.name === 'AbortError') return null;
        throw error;
      }
    })());
  },
  download(name, text) {
    return __download__(name, new Blob([text], { type: 'application/json' }));
  },
  downloadFile(name, resource) {
    return __download__(name, new Blob([__bytes__(resource)], { type: resource.mime }));
  },
  downloadArchive(name, entries) {
    return __download__(name, zip(entries.map(entry => ({ path: entry.path,
      directory: entry.kind === 'directory', modified: entry.modified,
      bytes: entry.kind === 'file' ? __bytes__(entry.resource) : undefined }))));
  },
});
