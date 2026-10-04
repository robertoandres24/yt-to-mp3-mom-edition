const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { extractBundle } = require('../scripts/extract-bundle');

// Minimal stored ZIP fixtures, including Unix mode bits for the symlink case.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const { name, body = 'fixture', mode = 0o100644 } of entries) {
    const filename = Buffer.from(name), data = Buffer.from(body);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6);
    header.copy(record, 8, 6, 28); record.writeUInt32LE((mode << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    central.push(record, filename); offset += header.length + filename.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

test('extrae ejecutable y runtime, conservando el permiso de ejecución', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-bundle-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archive = path.join(dir, 'test.zip'), out = path.join(dir, 'out');
  await fs.writeFile(archive, zip([{ name: 'yt-dlp', mode: 0o100755 }, { name: '_internal/runtime' }]));
  assert.deepEqual(await extractBundle(archive, out, 'yt-dlp'), ['yt-dlp', '_internal/runtime']);
  assert.equal(await fs.readFile(path.join(out, '_internal/runtime'), 'utf8'), 'fixture');
  if (process.platform !== 'win32') assert.ok((await fs.stat(path.join(out, 'yt-dlp'))).mode & 0o111);
});

for (const [label, entry] of [
  ['traversal', { name: '_internal/../../escape' }],
  ['symlink', { name: '_internal/link', body: '../../escape', mode: 0o120777 }],
  ['archivo inesperado', { name: 'ffmpeg' }]
]) test(`rechaza ${label} en el ZIP`, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-bundle-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archive = path.join(dir, 'test.zip'); await fs.writeFile(archive, zip([entry]));
  await assert.rejects(extractBundle(archive, path.join(dir, 'out'), 'yt-dlp'));
});
