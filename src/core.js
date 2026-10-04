const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const exec = promisify(execFile);

function validateUrl(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\x00-\x1f\x7f]/.test(input)) throw new Error('Pega una URL válida de un video de YouTube.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Pega una URL válida de un video de YouTube.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Pega una URL válida de un video de YouTube.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('Pega la URL de un video de YouTube, no una lista o un canal.');
  return `https://www.youtube.com/watch?v=${id}`;
}

function friendlyError(detail) {
  if (/ENOSPC|no space left|disk full/i.test(detail)) return 'No hay espacio suficiente en la carpeta de destino.';
  if (/EACCES|EPERM|permission denied|access is denied|read-only/i.test(detail)) return 'No se puede escribir en esa carpeta. Elige otra carpeta.';
  if (/ENOENT|no such file|device not ready/i.test(detail)) return 'No se encuentra el destino o un componente de la app. Reconecta el pendrive o reinstala la aplicación.';
  if (/private|unavailable|removed|not available|age.restricted|sign in|confirm.*bot|403/i.test(detail)) return 'YouTube no permite descargar este video. Prueba con otro video público.';
  if (/network|timed out|resolve|connection|unable to download/i.test(detail)) return 'No se pudo conectar con YouTube. Revisa tu conexión e intenta nuevamente.';
  return 'No se pudo descargar el audio. Prueba con otro video o elige otra carpeta.';
}

function makeArgs(url, stage, bin, { cacheDir } = {}) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return ['--ignore-config', '--no-playlist', '--no-live-from-start', '--match-filter', '!is_live',
    '--no-colors', '--newline', '--progress', '--progress-delta', '0.1', '--downloader', 'native',
    ...(cacheDir ? ['--cache-dir', cacheDir] : ['--no-cache-dir']), '--socket-timeout', '20', '--retries', '3',
    '--no-overwrites', '--windows-filenames', '--trim-filenames', '160',
    '--ffmpeg-location', bin, '--js-runtimes', `deno:${path.join(bin, `deno${suffix}`)}`,
    '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K',
    '--paths', stage, '-o', '%(title).140B [%(id)s].%(ext)s',
    '--progress-template', 'download:PROGRESS:%(progress)j',
    '--print', 'after_move:FILE:%(filepath)s', '--', url];
}

function parseProgress(line) {
  if (!line.startsWith('PROGRESS:')) return null;
  let data;
  try { data = JSON.parse(line.slice(9)); } catch { return null; }
  if (!data || typeof data !== 'object' || !['downloading', 'finished'].includes(data.status)) return null;
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  let percent = null;
  if (data.status === 'finished') percent = 100;
  else if (positive(data.total_bytes) && positive(data.downloaded_bytes)) percent = 100 * data.downloaded_bytes / data.total_bytes;
  else if (positive(data.fragment_count) && typeof data.fragment_index === 'number' && Number.isFinite(data.fragment_index)) percent = 100 * data.fragment_index / data.fragment_count;
  else if (positive(data.total_bytes_estimate) && positive(data.downloaded_bytes)) percent = 100 * data.downloaded_bytes / data.total_bytes_estimate;
  else if (data.downloaded_bytes === 0) percent = 0;
  const bytes = positive(data.downloaded_bytes) ? ` (${(data.downloaded_bytes / 1048576).toFixed(1)} MB)` : '';
  return { state: 'downloading', progress: percent === null ? null : Math.min(99, Math.max(0, percent)),
    message: data.status === 'finished' ? 'Convirtiendo a MP3…' : `Descargando audio…${percent === null ? bytes : ''}` };
}

async function killTree(child, platform = process.platform) {
  if (!child?.pid) return;
  if (platform === 'win32') {
    await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => {});
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    // Keep the process group reserved until children have been terminated.
    await new Promise(resolve => setTimeout(resolve, 600));
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
}

