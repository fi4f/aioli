import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { zip } from '../zip.js';

test('folder ZIPs contain matching local/central records, UTF-8 names, directories, bytes, and CRCs', async () => {
  const entries = [{ path: 'Assets', directory: true }, { path: 'Assets/empty', directory: true },
    { path: 'Assets/café #👋.txt', bytes: new TextEncoder().encode('Hello 👋\n') },
    { path: 'Assets/binary.bin', bytes: Uint8Array.of(0, 128, 255) },
    { path: 'Assets/zero.bin', bytes: new Uint8Array() }];
  const blob = zip(entries.map(entry => ({ ...entry, modified: Date.UTC(2026, 9, 16, 12, 34, 56) })));
  assert.equal(blob.type, 'application/zip');
  const data = Buffer.from(await blob.arrayBuffer()), end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  assert.equal(data.readUInt16LE(end + 10), entries.length);
  let at = data.readUInt32LE(end + 16);
  for (const entry of entries) {
    assert.equal(data.readUInt32LE(at), 0x02014b50);
    assert.equal(data.readUInt16LE(at + 8), 0x0800); // UTF-8 names.
    assert.equal(data.readUInt16LE(at + 10), 0); // Stored contents.
    const nameSize = data.readUInt16LE(at + 28), offset = data.readUInt32LE(at + 42);
    const name = data.subarray(at + 46, at + 46 + nameSize);
    assert.equal(name.toString('utf8'), entry.path + (entry.directory ? '/' : ''));
    assert.equal(data.readUInt32LE(at + 38), entry.directory ? 0x10 : 0);
    assert.equal(data.readUInt32LE(offset), 0x04034b50);
    assert.equal(data.readUInt16LE(offset + 6), 0x0800);
    assert.deepEqual(data.subarray(offset + 30, offset + 30 + nameSize), name);
    const expected = Buffer.from(entry.bytes ?? []), size = data.readUInt32LE(at + 24);
    assert.equal(size, expected.length);
    assert.equal(data.readUInt32LE(offset + 22), size);
    assert.deepEqual(data.subarray(offset + 30 + nameSize, offset + 30 + nameSize + size), expected);
    assert.equal(data.readUInt32LE(at + 16), crc32(expected));
    assert.equal(data.readUInt32LE(offset + 14), crc32(expected));
    at += 46 + nameSize;
  }
  assert.equal(at, end);
});

test('ZIP exports reject ambiguous, escaping, duplicate, and oversized names', () => {
  for (const path of ['', '/absolute', 'a/../b', './a', 'a//b', 'a\\b', 'a\n', 'a'.repeat(65536)])
    assert.throws(() => zip([{ path, bytes: new Uint8Array() }]));
  assert.throws(() => zip([{ path: 'a', directory: true }, { path: 'a', bytes: new Uint8Array() }]), /Duplicate/);
  assert.throws(() => zip([{ path: 'a', bytes: [1] }]), /contents must be bytes/);
  assert.throws(() => zip(new Array(65535)), /Too many/);
});
