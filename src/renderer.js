const api = window.youtubeMP3;
const $ = id => document.getElementById(id);
let busy = false;
let lastProgress = 0;
function setBusy(value) {
  busy = value;
  ['url', 'clear-url', 'download', 'choose', 'open'].forEach(id => { $(id).disabled = value; });
  $('cancel').hidden = !value;
  $('cancel').disabled = false;
}
$('url').addEventListener('input', () => { $('clear-url').hidden = $('url').value.length === 0; });
$('clear-url').addEventListener('click', () => {
  if (busy) return;
  $('url').value = '';
  $('clear-url').hidden = true;
  $('url').focus();
});
function showError(message) { $('message').textContent = message; $('message').classList.add('error'); }
function showProgress(value) {
  const known = Number.isFinite(value);
  const percent = known ? Math.min(100, Math.max(0, value)) : lastProgress;
  lastProgress = percent;
  $('progress-container').hidden = false;
  $('progress').value = percent;
  $('progress-percent').textContent = known || percent > 0 ? `${Math.floor(percent)}%` : '—';
}
function showDestination(result) {
  if (!result.ok) return showError(result.error);
  $('folder').textContent = result.path;
  $('folder').title = result.path;
  $('destination-hint').textContent = result.usb ? 'Pendrive conectado · Destino prioritario' : 'Puedes cambiar la carpeta cuando quieras.';
}
api.onUpdate(update => {
  if (update.state === 'ready') { setBusy(false); return; }
  $('message').classList.toggle('error', update.state === 'error');
  if (update.message) $('message').textContent = update.message;
  if (update.state === 'downloading') {
    showProgress(update.progress);
  }
  if (update.state === 'completed') {
    showProgress(100);
    $('filename').textContent = update.filename;
    $('url').value = '';
    $('clear-url').hidden = true;
  }
  if (['error', 'cancelled'].includes(update.state)) $('progress-container').hidden = true;
});
$('form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  setBusy(true); $('message').classList.remove('error'); $('message').textContent = 'Preparando el video…'; $('filename').textContent = ''; lastProgress = 0; showProgress(null);
  try {
    const result = await api.download($('url').value);
    if (!result.ok) { setBusy(false); $('progress-container').hidden = true; showError(result.error); }
    else { $('folder').textContent = result.destination; $('folder').title = result.destination; }
  } catch { setBusy(false); $('progress-container').hidden = true; showError('No se pudo iniciar la descarga. Intenta nuevamente.'); }
});
$('choose').addEventListener('click', async () => {
  $('choose').disabled = true;
  try { showDestination(await api.chooseDestination()); } catch { showError('No se pudo elegir la carpeta. Intenta nuevamente.'); }
  finally { $('choose').disabled = busy; }
});
$('cancel').addEventListener('click', async () => {
  $('cancel').disabled = true; $('message').textContent = 'Cancelando…';
  try { await api.cancel(); } catch { showError('No se pudo cancelar. Cierra la aplicación para detener la descarga.'); }
});
$('open').addEventListener('click', async () => {
  try { const result = await api.openFolder(); if (!result.ok) showError(result.error); } catch { showError('No se pudo abrir la carpeta.'); }
});
async function refreshDestination() {
  if (busy) return;
  try { showDestination(await api.getDestination()); $('download').disabled = false; $('open').disabled = false; }
  catch { showError('No se pudo encontrar la carpeta. Usa Cambiar para elegir una.'); }
}
window.addEventListener('focus', refreshDestination);
refreshDestination();
