const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
for (const dir of ['src', 'scripts', 'test']) {
  for (const file of fs.readdirSync(path.join(__dirname, '..', dir))) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('Sintaxis verificada.');
