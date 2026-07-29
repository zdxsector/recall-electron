const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const getAppPath = (params) => {
  const appName = params?.packager?.appInfo?.productFilename;
  if (!params?.appOutDir || !appName) {
    throw new Error(
      'afterSign did not provide the packaged macOS application.'
    );
  }

  return path.join(params.appOutDir, `${appName}.app`);
};

const getCodeSigningInfo = (appPath, run = spawnSync) => {
  const result = run('codesign', ['--display', '--verbose=4', appPath], {
    encoding: 'utf8',
  });
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;

  if (result?.error || result?.status !== 0) {
    throw new Error(
      `Unable to inspect the macOS code signature for ${appPath}. ${output.trim()}`
    );
  }

  return output;
};

const assertDeveloperIdSignature = (appPath, run) => {
  const signingInfo = getCodeSigningInfo(appPath, run);
  const hasDeveloperIdAuthority = /^Authority=Developer ID Application:/m.test(
    signingInfo
  );
  const teamIdentifier = signingInfo
    .match(/^TeamIdentifier=(.+)$/m)?.[1]
    ?.trim();

  if (
    !hasDeveloperIdAuthority ||
    !teamIdentifier ||
    teamIdentifier === 'not set'
  ) {
    throw new Error(
      'Refusing to package a macOS release without a Developer ID Application signature and TeamIdentifier. ' +
        'Install or provide the production signing certificate via CSC_LINK/CSC_KEY_PASSWORD, then rebuild.'
    );
  }
};

const isAdhocLocalMacBuild = (env = process.env) =>
  env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && env.SKIP_NOTARIZE === 'true';

module.exports = async function (params) {
  if (process.platform !== 'darwin') {
    return;
  }

  const appPath = getAppPath(params);
  if (!fs.existsSync(appPath)) {
    throw new Error(`Cannot find application at: ${appPath}`);
  }

  if (isAdhocLocalMacBuild()) {
    // eslint-disable-next-line no-console
    console.log(
      'Building an ad-hoc local macOS artifact; it must not be used for a release or update.'
    );
    return;
  }

  // Normal packaging remains a release path and requires a stable Developer ID
  // signature before it can be notarized or distributed.
  assertDeveloperIdSignature(appPath);

  // SKIP_NOTARIZE is valid for signed internal builds.
  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('SKIP_NOTARIZE=true - skipping notarization.'); // eslint-disable-line no-console
    return;
  }

  const appStoreConnectKeyPath = path.join(
    process.env.HOME,
    '.configure',
    'recall-electron',
    'secrets',
    'app_store_connect_api_key.p8'
  );

  const envPath = path.join(process.env.HOME, '.a8c-apps/recall-electron.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    let missing = [];
    if (process.env.APP_STORE_CONNECT_API_KEY_KEY_ID === undefined) {
      missing.push('APP_STORE_CONNECT_API_KEY_KEY_ID');
    }
    if (process.env.APP_STORE_CONNECT_API_KEY_ISSUER_ID === undefined) {
      missing.push('APP_STORE_CONNECT_API_KEY_ISSUER_ID');
    }
    if (!fs.existsSync(appStoreConnectKeyPath)) {
      missing.push(`Key file at ${appStoreConnectKeyPath}`);
    }

    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Notarization credentials not found (${missing.join(', ')}). ` +
          'Skipping notarization. Set SKIP_NOTARIZE=true to silence this warning, ' +
          'or provide credentials for production builds.'
      );
      return;
    }
    console.log('All required env vars found. Moving on...'); // eslint-disable-line no-console
  }

  // Same appId in electron-builder.
  let appId = 'com.automattic.recall';

  console.log(`Notarizing ${appId} found at ${appPath}`); // eslint-disable-line no-console

  try {
    const electron_notarize = require('@electron/notarize');
    await electron_notarize.notarize({
      appPath: appPath,
      appleApiKey: appStoreConnectKeyPath,
      appleApiKeyId: process.env.APP_STORE_CONNECT_API_KEY_KEY_ID,
      appleApiIssuer: process.env.APP_STORE_CONNECT_API_KEY_ISSUER_ID,
    });
  } catch (error) {
    throw new Error(`Notarization failed with error:\n${error}`);
  }

  console.log(`Done notarizing ${appId}`); // eslint-disable-line no-console
};

module.exports.assertDeveloperIdSignature = assertDeveloperIdSignature;
module.exports.getAppPath = getAppPath;
module.exports.getCodeSigningInfo = getCodeSigningInfo;
module.exports.isAdhocLocalMacBuild = isAdhocLocalMacBuild;
