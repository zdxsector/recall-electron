'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') {
  process.stdout.write('native-auth: macOS native overlay build skipped\n');
  process.exit(0);
}

const optionalBuild = process.env.RECALL_NATIVE_AUTH_OPTIONAL === '1';
const binaryPath = path.resolve(
  __dirname,
  'build',
  'Release',
  'native_auth_overlay.node'
);
const nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js');

function getLocalNodeDir() {
  const nodeDir = path.dirname(path.dirname(process.execPath));
  const nodeHeaderPath = path.join(nodeDir, 'include', 'node', 'node.h');
  const nodeConfigPath = path.join(nodeDir, 'include', 'node', 'config.gypi');

  return fs.existsSync(nodeHeaderPath) && fs.existsSync(nodeConfigPath)
    ? nodeDir
    : null;
}

function hasExplicitHeaderConfig() {
  return Boolean(
    process.env.npm_config_nodedir ||
      process.env.npm_config_disturl ||
      process.env.npm_config_runtime ||
      process.env.npm_config_target
  );
}

const nodeGypArgs = [nodeGypBin, 'rebuild'];
const localNodeDir = getLocalNodeDir();

if (localNodeDir && !hasExplicitHeaderConfig()) {
  nodeGypArgs.push(`--nodedir=${localNodeDir}`);
  process.stdout.write(
    `native-auth: using local Node headers at ${localNodeDir}\n`
  );
}

try {
  execFileSync(process.execPath, nodeGypArgs, {
    cwd: path.resolve(__dirname),
    stdio: 'inherit',
  });
} catch (error) {
  if (!optionalBuild) {
    throw error;
  }

  const hasExistingBinary = fs.existsSync(binaryPath);
  process.stderr.write(
    hasExistingBinary
      ? 'native-auth: rebuild failed; reusing existing native overlay binary for dev\n'
      : 'native-auth: rebuild failed; continuing dev without native overlay binary\n'
  );
}
