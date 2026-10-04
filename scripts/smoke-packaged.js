const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
async function main() {
  const executable = process.argv[2] || path.resolve('dist', `mac-${process.arch}`, 'YouTube MP3.app', 'Contents', 'MacOS', 'YouTube MP3');
  await fs.access(executable);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-mp3-packaged-'));
  const reserve = http.createServer();
  await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; child.stderr.on('data', chunk => { logs = (logs + chunk.toString()).slice(-5000); });
  child.on('error', error => { logs += error.message; });
  let socket;
  try {
    let target;
    for (let i = 0; i < 100; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page' && page.url.endsWith('index.html')); } catch {}
      if (target) break;
      if (child.exitCode !== null) throw new Error(logs);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target, logs);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const handlers = pending.get(message.id);
      if (handlers) { pending.delete(message.id); message.error ? handlers.reject(new Error(JSON.stringify(message.error))) : handlers.resolve(message.result); }
    });
    const send = (method, params) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout ${method}`)); }, 10000);
      pending.set(requestId, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    await send('Runtime.evaluate', { expression: `new Promise(resolve => { const poll = setInterval(() => { if (document.readyState === 'complete' && document.querySelector('footer') && window.youtubeMP3) { clearInterval(poll); resolve(true); } }, 50); })`, awaitPromise: true, returnByValue: true });
    const result = await send('Runtime.evaluate', { expression: `(async () => ({ title: document.title, node: typeof require, destination: await window.youtubeMP3.getDestination(), invalid: await window.youtubeMP3.download('https://example.com'), footerVisible: document.querySelector('footer').getBoundingClientRect().bottom <= innerHeight }))()`, awaitPromise: true, returnByValue: true });
    const value = result.result.value;
    assert.equal(value.title, 'YouTube MP3'); assert.equal(value.node, 'undefined');
    assert.equal(value.destination.ok, true); assert.equal(value.invalid.ok, false); assert.equal(value.footerVisible, true);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    const output = path.join(os.tmpdir(), 'youtube-mp3-packaged.png');
    await fs.writeFile(output, Buffer.from(screenshot.data, 'base64'));
    console.log('PACKAGED OK: app real, preload/IPC, URL inválida, destino, aviso visible. Captura:', output);
  } finally {
    socket?.close();
    const exited = new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timer);
    await fs.rm(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
