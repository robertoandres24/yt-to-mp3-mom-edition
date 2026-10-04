const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('youtubeMP3', {
  getDestination: () => ipcRenderer.invoke('destination:get'),
  chooseDestination: () => ipcRenderer.invoke('destination:choose'),
  download: url => ipcRenderer.invoke('download:start', url),
  cancel: () => ipcRenderer.invoke('download:cancel'),
  openErrorLogs: () => ipcRenderer.invoke('errors:open'),
  openFolder: () => ipcRenderer.invoke('destination:open'),
  onUpdate: callback => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('download:update', listener);
    return () => ipcRenderer.removeListener('download:update', listener);
  }
});
