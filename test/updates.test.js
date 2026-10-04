const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../src/updates');

function fixture(enabled = true) {
  const updater = new EventEmitter();
  let checks = 0, installs = 0, busy = false;
  updater.checkForUpdates = async () => { checks++; updater.emit('checking-for-update'); };
  updater.quitAndInstall = () => { installs++; };
  const updates = createUpdates({ updater, enabled, isBusy: () => busy, emit: () => {} });
  return { updater, updates, checks: () => checks, installs: () => installs, busy: value => { busy = value; } };
}
test('actualiza solo cuando está lista y no hay descarga de audio', async () => {
  const f = fixture();
  assert.equal(f.updates.install().ok, false);
  await f.updates.check();
  f.updater.emit('update-downloaded', { version: '1.2.0' });
  f.busy(true);
  assert.equal(f.updates.install().ok, false);
  assert.equal(f.installs(), 0);
  f.busy(false);
  assert.equal(f.updates.install().ok, true);
  assert.equal(f.installs(), 1);
  assert.equal(f.updates.isInstalling(), true);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
});
test('desarrollo y portable no buscan ni instalan actualizaciones', async () => {
  const f = fixture(false);
  await f.updates.check();
  assert.equal(f.checks(), 0);
  assert.equal(f.updates.status().state, 'disabled');
  assert.equal(f.updates.install().ok, false);
});
test('errores de actualización no bloquean reintentos y no pierden una actualización lista', async () => {
  const f = fixture();
  f.updater.emit('error', new Error('offline'));
  assert.equal(f.updates.status().state, 'error');
  await f.updates.check();
  assert.equal(f.checks(), 1);
  f.updater.emit('update-downloaded', { version: '1.2.0' });
  await f.updates.check();
  assert.equal(f.checks(), 1);
  assert.equal(f.updates.status().state, 'ready');
});
