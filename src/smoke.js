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
    const output = path.join(app.getPath('temp'), 'youtube-mp3-smoke.png');
    await fs.writeFile(output, (await window.webContents.capturePage()).toPNG());
    console.log('SMOKE OK: preload, IPC, destino, URL inválida, aislamiento. Captura:', output);
    app.exit(0);
  } catch (error) { console.error('SMOKE FAILED', error); app.exit(1); }
};
