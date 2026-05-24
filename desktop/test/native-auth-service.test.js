'use strict';

const { createNativeAuthService } = require('../native-auth-service');

const validOverlayPayload = {
  noteId: 'note-1',
  rect: { x: 10, y: 20, width: 58, height: 58 },
  viewportHeight: 800,
  devicePixelRatio: 1,
};

const mockApp = (isPackaged = false) => ({ isPackaged });

describe('NativeAuthService', () => {
  test('mock success returns success without calling native APIs', async () => {
    const promptTouchID = jest.fn();
    const addon = { authenticate: jest.fn(), show: jest.fn() };
    const service = createNativeAuthService({
      app: mockApp(),
      env: {
        NODE_ENV: 'test',
        SECURE_NOTES_AUTH_MOCK: '1',
        SECURE_NOTES_AUTH_MOCK_RESULT: 'success',
      },
      nativeAddon: addon,
      platform: 'darwin',
      systemPreferences: { promptTouchID },
    });

    await expect(service.show({}, validOverlayPayload)).resolves.toEqual({
      ok: true,
      code: 'success',
    });
    expect(service.consumeTrustedAuth('note-1')).toBe(true);
    await expect(
      service.authenticate({
        allowModalFallback: true,
        noteId: 'note-1',
        reason: 'Open note',
      })
    ).resolves.toEqual({
      ok: true,
      code: 'embedded_ui_unavailable_using_modal_fallback',
    });
    expect(promptTouchID).not.toHaveBeenCalled();
    expect(addon.authenticate).not.toHaveBeenCalled();
    expect(addon.show).not.toHaveBeenCalled();
  });

  test.each([
    ['cancel', 'cancelled'],
    ['failure', 'authentication_failed'],
    ['unavailable', 'unavailable'],
    ['timeout', 'timeout'],
  ])('mock %s returns typed %s result', async (mockResult, code) => {
    const service = createNativeAuthService({
      app: mockApp(),
      env: {
        NODE_ENV: 'test',
        SECURE_NOTES_AUTH_MOCK: '1',
        SECURE_NOTES_AUTH_MOCK_RESULT: mockResult,
      },
      platform: 'darwin',
    });

    await expect(service.show({}, validOverlayPayload)).resolves.toEqual({
      ok: false,
      code,
      error: code,
    });
  });

  test('mock mode is disabled in packaged production builds', async () => {
    const promptTouchID = jest.fn().mockResolvedValue(undefined);
    const service = createNativeAuthService({
      app: mockApp(true),
      env: {
        NODE_ENV: 'production',
        SECURE_NOTES_AUTH_MOCK: '1',
        SECURE_NOTES_AUTH_MOCK_RESULT: 'success',
      },
      nativeAddon: null,
      platform: 'darwin',
      systemPreferences: { promptTouchID },
    });

    expect(service.isMockMode()).toBe(false);
    await expect(service.show({}, validOverlayPayload)).resolves.toEqual({
      ok: false,
      code: 'embedded_ui_unavailable',
      error: 'embedded_ui_unavailable',
    });
    await expect(service.authenticate({ noteId: 'note-1' })).resolves.toEqual({
      ok: false,
      code: 'native_auth_required',
      error: 'native_auth_required',
    });
    await expect(
      service.authenticate({
        allowModalFallback: true,
        noteId: 'note-1',
      })
    ).resolves.toEqual({
      ok: true,
      code: 'embedded_ui_unavailable_using_modal_fallback',
    });
    expect(promptTouchID).toHaveBeenCalledTimes(1);
  });

  test('unsupported platform returns typed error outside mock mode', async () => {
    const service = createNativeAuthService({
      app: mockApp(),
      env: { NODE_ENV: 'test' },
      nativeAddon: null,
      platform: 'linux',
    });

    await expect(service.authenticate({ noteId: 'note-1' })).resolves.toEqual({
      ok: false,
      code: 'unsupported_platform',
      error: 'unsupported_platform',
    });
  });

  test('missing noteId is handled safely', async () => {
    const service = createNativeAuthService({
      app: mockApp(),
      env: {
        NODE_ENV: 'test',
        SECURE_NOTES_AUTH_MOCK: '1',
        SECURE_NOTES_AUTH_MOCK_RESULT: 'success',
      },
    });

    await expect(service.authenticate({})).resolves.toEqual({
      ok: false,
      code: 'missing_note_id',
      error: 'missing_note_id',
    });
  });

  test('explicit fallback promptTouchID is used when native addon fails to load', async () => {
    const promptTouchID = jest.fn().mockResolvedValue(undefined);
    const service = createNativeAuthService({
      app: mockApp(),
      env: { NODE_ENV: 'test' },
      loadAddon: () => {
        throw new Error('load failed');
      },
      platform: 'darwin',
      systemPreferences: { promptTouchID },
    });

    await expect(service.show({}, validOverlayPayload)).resolves.toEqual({
      ok: false,
      code: 'native_addon_load_failed',
      error: 'native_addon_load_failed',
    });
    await expect(service.authenticate({ noteId: 'note-1' })).resolves.toEqual({
      ok: false,
      code: 'native_auth_required',
      error: 'native_auth_required',
    });
    await expect(
      service.authenticate({
        allowModalFallback: true,
        noteId: 'note-1',
      })
    ).resolves.toEqual({
      ok: true,
      code: 'embedded_ui_unavailable_using_modal_fallback',
    });
    expect(promptTouchID).toHaveBeenCalledTimes(1);
  });

  test('native addon exceptions are converted to safe errors', async () => {
    const service = createNativeAuthService({
      app: mockApp(),
      env: { NODE_ENV: 'test' },
      nativeAddon: {
        authenticate: jest.fn().mockRejectedValue(new Error('native boom')),
      },
      platform: 'darwin',
    });

    await expect(
      service.authenticate({ allowModalFallback: true, noteId: 'note-1' })
    ).resolves.toEqual({
      ok: false,
      code: 'native_addon_failed',
      error: 'native_addon_failed',
    });
  });

  test('hide can be called repeatedly without crashing', async () => {
    const service = createNativeAuthService({
      app: mockApp(),
      env: {
        NODE_ENV: 'test',
        SECURE_NOTES_AUTH_MOCK: '1',
        SECURE_NOTES_AUTH_MOCK_RESULT: 'success',
      },
      platform: 'darwin',
    });

    await expect(service.hide({}, { noteId: 'note-1' })).resolves.toEqual({
      ok: true,
      code: 'success',
    });
    await expect(service.hide({}, { noteId: 'note-1' })).resolves.toEqual({
      ok: true,
      code: 'success',
    });
  });
});
