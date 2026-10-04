// Invoked only by an explicit development command, never in packaged builds.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
module.exports = async function smoke(window, app) {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(window.webContents.getLastWebPreferences().contextIsolation, true);
    assert.equal(window.webContents.getLastWebPreferences().nodeIntegration, false);
    const result = await window.webContents.executeJavaScript(`(async () => ({
      title: document.title, node: typeof require, api: typeof window.youtubeMP3,
      destination: await window.youtubeMP3.getDestination(),
      invalid: await window.youtubeMP3.download('https://example.com/evil')
    }))()`);
    assert.equal(result.title, 'YouTube MP3');
    assert.equal(result.node, 'undefined'); assert.equal(result.api, 'object');
    assert.equal(result.destination.ok, true); assert.equal(result.invalid.ok, false);
    window.webContents.send('download:update', { state: 'downloading', progress: null, message: 'Preparando el video…' });
    const preparing = await window.webContents.executeJavaScript(`new Promise(resolve => setTimeout(() => resolve(document.getElementById('progress-percent').textContent), 50))`);
    assert.equal(preparing, '—');
    for (const percent of [0, 42.5, 99, 100]) {
      window.webContents.send('download:update', { state: percent === 100 ? 'completed' : 'downloading', progress: percent, message: 'Descargando audio…', filename: 'Prueba.mp3' });
      const progress = await window.webContents.executeJavaScript(`new Promise(resolve => setTimeout(() => resolve({ visible: !document.getElementById('progress-container').hidden, value: document.getElementById('progress').value, determinate: document.getElementById('progress').hasAttribute('value'), text: document.getElementById('progress-percent').textContent }), 50))`);
      assert.equal(progress.visible, true); assert.equal(progress.determinate, true);
      assert.equal(progress.value, percent); assert.equal(progress.text, `${Math.floor(percent)}%`);
    }
    window.webContents.send('download:update', { state: 'downloading', progress: 42.5, message: 'Descargando audio…' });
    const output = path.join(app.getPath('temp'), 'youtube-mp3-smoke.png');
    await fs.writeFile(output, (await window.webContents.capturePage()).toPNG());
    console.log('SMOKE OK: preload, IPC, destino, URL inválida, aislamiento, barra y porcentaje de 0 a 100. Captura:', output);
    app.exit(0);
  } catch (error) { console.error('SMOKE FAILED', error); app.exit(1); }
};
