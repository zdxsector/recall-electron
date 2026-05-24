'use strict';

const {
  registerSecureNotesIpc,
  unlockEncryptedNote,
} = require('../secure-notes-ipc');

const validOverlayPayload = {
  noteId: 'note-1',
  rect: { x: 10, y: 20, width: 58, height: 58 },
  viewportHeight: 800,
  devicePixelRatio: 1,
};

const makeIpcMain = () => {
  const handlers = new Map();
  return {
    handle: jest.fn((channel, handler) => handlers.set(channel, handler)),
    invoke: (channel, event, payload) => handlers.get(channel)(event, payload),
  };
};

const makeBrowserWindow = (win = { isDestroyed: () => false }) => ({
  fromWebContents: jest.fn(() => win),
});

const makeSafeStorage = () => ({
  isEncryptionAvailable: jest.fn(() => true),
  decryptString: jest.fn(() => '# Secret\nBody'),
});

describe('secure notes IPC', () => {
  test('registers required IPC handlers', () => {
    const ipcMain = makeIpcMain();
    registerSecureNotesIpc({
      BrowserWindow: makeBrowserWindow(),
      ipcMain,
      nativeAuthService: {
        authenticate: jest.fn(),
        hide: jest.fn(),
        show: jest.fn(),
        update: jest.fn(),
      },
      safeStorage: makeSafeStorage(),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      'secure-notes:native-auth:show',
      expect.any(Function)
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'secure-notes:native-auth:update',
      expect.any(Function)
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'secure-notes:native-auth:hide',
      expect.any(Function)
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'secure-notes:system-auth:unlock',
      expect.any(Function)
    );
  });

  test('IPC handlers resolve BrowserWindow from event.sender', async () => {
    const ipcMain = makeIpcMain();
    const win = { isDestroyed: () => false };
    const BrowserWindow = makeBrowserWindow(win);
    const nativeAuthService = {
      authenticate: jest.fn(),
      hide: jest.fn(),
      show: jest.fn().mockResolvedValue({ ok: true, code: 'success' }),
      update: jest.fn(),
    };
    registerSecureNotesIpc({
      BrowserWindow,
      ipcMain,
      nativeAuthService,
      safeStorage: makeSafeStorage(),
    });

    const event = { sender: { id: 123 } };
    await expect(
      ipcMain.invoke('secure-notes:native-auth:show', event, {
        ...validOverlayPayload,
        windowId: 'forged-window-id',
      })
    ).resolves.toEqual({ ok: true, code: 'success' });

    expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(event.sender);
    expect(nativeAuthService.show).toHaveBeenCalledWith(
      win,
      expect.objectContaining({ noteId: 'note-1' })
    );
  });

  test('malformed payloads return typed errors', async () => {
    const ipcMain = makeIpcMain();
    registerSecureNotesIpc({
      BrowserWindow: makeBrowserWindow(),
      ipcMain,
      nativeAuthService: {
        authenticate: jest.fn(),
        hide: jest.fn(),
        show: jest.fn().mockResolvedValue({
          ok: false,
          code: 'invalid_rect',
          error: 'invalid_rect',
        }),
        update: jest.fn(),
      },
      safeStorage: makeSafeStorage(),
    });

    await expect(
      ipcMain.invoke('secure-notes:native-auth:show', { sender: {} }, {})
    ).resolves.toEqual({
      ok: false,
      code: 'invalid_rect',
      error: 'invalid_rect',
    });
  });

  test('native addon exceptions are caught and converted to safe errors', async () => {
    const ipcMain = makeIpcMain();
    registerSecureNotesIpc({
      BrowserWindow: makeBrowserWindow(),
      ipcMain,
      nativeAuthService: {
        authenticate: jest.fn(),
        hide: jest.fn(),
        show: jest.fn().mockRejectedValue(new Error('native secret stack')),
        update: jest.fn(),
      },
      safeStorage: makeSafeStorage(),
    });

    await expect(
      ipcMain.invoke(
        'secure-notes:native-auth:show',
        { sender: {} },
        validOverlayPayload
      )
    ).resolves.toEqual({
      ok: false,
      code: 'native_auth_failed',
      error: 'native_auth_failed',
    });
  });

  test('hide can be called repeatedly without crashing', async () => {
    const ipcMain = makeIpcMain();
    const nativeAuthService = {
      authenticate: jest.fn(),
      hide: jest.fn().mockResolvedValue({ ok: true, code: 'success' }),
      show: jest.fn(),
      update: jest.fn(),
    };
    registerSecureNotesIpc({
      BrowserWindow: makeBrowserWindow(),
      ipcMain,
      nativeAuthService,
      safeStorage: makeSafeStorage(),
    });

    await ipcMain.invoke('secure-notes:native-auth:hide', { sender: {} }, {});
    await ipcMain.invoke('secure-notes:native-auth:hide', { sender: {} }, {});
    expect(nativeAuthService.hide).toHaveBeenCalledTimes(2);
  });

  test('success result does not expose secrets to renderer', async () => {
    const result = await unlockEncryptedNote({
      BrowserWindow: makeBrowserWindow(),
      event: { sender: {} },
      nativeAuthService: {
        authenticate: jest.fn(),
        consumeTrustedAuth: jest.fn(() => true),
        isMockMode: () => true,
      },
      payload: {
        noteId: 'note-1',
        encryptedContent: `mock:${Buffer.from('# Secret\nBody').toString(
          'base64'
        )}`,
      },
      safeStorage: makeSafeStorage(),
    });

    expect(result).toEqual({
      ok: true,
      code: 'success',
      content: '# Secret\nBody',
    });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('key');
    expect(result).not.toHaveProperty('encryptedContent');
  });

  test('renderer cannot unlock without trusted native success', async () => {
    const safeStorage = makeSafeStorage();
    const result = await unlockEncryptedNote({
      BrowserWindow: makeBrowserWindow(),
      event: { sender: {} },
      nativeAuthService: {
        authenticate: jest.fn().mockResolvedValue({
          ok: false,
          code: 'native_auth_required',
        }),
        consumeTrustedAuth: jest.fn(() => false),
        isMockMode: () => false,
      },
      payload: {
        noteId: 'note-1',
        encryptedContent: 'YWJjMTIz',
      },
      safeStorage,
    });

    expect(result).toEqual({
      ok: false,
      code: 'native_auth_required',
      error: 'native_auth_required',
    });
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  test('explicit fallback unlock passes allowModalFallback to NativeAuthService', async () => {
    const authenticate = jest
      .fn()
      .mockResolvedValue({ ok: true, code: 'success' });
    const result = await unlockEncryptedNote({
      BrowserWindow: makeBrowserWindow(),
      event: { sender: {} },
      nativeAuthService: {
        authenticate,
        consumeTrustedAuth: jest.fn(() => false),
        isMockMode: () => true,
      },
      payload: {
        allowModalFallback: true,
        noteId: 'note-1',
        encryptedContent: `mock:${Buffer.from('# Secret\nBody').toString(
          'base64'
        )}`,
      },
      safeStorage: makeSafeStorage(),
    });

    expect(authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ allowModalFallback: true, noteId: 'note-1' })
    );
    expect(result).toEqual({
      ok: true,
      code: 'success',
      content: '# Secret\nBody',
    });
  });

  test('cancelled auth does not decrypt content', async () => {
    const safeStorage = makeSafeStorage();
    const result = await unlockEncryptedNote({
      BrowserWindow: makeBrowserWindow(),
      event: { sender: {} },
      nativeAuthService: {
        authenticate: jest
          .fn()
          .mockResolvedValue({ ok: false, code: 'cancelled' }),
        isMockMode: () => false,
      },
      payload: {
        noteId: 'note-1',
        encryptedContent: 'YWJjMTIz',
      },
      safeStorage,
    });

    expect(result).toEqual({
      ok: false,
      code: 'cancelled',
      error: 'cancelled',
    });
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  test('mock mode requires mock ciphertext and does not call safeStorage', async () => {
    const safeStorage = makeSafeStorage();
    const result = await unlockEncryptedNote({
      BrowserWindow: makeBrowserWindow(),
      event: { sender: {} },
      nativeAuthService: {
        authenticate: jest
          .fn()
          .mockResolvedValue({ ok: true, code: 'success' }),
        isMockMode: () => true,
      },
      payload: {
        noteId: 'note-1',
        encryptedContent: 'YWJjMTIz',
      },
      safeStorage,
    });

    expect(result).toEqual({
      ok: false,
      code: 'mock_encrypted_content_required',
      error: 'mock_encrypted_content_required',
    });
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  test('failed auth does not decrypt content', async () => {
    const safeStorage = makeSafeStorage();
    const result = await unlockEncryptedNote({
      BrowserWindow: makeBrowserWindow(),
      event: { sender: {} },
      nativeAuthService: {
        authenticate: jest
          .fn()
          .mockResolvedValue({ ok: false, code: 'authentication_failed' }),
        isMockMode: () => false,
      },
      payload: {
        noteId: 'note-1',
        encryptedContent: 'YWJjMTIz',
      },
      safeStorage,
    });

    expect(result).toEqual({
      ok: false,
      code: 'authentication_failed',
      error: 'authentication_failed',
    });
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  test('missing noteId is handled safely', async () => {
    await expect(
      unlockEncryptedNote({
        BrowserWindow: makeBrowserWindow(),
        event: { sender: {} },
        nativeAuthService: {
          authenticate: jest.fn(),
          isMockMode: () => false,
        },
        payload: { encryptedContent: 'YWJjMTIz' },
        safeStorage: makeSafeStorage(),
      })
    ).resolves.toEqual({
      ok: false,
      code: 'missing_note_id',
      error: 'missing_note_id',
    });
  });

  test('no decrypted note body, encryption key, or password is logged', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await unlockEncryptedNote({
      BrowserWindow: makeBrowserWindow(),
      event: { sender: {} },
      nativeAuthService: {
        authenticate: jest
          .fn()
          .mockResolvedValue({ ok: true, code: 'success' }),
        isMockMode: () => true,
      },
      payload: {
        noteId: 'note-1',
        encryptedContent: `mock:${Buffer.from('# Secret\nBody').toString(
          'base64'
        )}`,
      },
      safeStorage: makeSafeStorage(),
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
