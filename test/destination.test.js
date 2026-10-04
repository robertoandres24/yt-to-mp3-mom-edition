const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { defaultDestination } = require('../src/destination');
test('USB tiene prioridad y Descargas es la alternativa si no hay destino utilizable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-mp3-destination-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const usb = path.join(root, 'USB'), downloads = path.join(root, 'Downloads');
  await fs.mkdir(usb);
  assert.deepEqual(await defaultDestination(downloads, async () => [path.join(root, 'gone'), usb]), { path: usb, usb: true });
  assert.deepEqual(await defaultDestination(downloads, async () => []), { path: downloads, usb: false });
  assert.ok((await fs.stat(downloads)).isDirectory());
});
