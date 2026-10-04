const { spawn } = require('node:child_process');
const electron = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const env = { ...process.env };
// Some developer shells set this; it makes Electron behave as plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const args = ['.', ...process.argv.slice(2)];
const profile = args.includes('--smoke-test') ? fs.mkdtempSync(path.join(os.tmpdir(), 'yt-mp3-smoke-')) : null;
if (profile) args.push(`--user-data-dir=${profile}`);
const cleanup = () => { if (profile) fs.rmSync(profile, { recursive: true, force: true }); };
const child = spawn(electron, args, { stdio: 'inherit', env });
child.on('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { cleanup(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
