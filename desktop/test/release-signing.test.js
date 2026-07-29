'use strict';

const {
  assertDeveloperIdSignature,
  getAppPath,
  isAdhocLocalMacBuild,
} = require('../../after_sign_hook');

const signedOutput = [
  'Authority=Developer ID Application: Automattic, Inc. (TEAM123456)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=TEAM123456',
].join('\n');

describe('macOS release signing checks', () => {
  test('accepts a Developer ID application signature with a Team ID', () => {
    expect(() =>
      assertDeveloperIdSignature('/tmp/Recall.app', () => ({
        status: 0,
        stderr: signedOutput,
        stdout: '',
      }))
    ).not.toThrow();
  });

  test('rejects an ad-hoc signature before release artifacts are created', () => {
    expect(() =>
      assertDeveloperIdSignature('/tmp/Recall.app', () => ({
        status: 0,
        stderr: 'Signature=adhoc\nTeamIdentifier=not set',
        stdout: '',
      }))
    ).toThrow(/Developer ID Application signature and TeamIdentifier/);
  });

  test('rejects a signature that has no Team ID', () => {
    expect(() =>
      assertDeveloperIdSignature('/tmp/Recall.app', () => ({
        status: 0,
        stderr:
          'Authority=Developer ID Application: Recall\nTeamIdentifier=not set',
        stdout: '',
      }))
    ).toThrow(/Developer ID Application signature and TeamIdentifier/);
  });

  test('requires afterSign to provide a packaged application path', () => {
    expect(() => getAppPath({})).toThrow(
      /did not provide the packaged macOS application/
    );
  });

  test('allows an explicitly ad-hoc local build only when notarization is skipped', () => {
    expect(
      isAdhocLocalMacBuild({
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        SKIP_NOTARIZE: 'true',
      })
    ).toBe(true);
    expect(
      isAdhocLocalMacBuild({
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      })
    ).toBe(false);
  });
});
