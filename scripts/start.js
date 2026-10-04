const { spawn } = require('node:child_process');
const electron = require('electron');
const env = { ...process.env };
// Some developer shells set this; it makes Electron behave as plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
