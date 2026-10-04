const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DownloadManager, friendlyError } = require('./core');
const { writeErrorLog } = require('./error-log');
const { defaultDestination } = require('./destination');

// Preserve existing settings, cache and logs when changing the product name.
app.setPath('userData', path.join(app.getPath('appData'), 'youtube-mp3'));

let window, manager, destination, userSelected = false, closing = false;
const rendererPath = path.join(__dirname, 'index.html');
const rendererUrl = pathToFileURL(rendererPath).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    destination = await defaultDestination(app.getPath('downloads'));
    const bin = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'resources', 'bin', process.platform === 'win32' ? 'win' : `mac-${process.arch}`);
    const errorLog = path.join(app.getPath('userData'), 'logs', 'download-errors.jsonl');
    manager = new DownloadManager({ logError: diagnostic => writeErrorLog(errorLog, { appVersion: app.getVersion(), platform: process.platform, arch: process.arch, ...diagnostic }), bin, cacheDir: path.join(app.getPath('userData'), 'yt-dlp-cache'), emit: update => { if (window && !window.isDestroyed()) window.webContents.send('download:update', update); } });
    const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererUrl) return { ok: false, error: 'Solicitud no permitida.' };
      try { return await fn(...args); } catch (error) { return { ok: false, error: error.code ? friendlyError(`${error.code} ${error.message}`) : error.message }; }
    });
    handle('destination:get', async () => {
      if (!userSelected && !manager.active) destination = await defaultDestination(app.getPath('downloads'));
      return { ok: true, ...destination };
    });
    handle('destination:choose', async () => {
      if (manager.active) return { ok: false, error: 'Espera a que termine la descarga.' };
      const result = await dialog.showOpenDialog(window, { title: 'Elige dónde guardar el MP3', defaultPath: destination.path, properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled) { destination = { path: result.filePaths[0], usb: false }; userSelected = true; }
      return { ok: true, ...destination };
    });
    handle('download:start', async url => {
      if (!userSelected && !manager.active) destination = await defaultDestination(app.getPath('downloads'));
      const result = await manager.start(url, destination.path);
      return { ...result, destination: destination.path };
    });
    handle('download:cancel', async () => { await manager.cancel(); return { ok: true }; });
    handle('errors:open', async () => {
      const error = await shell.openPath(path.dirname(errorLog));
      return error ? { ok: false, error: 'No se pudo abrir la carpeta de registros.' } : { ok: true };
    });
    handle('destination:open', async () => {
      const error = await shell.openPath(destination.path);
      return error ? { ok: false, error: 'No se pudo abrir la carpeta. Revisa que el pendrive siga conectado.' } : { ok: true };
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { console.error(error); dialog.showErrorBox('MP3 para mamá ❤️', 'No se pudo iniciar la aplicación. Intenta abrirla nuevamente.'); app.quit(); });
}

function createWindow() {
  window = new BrowserWindow({ width: 620, height: 700, minWidth: 520, minHeight: 660, title: 'MP3 para mamá ❤️', backgroundColor: '#f5f5f3', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', event => {
    if (manager.active) {
      event.preventDefault();
      if (closing) return;
      closing = true;
      manager.cancel().finally(() => { closing = false; if (!window.isDestroyed()) window.destroy(); });
    }
  });
  window.loadFile(rendererPath);
  if (!app.isPackaged && process.argv.includes('--smoke-test')) {
    window.webContents.once('did-finish-load', () => require('./smoke')(window, app));
  }
}
app.on('before-quit', event => {
  if (manager?.active) {
    event.preventDefault();
    if (closing) return;
    closing = true; manager.cancel().finally(() => { closing = false; app.quit(); });
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
