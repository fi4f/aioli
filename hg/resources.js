import { Data } from './data.js';
import { Promises } from './promises.js';
import { Contracts } from './contracts.js';

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
    return __promise__(
      () =>
        new Promise((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json,application/json';
          input.style.display = 'none';
          document.body.append(input);
          input.addEventListener(
            'cancel',
            () => {
              input.remove();
              resolve(null);
            },
            { once: true },
          );
          input.addEventListener(
            'change',
            async () => {
              try {
                resolve(
                  input.files[0]
                    ? { name: input.files[0].name, text: await input.files[0].text() }
                    : null,
                );
              } catch (error) {
                reject(error);
              } finally {
                input.remove();
              }
            },
            { once: true },
          );
          input.click();
        }),
    );
  },
  download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return null;
  },
});
