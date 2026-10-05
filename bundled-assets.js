import { readAssetSource } from './linked-assets.js';
/** Default disk-linked resources, freshly imported for each new project. */
export const bundledResourcePaths = [
  'audio',
  'image',
  'code',
  'file',
  'folder',
  'play',
  'game',
  'main',
  'scene',
].map((name) => `assets/editor-icons/${name}.png`);
export async function loadBundledResources() {
  const entries = await Promise.all(
    bundledResourcePaths.map(async (path) => {
      const resource = await readAssetSource(path);
      return resource ? [path, resource] : null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean));
}
