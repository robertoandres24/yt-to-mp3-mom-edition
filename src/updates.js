function createUpdates({ updater, enabled, isBusy, emit, logError = async () => {} }) {
  let state = { state: enabled ? 'idle' : 'disabled', message: '' };
  let checking = false, installing = false;
  const set = value => { state = value; emit(state); };
  if (enabled) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.on('checking-for-update', () => set({ state: 'checking', message: 'Buscando actualizaciones…' }));
    updater.on('update-available', info => set({ state: 'downloading', message: `Descargando la versión ${info.version}…` }));
    updater.on('download-progress', progress => set({ state: 'downloading', message: `Descargando actualización… ${Math.floor(progress.percent)}%` }));
    updater.on('update-not-available', () => set({ state: 'idle', message: 'Tienes la última versión.' }));
    updater.on('update-downloaded', info => set({ state: 'ready', message: `La versión ${info.version} está lista para instalar.` }));
    updater.on('error', error => {
      set({ state: 'error', message: 'No se pudo obtener la actualización. Puedes intentar nuevamente.' });
      Promise.resolve().then(() => logError({ timestamp: new Date().toISOString(), phase: 'update', message: error.message })).catch(() => {});
    });
  }
  return {
    status: () => state,
    isInstalling: () => installing,
    async check() {
      if (!enabled || checking || ['downloading', 'ready', 'installing'].includes(state.state)) return state;
      checking = true;
      try { await updater.checkForUpdates(); } catch {} finally { checking = false; }
      return state;
    },
    install() {
      if (!enabled || state.state !== 'ready') return { ok: false, error: 'Todavía no hay una actualización lista.' };
      if (isBusy()) return { ok: false, error: 'Espera a que termine la descarga de audio antes de actualizar.' };
      installing = true;
      set({ state: 'installing', message: 'Instalando actualización…' });
      updater.quitAndInstall(false, true);
      return { ok: true };
    }
  };
}
module.exports = { createUpdates };
