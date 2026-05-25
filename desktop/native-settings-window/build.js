'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.platform !== 'darwin') {
  process.stdout.write(
    'native-settings: macOS settings window build skipped\n'
  );
  process.exit(0);
}

const optionalBuild = process.env.RECALL_NATIVE_SETTINGS_OPTIONAL === '1';
const universalBuild = process.env.RECALL_NATIVE_SETTINGS_UNIVERSAL === '1';
const addonDir = path.resolve(__dirname);
const buildDir = path.join(addonDir, 'build', 'Release');
const binaryPath = path.join(buildDir, 'native_settings_window.node');
const objcSourcePath = path.join(addonDir, 'native-settings-window.mm');
const swiftSourcePath = path.join(addonDir, 'native-settings-window.swift');

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: addonDir,
    stdio: 'inherit',
    ...options,
  });
}

function getLocalNodeDir() {
  const nodeDir = path.dirname(path.dirname(process.execPath));
  const nodeHeaderPath = path.join(nodeDir, 'include', 'node', 'node.h');
  const nodeConfigPath = path.join(nodeDir, 'include', 'node', 'config.gypi');

  return fs.existsSync(nodeHeaderPath) && fs.existsSync(nodeConfigPath)
    ? nodeDir
    : null;
}

const macosSdkPath = execFileSync(
  'xcrun',
  ['--sdk', 'macosx', '--show-sdk-path'],
  {
    encoding: 'utf8',
  }
).trim();
const localNodeDir = getLocalNodeDir();

function targetTriple(arch) {
  return `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx12.0`;
}

function lipoArch(arch) {
  return arch === 'x64' ? 'x86_64' : 'arm64';
}

function buildSlice(arch, outputPath) {
  if (!localNodeDir) {
    throw new Error(
      'Could not find local Node headers for native settings build'
    );
  }

  const sliceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `recall-native-settings-${arch}-`)
  );
  const objcObjectPath = path.join(sliceDir, 'native-settings-window.o');
  const swiftObjectPath = path.join(sliceDir, 'native-settings-window-swift.o');
  const nodeIncludeDir = path.join(localNodeDir, 'include', 'node');
  const currentLipoArch = lipoArch(arch);
  const currentTarget = targetTriple(arch);

  try {
    process.stdout.write(`native-settings: building ${arch} SwiftUI slice\n`);
    process.stdout.write(
      `native-settings: using local Node headers at ${localNodeDir}\n`
    );

    run('xcrun', [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-fblocks',
      '-DNAPI_VERSION=8',
      '-mmacosx-version-min=12.0',
      '-isysroot',
      macosSdkPath,
      '-arch',
      currentLipoArch,
      '-I',
      nodeIncludeDir,
      '-c',
      objcSourcePath,
      '-o',
      objcObjectPath,
    ]);

    run('xcrun', [
      'swiftc',
      '-parse-as-library',
      '-target',
      currentTarget,
      '-module-name',
      'RecallNativeSettingsWindow',
      '-emit-object',
      swiftSourcePath,
      '-o',
      swiftObjectPath,
    ]);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    run('xcrun', [
      'swiftc',
      '-target',
      currentTarget,
      '-emit-library',
      objcObjectPath,
      swiftObjectPath,
      '-o',
      outputPath,
      '-framework',
      'AppKit',
      '-framework',
      'Combine',
      '-framework',
      'Foundation',
      '-framework',
      'SwiftUI',
      '-Xlinker',
      '-undefined',
      '-Xlinker',
      'dynamic_lookup',
    ]);

    run('lipo', [outputPath, '-verify_arch', currentLipoArch]);
  } finally {
    fs.rmSync(sliceDir, { recursive: true, force: true });
  }
}

function buildUniversalBinary() {
  const universalBuildDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'recall-native-settings-universal-')
  );

  try {
    const slices = ['x64', 'arm64'].map((arch) => {
      const slicePath = path.join(
        universalBuildDir,
        `native_settings_window-${arch}.node`
      );
      buildSlice(arch, slicePath);
      return slicePath;
    });

    process.stdout.write(
      'native-settings: creating universal settings addon\n'
    );
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    run('lipo', [...slices, '-create', '-output', binaryPath]);
    run('lipo', [binaryPath, '-verify_arch', 'x86_64', 'arm64']);
  } finally {
    fs.rmSync(universalBuildDir, { recursive: true, force: true });
  }
}

try {
  if (universalBuild) {
    buildUniversalBinary();
  } else {
    buildSlice(process.arch === 'x64' ? 'x64' : 'arm64', binaryPath);
  }
} catch (error) {
  if (!optionalBuild) {
    throw error;
  }

  const hasExistingBinary = fs.existsSync(binaryPath);
  process.stderr.write(
    hasExistingBinary
      ? 'native-settings: rebuild failed; reusing existing settings addon binary for dev\n'
      : 'native-settings: rebuild failed; continuing dev without settings addon binary\n'
  );
}
