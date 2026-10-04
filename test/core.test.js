const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validateUrl, friendlyError, makeArgs, parseProgress, DownloadManager, killTree } = require('../src/core');
const { spawn } = require('node:child_process');

test('valida hosts y un único video, elimina parámetros ajenos', () => {
  for (const url of ['https://youtu.be/abcdefghijk?t=30', 'https://www.youtube.com/watch?v=abcdefghijk&list=PL123', 'https://m.youtube.com/shorts/abcdefghijk', 'https://youtube.com/live/abcdefghijk']) {
    assert.equal(validateUrl(url), 'https://www.youtube.com/watch?v=abcdefghijk');
  }
  for (const url of ['https://youtube.com.evil.com/watch?v=abcdefghijk', 'file:///tmp/a', '--exec evil', 'https://evil.com', 'https://user:pass@youtube.com/watch?v=abcdefghijk', 'https://youtu.be/a', 'https://youtube.com/playlist?list=1', 'https://youtu.be/abcdefghijk\n', {}, 'https://youtube.com:123/watch?v=abcdefghijk']) {
    assert.throws(() => validateUrl(url));
  }
});
test('argumentos separados y opciones de seguridad', () => {
  const args = makeArgs(validateUrl('https://youtu.be/abcdefghijk'), '/tmp/folder with spaces', '/tmp/bin');
  assert.equal(args.at(-2), '--');
  assert.ok(args.includes('--ignore-config'));
  assert.ok(args.includes('--no-playlist'));
  assert.ok(args.includes('/tmp/folder with spaces'));
});
test('errores legibles para disco, permisos y red', () => {
  assert.match(friendlyError('ENOSPC'), /espacio/);
  assert.match(friendlyError('EACCES'), /escribir/);
  assert.match(friendlyError('connection timed out'), /conexión/);
  assert.match(friendlyError('Video unavailable'), /YouTube/);
});
async function fixture(t, mode) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-mp3-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'), dest = path.join(root, 'output');
  await fs.mkdir(bin); await fs.mkdir(dest);
  for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno']) await fs.writeFile(path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')), 'fixture');
  const updates = []; let child;
  const manager = new DownloadManager({ bin, emit: update => updates.push(update), spawnProcess: (file, args, options) => {
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=abcdefghijk');
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null;
    const stage = args[args.indexOf('--paths') + 1];
    setTimeout(async () => {
      if (mode === 'waiting') { child.stdout.write('PROGRESS:{"status":"downloading","downloaded_bytes":155,"total_bytes":1000}\n'); return; }
      if (mode === 'error') { child.stderr.write('connection timed out'); child.exitCode = 1; child.emit('close', 1); return; }
      const output = path.join(stage, 'Audio [abcdefghijk].mp3');
      await fs.writeFile(output, 'audio fixture');
      child.stderr.write('PROGRESS:{"status":"downloading","downloaded_bytes":425,'); child.stderr.write('"total_bytes":1000}\n');
      child.stdout.write('PROGRESS:{"status":"downloading","fragment_index":5,'); child.stdout.write('"fragment_count":10}\n');
      child.stdout.write('FILE:' + output + '\n'); child.exitCode = 0; child.emit('close', 0);
    }, 15);
    return child;
  }, killProcess: async proc => { proc.signalCode = 'SIGTERM'; proc.emit('close', null); } });
  return { root, dest, manager, updates, getChild: () => child };
}
test('guarda MP3 sin sobrescribir y limpia temporales', async t => {
  const { manager, dest, updates } = await fixture(t, 'success');
  await fs.writeFile(path.join(dest, 'Audio [abcdefghijk].mp3'), 'original');
  await manager.start('https://youtu.be/abcdefghijk', dest);
  await assert.rejects(manager.start('https://youtu.be/abcdefghijk', dest), /curso/);
  await manager.active.done;
  assert.equal(await fs.readFile(path.join(dest, 'Audio [abcdefghijk].mp3'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(dest, 'Audio [abcdefghijk] (1).mp3'), 'utf8'), 'audio fixture');
  assert.equal((await fs.readdir(dest)).length, 2);
  assert.ok(updates.some(update => update.progress === 50));
  assert.ok(updates.some(update => update.progress === 42.5));
  assert.ok(updates.some(update => update.state === 'completed'));
  assert.equal(manager.active, null);
});
test('progreso por bytes, fragmentos y estimación; total desconocido no inventa porcentaje', () => {
  const parse = data => parseProgress('PROGRESS:' + JSON.stringify(data));
  assert.equal(parse({ status: 'downloading', downloaded_bytes: 250, total_bytes: 1000 }).progress, 25);
  assert.equal(parse({ status: 'downloading', downloaded_bytes: 300, fragment_index: 3, fragment_count: 10 }).progress, 30);
  assert.equal(parse({ status: 'downloading', downloaded_bytes: 400, total_bytes_estimate: 1000 }).progress, 40);
  const unknown = parse({ status: 'downloading', downloaded_bytes: 1048576 });
  assert.equal(unknown.progress, null); assert.match(unknown.message, /1\.0 MB/);
  assert.equal(parse({ status: 'finished' }).progress, 99);
  assert.match(parse({ status: 'downloading', downloaded_bytes: 1000, total_bytes_estimate: 1000 }).message, /Descargando/);
  assert.equal(parseProgress('PROGRESS:not-json'), null);
});
test('cancelar detiene el proceso y elimina temporales', async t => {
  const { manager, dest, updates, getChild } = await fixture(t, 'waiting');
  await manager.start('https://youtu.be/abcdefghijk', dest);
  while (!getChild()) await new Promise(resolve => setTimeout(resolve, 5));
  await manager.cancel();
  assert.deepEqual(await fs.readdir(dest), []);
  assert.equal(manager.active, null);
  assert.ok(updates.some(update => update.state === 'cancelled'));
});
test('errores de yt-dlp liberan el bloqueo y limpian archivos', async t => {
  const { manager, dest, updates } = await fixture(t, 'error');
  await manager.start('https://youtu.be/abcdefghijk', dest); await manager.active.done;
  assert.deepEqual(await fs.readdir(dest), []);
  assert.equal(manager.active, null);
  assert.ok(updates.some(update => update.state === 'error' && /conexión/.test(update.message)));
});
test('cancelación inmediata y destino inexistente', async t => {
  const { manager, dest, updates } = await fixture(t, 'success');
  await manager.start('https://youtu.be/abcdefghijk', dest); await manager.cancel();
  assert.deepEqual(await fs.readdir(dest), []);
  await manager.start('https://youtu.be/abcdefghijk', path.join(dest, 'missing')); await manager.active.done;
  assert.ok(updates.some(update => update.state === 'error'));
});
test('killTree termina un grupo de procesos real en macOS/Linux', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  await new Promise(resolve => child.once('spawn', resolve));
  await killTree(child); await closed;
  assert.ok(child.signalCode);
});

