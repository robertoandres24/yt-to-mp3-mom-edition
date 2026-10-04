const fs = require('node:fs/promises');
const path = require('node:path');

// Bound disk usage; keep the previous log when rotating.
async function writeErrorLog(file, diagnostic) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let size = 0;
  try { size = (await fs.stat(file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (size >= 1024 * 1024) {
    await fs.rm(file + '.previous', { force: true });
    await fs.rename(file, file + '.previous');
  }
  await fs.appendFile(file, JSON.stringify(diagnostic) + '\n', { mode: 0o600 });
  return true;
}
module.exports = { writeErrorLog };
