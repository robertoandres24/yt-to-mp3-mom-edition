// Developer/build tooling only. The installed application never fetches executables.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const yauzl = require('yauzl');
const { extractBundle } = require('./extract-bundle');
const manifest = require('./binary-manifest.json');
const platform = process.argv[2];
const target = platform === 'win' ? 'win' : `mac-${process.argv[3] || process.arch}`;
const root = path.resolve(__dirname, '..', 'resources', 'bin', target);

async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function download(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}
function extractBinary(archive, name, output) {
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      let found = false;
      zip.on('error', reject);
      zip.on('end', () => { if (!found) reject(new Error(`Falta ${name} en el ZIP`)); });
      zip.on('entry', entry => {
        if (entry.fileName !== name) { zip.readEntry(); return; }
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (type === 0o120000 || entry.uncompressedSize > 400 * 1024 * 1024) { zip.close(); reject(new Error('Entrada ZIP no permitida')); return; }
        found = true;
        zip.openReadStream(entry, async (streamError, stream) => {
          if (streamError) { zip.close(); reject(streamError); return; }
          try { await pipeline(stream, createWriteStream(output)); zip.close(); resolve(); }
          catch (writeError) { zip.close(); reject(writeError); }
        });
      });
      zip.readEntry();
    });
  });
}
async function main() {
  if (!['mac', 'win'].includes(platform) || !manifest[target]) throw new Error('Usa: node scripts/binaries.js mac [arm64|x64] o win');
  await fs.mkdir(root, { recursive: true });
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-mp3-bin-'));
  try {
    const integrityFile = path.join(root, 'integrity.json');
    let previous = {};
    try { previous = JSON.parse(await fs.readFile(integrityFile, 'utf8')); } catch {}
    const integrity = {};
    for (const entry of manifest[target]) {
      const output = path.join(root, entry.name);
      // Both original archives and final executables are checked on repeat builds.
      if (entry.sha256 && previous[entry.name]?.source === entry.sha256) {
        try {
          let valid = await hash(output) === previous[entry.name].sha256;
          if (entry.bundleExecutable) {
            const files = previous[entry.name].files;
            valid = valid && files && Object.keys(files).length > 0;
            if (valid) for (const [name, digest] of Object.entries(files)) {
              if (await hash(path.join(root, name)) !== digest) { valid = false; break; }
            }
          }
          if (valid) { integrity[entry.name] = previous[entry.name]; continue; }
        } catch {}
      }
      console.log(`Preparando ${target}/${entry.name}…`);
      const fetched = path.join(cache, entry.name + (entry.archive ? '.zip' : '.download'));
      await download(entry.url, fetched);
      const digest = await hash(fetched);
      if (entry.sha256 && digest !== entry.sha256) throw new Error(`Checksum incorrecto: ${entry.name}`);
      if (!entry.sha256) entry.sha256 = digest;
      let bundledFiles;
      if (entry.bundleExecutable) {
        const staging = path.join(cache, 'bundle');
        const files = await extractBundle(fetched, staging, entry.bundleExecutable);
        await fs.rm(path.join(root, '_internal'), { recursive: true, force: true });
        await fs.cp(path.join(staging, '_internal'), path.join(root, '_internal'), { recursive: true });
        await fs.copyFile(path.join(staging, entry.bundleExecutable), output);
        bundledFiles = {};
        for (const name of files.filter(name => name !== entry.bundleExecutable)) bundledFiles[name] = await hash(path.join(root, name));
      } else if (entry.archive) {
        await extractBinary(fetched, entry.name, output);
      } else await fs.copyFile(fetched, output);
      if (!entry.name.endsWith('.txt') && target !== 'win') await fs.chmod(output, 0o755);
      integrity[entry.name] = { source: digest, sha256: await hash(output), url: entry.url, ...(bundledFiles ? { files: bundledFiles } : {}) };
    }
    await fs.writeFile(integrityFile, JSON.stringify(integrity, null, 2) + '\n');
    await fs.writeFile(path.join(__dirname, 'binary-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.copyFile(path.join(__dirname, '..', 'THIRD-PARTY-NOTICES.md'), path.join(root, 'THIRD-PARTY-NOTICES.md'));
  } finally { await fs.rm(cache, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