class DownloadManager {
  constructor({ bin, emit, cacheDir, spawnProcess = spawn, killProcess = killTree }) {
    this.bin = bin; this.emit = emit; this.cacheDir = cacheDir; this.spawnProcess = spawnProcess; this.killProcess = killProcess; this.active = null;
  }
  async start(input, destination) {
    if (this.active) throw new Error('Ya hay una descarga en curso. Espera o cancélala.');
    const url = validateUrl(input);
    if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new Error('Elige una carpeta de destino.');
    const job = { cancelled: false, child: null, stage: null };
    this.active = job;
    job.done = this.run(job, url, destination);
    return { ok: true };
  }
  async run(job, url, destination) {
    let detail = '', resultFile = null, killPromise;
    try {
      await fs.access(destination, require('node:fs').constants.W_OK);
      if (job.cancelled) return;
      job.stage = await fs.mkdtemp(path.join(destination, '.youtube-mp3-'));
      if (job.cancelled) return;
      const suffix = process.platform === 'win32' ? '.exe' : '';
      for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno']) await fs.access(path.join(this.bin, name + suffix));
      if (job.cancelled) return;
      this.emit({ state: 'downloading', progress: null, message: 'Preparando el video…' });
      const child = this.spawnProcess(path.join(this.bin, 'yt-dlp' + suffix), makeArgs(url, job.stage, this.bin, { cacheDir: this.cacheDir }), {
        shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
      job.child = child;
      const buffers = { stdout: '', stderr: '' };
      let lastProgress = 0;
      const parse = line => {
        const update = parseProgress(line);
        if (update && !job.cancelled) {
          if (update.progress !== null) { lastProgress = Math.max(lastProgress, update.progress); update.progress = lastProgress; }
          this.emit(update);
        }
        if (line.startsWith('FILE:')) resultFile = line.slice(5).trim();
      };
      const read = (stream, chunk) => {
        buffers[stream] += chunk.toString();
        const lines = buffers[stream].split(/\r?\n/); buffers[stream] = lines.pop(); lines.forEach(parse);
        if (buffers[stream].length > 65536) buffers[stream] = '';
      };
      child.stdout.on('data', chunk => read('stdout', chunk));
      // Read both streams; custom progress normally arrives on stdout.
      child.stderr.on('data', chunk => {
        detail = (detail + chunk.toString()).slice(-12000);
        read('stderr', chunk);
      });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject); child.once('close', resolve);
      });
      Object.values(buffers).filter(Boolean).forEach(parse);
      if (job.cancelled) return;
      if (code !== 0) throw new Error(detail);
      if (!resultFile || path.dirname(path.resolve(resultFile)) !== path.resolve(job.stage) || path.extname(resultFile).toLowerCase() !== '.mp3') throw new Error('No MP3 output');
      const stat = await fs.stat(resultFile);
      if (!stat.isFile() || stat.size === 0) throw new Error('Empty MP3');
      // Exclusive copies preserve existing files, even when the same video is downloaded twice.
      const stem = path.basename(resultFile, '.mp3');
      let saved;
      job.committing = true;
      for (let i = 0; i < 1000; i++) {
        saved = path.join(destination, `${stem}${i ? ` (${i})` : ''}.mp3`);
        try { await fs.copyFile(resultFile, saved, require('node:fs').constants.COPYFILE_EXCL); break; }
        catch (error) { if (error.code !== 'EEXIST' || i === 999) throw error; }
      }
      this.emit({ state: 'completed', progress: 100, message: 'Descarga terminada', filename: path.basename(saved) });
    } catch (error) {
      if (job.child && job.child.exitCode === null && job.child.signalCode === null) killPromise = this.killProcess(job.child);
      if (!job.cancelled) this.emit({ state: 'error', message: friendlyError(`${error.code || ''} ${error.message} ${detail}`) });
    } finally {
      await killPromise;
      await job.killPromise;
      if (job.stage) await fs.rm(job.stage, { recursive: true, force: true }).catch(() => {});
      if (job.cancelled) this.emit({ state: 'cancelled', progress: 0, message: 'Descarga cancelada' });
      if (this.active === job) this.active = null;
      this.emit({ state: 'ready' });
    }
  }
  async cancel() {
    const job = this.active;
    if (!job) return;
    if (job.committing) { await job.done; return; }
    job.cancelled = true;
    if (job.child && !job.killPromise) job.killPromise = this.killProcess(job.child);
    await job.done;
  }
}

module.exports = { validateUrl, friendlyError, makeArgs, parseProgress, killTree, DownloadManager };