test('no confunde archivos ausentes en stderr con un pendrive desconectado', () => {
  const message = friendlyError('ERROR: unable to download video: No such file or directory', { phase: 'download' });
  assert.doesNotMatch(message, /pendrive|reinstala|destino/);
  assert.match(friendlyError('ENOENT', { phase: 'destination', code: 'ENOENT' }), /pendrive/);
  assert.match(friendlyError('ENOENT', { phase: 'components', code: 'ENOENT' }), /herramienta/);
  assert.match(friendlyError('Requested format is not available', { phase: 'download' }), /pista de audio/);
  assert.match(friendlyError('Postprocessing: No such file or directory', { phase: 'conversion' }), /convertir/);
  assert.match(friendlyError('Sign in to confirm you are not a bot', { phase: 'download' }), /iniciar sesión/);
});
test('conserva diagnóstico técnico y el error sigue visible si falla el registro', async t => {
  const { manager, dest, updates } = await fixture(t, 'error');
  let diagnostic;
  manager.logError = async data => { diagnostic = data; throw new Error('log unavailable'); };
  await manager.start('https://youtu.be/abcdefghijk', dest); await manager.active.done;
  assert.equal(diagnostic.phase, 'download');
  assert.equal(diagnostic.exitCode, 1);
  assert.equal(diagnostic.stderr, 'connection timed out');
  assert.equal(diagnostic.url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.match(updates.find(update => update.state === 'error').detail, /connection timed out/);
  assert.equal(manager.active, null);
});
test('registro persistente conserva errores y rota al alcanzar el límite', async t => {
  const { writeErrorLog } = require('../src/error-log');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-log-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'logs', 'errors.jsonl');
  await writeErrorLog(file, { message: 'first' });
  assert.equal(JSON.parse((await fs.readFile(file, 'utf8')).trim()).message, 'first');
  await fs.writeFile(file, 'x'.repeat(1024 * 1024));
  await writeErrorLog(file, { message: 'second' });
  assert.equal((await fs.stat(file + '.previous')).size, 1024 * 1024);
  assert.equal(JSON.parse((await fs.readFile(file, 'utf8')).trim()).message, 'second');
});
