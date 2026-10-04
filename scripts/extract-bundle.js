// Extract only the official executable and its _internal runtime directory.
// Reject links and traversal; no archive path is allowed to escape the staging dir.
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

function extractBundle(archive, destination, executable) {
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = [];
      let total = 0;
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', () => {
        if (!files.includes(executable) || !files.some(name => name.startsWith('_internal/'))) return fail(new Error('Bundle yt-dlp incompleto'));
        resolve(files);
      });
      zip.on('entry', entry => {
        const name = entry.fileName;
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        total += entry.uncompressedSize;
        if ((name !== executable && !name.startsWith('_internal/')) || name.includes('\\') || name.includes(':') || name.split('/').some(part => part === '..' || part === '.') || type === 0o120000 || total > 512 * 1024 * 1024 || files.length > 3000) {
          fail(new Error(`Entrada ZIP no permitida: ${name}`)); return;
        }
        const output = path.join(destination, name);
        (async () => {
          if (name.endsWith('/')) await fs.mkdir(output, { recursive: true });
          else {
            await fs.mkdir(path.dirname(output), { recursive: true });
            const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
            await pipeline(stream, createWriteStream(output, { flags: 'wx' }));
            await fs.chmod(output, (entry.externalFileAttributes >>> 16) & 0o111 ? 0o755 : 0o644);
            files.push(name);
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}
module.exports = { extractBundle };
