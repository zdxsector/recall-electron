'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.platform !== 'darwin') {
  process.stdout.write('native-auth: macOS native overlay build skipped\n');
  process.exit(0);
}

const optionalBuild = process.env.RECALL_NATIVE_AUTH_OPTIONAL === '1';
const universalBuild = process.env.RECALL_NATIVE_AUTH_UNIVERSAL === '1';
const overlayDir = path.resolve(__dirname);
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

const localNodeDir = getLocalNodeDir();

function buildNodeGyp(arch) {
  const nodeGypArgs = [nodeGypBin, 'rebuild'];

  if (arch) {
    nodeGypArgs.push(`--arch=${arch}`);
  }

  if (localNodeDir && !hasExplicitHeaderConfig()) {
    nodeGypArgs.push(`--nodedir=${localNodeDir}`);
    process.stdout.write(
      `native-auth: using local Node headers at ${localNodeDir}\n`
    );
  }

  execFileSync(process.execPath, nodeGypArgs, {
    cwd: overlayDir,
    stdio: 'inherit',
  });
}

function buildUniversalBinary() {
  const universalBuildDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'recall-native-auth-')
  );

  try {
    const slices = [
      { nodeGypArch: 'x64', lipoArch: 'x86_64' },
      { nodeGypArch: 'arm64', lipoArch: 'arm64' },
    ].map(({ nodeGypArch, lipoArch }) => {
      process.stdout.write(`native-auth: building ${nodeGypArch} slice\n`);
      buildNodeGyp(nodeGypArch);

      const slicePath = path.join(
        universalBuildDir,
        `native_auth_overlay-${nodeGypArch}.node`
      );
      fs.copyFileSync(binaryPath, slicePath);
      execFileSync('lipo', [slicePath, '-verify_arch', lipoArch], {
        stdio: 'inherit',
      });
      return slicePath;
    });

    process.stdout.write('native-auth: creating universal native overlay\n');
    execFileSync('lipo', [...slices, '-create', '-output', binaryPath], {
      stdio: 'inherit',
    });
    execFileSync('lipo', [binaryPath, '-verify_arch', 'x86_64', 'arm64'], {
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(universalBuildDir, { recursive: true, force: true });
  }
}

try {
  if (universalBuild) {
    buildUniversalBinary();
  } else {
    buildNodeGyp();
  }
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
