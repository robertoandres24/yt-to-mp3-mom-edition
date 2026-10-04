// Real, throttled transfers exercise live progress through DownloadManager.
// All audio is generated locally; no YouTube download is needed for this test.
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { DownloadManager } = require('../src/core');
const exec = promisify(execFile);
async function main() {
  const target = process.platform === 'win32' ? 'win' : `mac-${process.arch}`;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const bin = path.resolve(__dirname, '..', 'resources', 'bin', target);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-mp3-tools-'));
  const server = http.createServer();
  let manager, lastTransferFinished = 0;
  try {
    const input = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20'];
    await exec(path.join(bin, 'ffmpeg' + ext), [...input, path.join(dir, 'fixture.wav')], { windowsHide: true, timeout: 30000 });
    await exec(path.join(bin, 'ffmpeg' + ext), [...input, '-c:a', 'aac', '-b:a', '128k', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0', '-hls_segment_filename', path.join(dir, 'part%03d.ts'), path.join(dir, 'fixture.m3u8')], { windowsHide: true, timeout: 30000 });
    const files = new Map();
    for (const name of await fs.readdir(dir)) files.set(name, await fs.readFile(path.join(dir, name)));
    server.on('request', (req, res) => {
      const name = new URL(req.url, 'http://localhost').pathname.slice(1);
      const audio = files.get(name);
      if (!audio) { res.writeHead(404); res.end(); return; }
      const playlist = name.endsWith('.m3u8');
      res.writeHead(200, { 'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : name.endsWith('.ts') ? 'video/mp2t' : 'audio/wav', 'Content-Length': audio.length });
      if (req.method === 'HEAD') { res.end(); return; }
      if (playlist) { res.end(audio); return; }
      let offset = 0;
      const chunkSize = name.endsWith('.ts') ? 4096 : 32768;
      const timer = setInterval(() => {
        res.write(audio.subarray(offset, offset + chunkSize)); offset += chunkSize;
        if (offset >= audio.length) { clearInterval(timer); lastTransferFinished = Date.now(); res.end(); }
      }, 60);
      res.on('close', () => clearInterval(timer));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    for (const file of ['fixture.wav', 'fixture.m3u8']) {
      const output = path.join(dir, file + '-output'); await fs.mkdir(output);
      const url = `http://127.0.0.1:${server.address().port}/${file}`;
      const updates = [];
      manager = new DownloadManager({ bin, emit: update => updates.push({ ...update, observedAt: Date.now() }),
        // Only this test substitutes the validated video URL with its local fixture.
        spawnProcess: (executable, args, options) => spawn(executable, [...args.slice(0, -1), url], options) });
      await manager.start('https://youtu.be/abcdefghijk', output);
      const timeout = setTimeout(() => manager.cancel(), 60000);
      try { await manager.active.done; } finally { clearTimeout(timeout); }
      const intermediate = updates.filter(update => update.progress > 0 && update.progress < 99);
      const distinct = new Set(intermediate.map(update => Math.floor(update.progress)));
      assert.ok(distinct.size >= 3, `${file}: no hay progresión real: ${JSON.stringify(updates)}`);
      assert.ok(intermediate.some(update => update.observedAt < lastTransferFinished), `${file}: el progreso llegó después de completar la transferencia`);
      const completed = updates.find(update => update.state === 'completed');
      assert.ok(completed, JSON.stringify(updates));
      const { stdout: metadata } = await exec(path.join(bin, 'ffprobe' + ext), ['-v', 'quiet', '-show_streams', '-of', 'json', path.join(output, completed.filename)], { timeout: 10000 });
      assert.equal(JSON.parse(metadata).streams[0].codec_name, 'mp3');
      assert.equal(Number(JSON.parse(metadata).streams[0].bit_rate), 192000, 'El MP3 debe respetar el tamaño predecible de 192 kbps');
      console.log(`PROGRESS OK (${file}): ${distinct.size} porcentajes intermedios recibidos en vivo; MP3 verificado.`);
    }
    const { stdout: denoVersion } = await exec(path.join(bin, 'deno' + ext), ['--version'], { timeout: 10000 });
    assert.match(denoVersion, /deno 2/);
    console.log('TOOLS OK: descarga directa y HLS por fragmentos, FFmpeg, FFprobe y Deno.');
  } finally { await manager?.cancel(); server.closeAllConnections(); server.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
