// Developer tool: bump, validate, commit, tag and push. GitHub builds a draft release.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root, shell: false, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} falló. ${capture ? result.stderr.trim() : ''}`);
  return capture ? result.stdout.trim() : '';
}
const git = (...args) => run('git', args, true);
const npm = (...args) => {
  if (!process.env.npm_execpath) throw new Error('Ejecuta este script con npm run release.');
  return run(process.execPath, [process.env.npm_execpath, ...args]);
};

try {
  const bump = process.argv[2] || 'patch';
  if (process.argv.length > 3 || !['patch', 'minor', 'major'].includes(bump)) {
    throw new Error('Uso: npm run release [-- patch|minor|major]');
  }
  if (git('branch', '--show-current') !== 'main') throw new Error('Cambia a main antes de crear una versión.');
  if (git('status', '--porcelain')) throw new Error('Haz commit de tus cambios antes de crear una versión.');
  git('fetch', 'origin', '--tags');
  git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('La versión actual debe tener el formato X.Y.Z.');
  const parts = pkg.version.split('.').map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index]++;
  for (let i = index + 1; i < 3; i++) parts[i] = 0;
  const version = parts.join('.'), tag = `v${version}`;
  if (git('tag', '--list', tag)) throw new Error(`El tag ${tag} ya existe.`);
  console.log(`Preparando ${tag}…`);
  npm('version', version, '--no-git-tag-version', '--ignore-scripts');
  npm('run', 'check');
  npm('test');
  git('diff', '--check');
  git('add', '--', 'package.json', 'package-lock.json');
  git('commit', '-m', `chore: release version ${version}`);
  git('tag', tag);
  // Publish the branch and tag together, or neither if GitHub rejects the push.
  run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`]);
  console.log(`${tag} subido. Revisa Actions → Windows release y prueba el borrador antes de publicarlo.`);
} catch (error) {
  console.error(`No se completó el release: ${error.message}`);
  console.error('Los cambios locales se conservan. Revisa git status y los tags antes de reintentar.');
  process.exitCode = 1;
}
