// Static GitHub Pages export. Keep native/Replit configuration unchanged.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'app.json');
const original = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(original);
const basePath = (process.env.PAGES_BASE_PATH || '').replace(/\/+$/, '');
if (basePath && !/^\/[A-Za-z0-9._/-]+$/.test(basePath)) {
  throw new Error('PAGES_BASE_PATH must be empty or a URL path such as /focus-garden.');
}

config.expo.web = { ...config.expo.web, output: 'static' };
config.expo.experiments = { ...config.expo.experiments, baseUrl: basePath };

try {
  // Expo reads baseUrl from static app.json; restore it even if export fails.
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const result = spawnSync(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', 'dist'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1' } },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Web export failed (${result.status ?? result.signal}).`);
  // GitHub Pages must serve Expo's _expo folder rather than filtering it as Jekyll content.
  fs.writeFileSync(path.join(root, 'dist', '.nojekyll'), '');
} finally {
  fs.writeFileSync(configPath, original);
}
