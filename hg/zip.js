// Stored ZIP entries: UTF-8 names, CRC-32, and explicit empty directories.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size) {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  return { bytes, u16: (offset, n) => view.setUint16(offset, n, true),
    u32: (offset, n) => view.setUint32(offset, n, true) };
}
export function zip(entries) {
  if (!Array.isArray(entries)) throw new TypeError('ZIP expects a list of entries');
  if (entries.length >= 65535) throw new RangeError('Too many files for a ZIP export');
  const parts = [], central = [], seen = new Set(), encoder = new TextEncoder();
  let offset = 0, centralSize = 0;
  for (const entry of entries) {
    if (typeof entry.path !== 'string' || /[\\\x00-\x1f\x7f]/u.test(entry.path) ||
      entry.path.split('/').some(part => !part || part === '.' || part === '..'))
      throw new TypeError('ZIP entries require relative file paths');
    if (seen.has(entry.path)) throw new Error(`Duplicate ZIP path: ${entry.path}`);
    seen.add(entry.path);
    const name = encoder.encode(entry.path + (entry.directory ? '/' : ''));
    const data = entry.directory ? new Uint8Array() : entry.bytes;
    if (!(data instanceof Uint8Array)) throw new TypeError('ZIP file contents must be bytes');
    if (name.length > 65535 || data.length >= 0xffffffff) throw new RangeError('File is too large for ZIP export');
    const date = new Date(entry.modified ?? Date.now());
    const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
    const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >>> 1);
    const crc = crc32(data), local = header(30), record = header(46);
    local.u32(0, 0x04034b50); local.u16(4, 20); local.u16(6, 0x0800);
    local.u16(10, dosTime); local.u16(12, dosDate); local.u32(14, crc);
    local.u32(18, data.length); local.u32(22, data.length); local.u16(26, name.length);
    record.u32(0, 0x02014b50); record.u16(4, 20); record.u16(6, 20); record.u16(8, 0x0800);
    record.u16(12, dosTime); record.u16(14, dosDate); record.u32(16, crc);
    record.u32(20, data.length); record.u32(24, data.length); record.u16(28, name.length);
    record.u32(38, entry.directory ? 0x10 : 0); record.u32(42, offset);
    parts.push(local.bytes, name, data); central.push(record.bytes, name);
    offset += 30 + name.length + data.length; centralSize += 46 + name.length;
    if (offset + centralSize + 22 >= 0xffffffff) throw new RangeError('Archive is too large for ZIP export');
  }
  const end = header(22);
  end.u32(0, 0x06054b50); end.u16(8, entries.length); end.u16(10, entries.length);
  end.u32(12, centralSize); end.u32(16, offset);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
}
