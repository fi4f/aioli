import { monochromeMask } from './icon-mask.js';

async function decodeMask(resource) {
  const bitmap = await createImageBitmap(await (await fetch(resource.data)).blob());
  const canvas = document.createElement('canvas');
  // Icon sources may be any size; bound decoding work before reading pixels.
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  image.data.set(monochromeMask(image.data));
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Cache decoded masks by ordinary resource path/data; replacements invalidate immediately. */
export class ResourceIcons {
  constructor(upload, decode = decodeMask) {
    this.upload = upload;
    this.decode = decode;
    this.entries = new Map();
    this.slots = [];
  }
  publish() {
    this.upload(this.slots.map((entry) => entry?.image ?? null));
  }
  index(path, resources) {
    for (const [name, entry] of this.entries) {
      if (!(name in resources)) {
        this.entries.delete(name);
        this.slots[entry.index] = null;
      }
    }
    const resource = resources[path];
    if (resource?.sourceMissing) return -1;
    const mime =
      typeof resource?.mime === 'string'
        ? resource.mime
        : typeof resource?.data === 'string'
          ? resource.data.slice(5).split(';')[0]
          : '';
    if (!mime.startsWith('image/')) return -1;
    let entry = this.entries.get(path);
    if (entry?.data !== resource.data) {
      const free = this.slots.indexOf(null);
      const index = entry?.index ?? (free >= 0 ? free : this.slots.length);
      entry = { data: resource.data, index, image: null };
      this.slots[index] = entry;
      this.entries.set(path, entry);
      this.publish();
      this.decode(resource)
        .then((image) => {
          if (this.entries.get(path) !== entry) return;
          entry.image = image;
          this.publish();
        })
        .catch(() => {
          /* Undecodable images retain the Lisp fallback. */
        });
    }
    return entry.image ? entry.index : -1;
  }
}
