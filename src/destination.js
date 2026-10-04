const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const plist = require('plist');
const exec = promisify(execFile);

async function usbDestinations() {
  try {
    if (process.platform === 'win32') {
      const script = "$ErrorActionPreference='Stop'; $letters=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object {$_.DeviceID}); try { Get-Disk | Where-Object BusType -eq USB | Get-Partition | Where-Object DriveLetter | ForEach-Object {$letters+=([string]$_.DriveLetter+':')} } catch {}; ConvertTo-Json -Compress -InputObject @($letters | Sort-Object -Unique)";
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 7000 });
      return JSON.parse(stdout.replace(/^\uFEFF/, '')).map(letter => letter + '\\');
    }
    if (process.platform === 'darwin') {
      const entries = await fs.readdir('/Volumes', { withFileTypes: true });
      const results = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
        const mount = path.join('/Volumes', entry.name);
        try {
          const { stdout } = await exec('/usr/sbin/diskutil', ['info', '-plist', mount], { timeout: 4000 });
          const info = plist.parse(stdout);
          return info.BusProtocol === 'USB' && !info.Internal && info.Writable && info.MountPoint === mount ? mount : null;
        } catch { return null; }
      }));
      return results.filter(Boolean).sort();
    }
  } catch { /* Fallback also covers hosts without PowerShell Storage cmdlets. */ }
  return [];
}

async function defaultDestination(downloads, discover = usbDestinations) {
  for (const candidate of await discover()) {
    try { await fs.access(candidate, constants.W_OK); return { path: candidate, usb: true }; } catch {}
  }
  await fs.mkdir(downloads, { recursive: true });
  return { path: downloads, usb: false };
}
module.exports = { defaultDestination, usbDestinations };
