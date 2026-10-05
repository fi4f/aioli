import { resolvePath } from './module-loader.js';

export async function readAssetSource(path, mime = 'image/png') {
  path = resolvePath(path);
  const response = await fetch(new URL(path, import.meta.url), { cache: 'no-store' });
  if (!response.ok) return null;
  const blob = new Blob([await response.arrayBuffer()], { type: mime });
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Cannot read ${path}`));
    reader.readAsDataURL(blob);
  });
  return { mime, data, source: path };
}
/** Refresh linked bytes without overwriting replaced or deleted resources. */
export async function refreshLinkedAssets(resources, read = readAssetSource) {
  let changed = false;
  await Promise.all(
    Object.entries(resources)
      .filter(([, resource]) => resource.source)
      .map(async ([path, original]) => {
        try {
          const fresh = await read(original.source, original.mime);
          if (resources[path] !== original) return;
          if (!fresh) {
            if (!original.sourceMissing) {
              resources[path] = { ...original, sourceMissing: true };
              changed = true;
            }
          } else if (fresh.data !== original.data || original.sourceMissing) {
            resources[path] = { ...original, ...fresh, sourceMissing: false };
            changed = true;
          }
        } catch {
          /* Temporary network failures keep the last successfully loaded bytes. */
        }
      }),
  );
  return changed;
}
