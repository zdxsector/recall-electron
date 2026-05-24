'use strict';

const MAX_LOCKED_NOTE_BYTES = 10 * 1024 * 1024;

const errorResult = (code) => ({ ok: false, code, error: code });

const isValidNoteContent = (content) =>
  typeof content === 'string' &&
  Buffer.byteLength(content, 'utf8') <= MAX_LOCKED_NOTE_BYTES;

const isValidEncryptedContent = (content, { allowMock = false } = {}) => {
  if (
    allowMock &&
    typeof content === 'string' &&
    content.startsWith('mock:') &&
    content.length <= MAX_LOCKED_NOTE_BYTES * 2
  ) {
    return /^[A-Za-z0-9+/=]+$/.test(content.slice('mock:'.length));
  }

  return (
    typeof content === 'string' &&
    content.length > 0 &&
    content.length <= MAX_LOCKED_NOTE_BYTES * 2 &&
    /^[A-Za-z0-9+/=]+$/.test(content)
  );
};

const isValidNoteId = (noteId, { allowLegacy = false } = {}) =>
  (allowLegacy && noteId === '__legacy_locked_note__') ||
  (typeof noteId === 'string' &&
    noteId.length > 0 &&
    noteId.length <= 256 &&
    /^[A-Za-z0-9._:-]+$/.test(noteId));

const resolveSenderWindow = (BrowserWindow, event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
      return null;
    }
    return win;
  } catch {
    return null;
  }
};

const decryptMockContent = (encryptedContent) => {
  const encoded = String(encryptedContent).slice('mock:'.length);
  return Buffer.from(encoded, 'base64').toString('utf8');
};

const decryptWithSafeStorage = (safeStorage, encryptedContent) => {
  if (!safeStorage?.isEncryptionAvailable()) {
    return errorResult('encryption_unavailable');
  }

  try {
    const content = safeStorage.decryptString(
      Buffer.from(encryptedContent, 'base64')
    );
    return { ok: true, content };
  } catch {
    return errorResult('decrypt_failed');
  }
};

const unlockEncryptedNote = async ({
  BrowserWindow,
  event,
  nativeAuthService,
  payload = {},
  safeStorage,
  allowLegacyNoteId = false,
}) => {
  const win = resolveSenderWindow(BrowserWindow, event);
  if (!win) {
    return errorResult('untrusted_sender');
  }

  const noteId = payload?.noteId;
  if (!isValidNoteId(noteId, { allowLegacy: allowLegacyNoteId })) {
    return errorResult('missing_note_id');
  }

  const allowMockContent =
    typeof nativeAuthService?.isMockMode === 'function' &&
    nativeAuthService.isMockMode();
  const encryptedContent = payload?.encryptedContent;
  if (
    !isValidEncryptedContent(encryptedContent, { allowMock: allowMockContent })
  ) {
    return errorResult('invalid_encrypted_content');
  }

  const hasTrustedNativeAuth =
    typeof nativeAuthService?.consumeTrustedAuth === 'function' &&
    nativeAuthService.consumeTrustedAuth(noteId);
  let authCode = 'success';

  if (!hasTrustedNativeAuth) {
    let authResult;
    try {
      authResult = await nativeAuthService.authenticate({
        allowModalFallback: payload?.allowModalFallback === true,
        noteId,
        reason: payload?.reason,
      });
    } catch {
      return errorResult('authentication_failed');
    }

    if (!authResult?.ok) {
      return errorResult(authResult?.code || 'authentication_failed');
    }
    authCode = authResult.code || 'success';
  }

  if (allowMockContent && String(encryptedContent).startsWith('mock:')) {
    return {
      ok: true,
      code: authCode,
      content: decryptMockContent(encryptedContent),
    };
  }

  if (allowMockContent) {
    return errorResult('mock_encrypted_content_required');
  }

  const decrypted = decryptWithSafeStorage(safeStorage, encryptedContent);
  return decrypted.ok ? { ...decrypted, code: authCode } : decrypted;
};

const registerSecureNotesIpc = ({
  BrowserWindow,
  ipcMain,
  nativeAuthService,
  safeStorage,
}) => {
  const withSenderWindow = async (event, callback) => {
    const win = resolveSenderWindow(BrowserWindow, event);
    if (!win) {
      return errorResult('untrusted_sender');
    }

    try {
      return await callback(win);
    } catch {
      return errorResult('native_auth_failed');
    }
  };

  ipcMain.handle('secure-notes:native-auth:show', (event, payload = {}) =>
    withSenderWindow(event, (win) => nativeAuthService.show(win, payload))
  );

  ipcMain.handle('secure-notes:native-auth:update', (event, payload = {}) =>
    withSenderWindow(event, (win) => nativeAuthService.update(win, payload))
  );

  ipcMain.handle('secure-notes:native-auth:hide', (event, payload = {}) =>
    withSenderWindow(event, (win) => nativeAuthService.hide(win, payload))
  );

  ipcMain.handle('secure-notes:system-auth:unlock', (event, payload = {}) =>
    unlockEncryptedNote({
      BrowserWindow,
      event,
      nativeAuthService,
      payload,
      safeStorage,
    })
  );

  ipcMain.handle('secure-notes:locked-notes:get-login-username', (event) =>
    withSenderWindow(event, () => nativeAuthService.getLoginUsername())
  );

  ipcMain.handle('secure-notes:locked-notes:has-custom-password', (event) =>
    withSenderWindow(event, () => nativeAuthService.hasCustomPassword())
  );

  ipcMain.handle(
    'secure-notes:locked-notes:change-password',
    (event, payload = {}) =>
      withSenderWindow(event, (win) =>
        nativeAuthService.changeCustomPassword(win, {
          reason:
            typeof payload?.reason === 'string' ? payload.reason : undefined,
        })
      )
  );

  ipcMain.handle('secure-notes:test-events:get', () => {
    if (typeof nativeAuthService.getTestEvents !== 'function') {
      return [];
    }

    return nativeAuthService.getTestEvents();
  });

  return {
    cleanupWindow: (win, noteId) => {
      Promise.resolve(nativeAuthService.hide(win, { noteId })).catch(() => {
        // best-effort cleanup
      });
    },
  };
};

module.exports = {
  isValidEncryptedContent,
  isValidNoteContent,
  registerSecureNotesIpc,
  resolveSenderWindow,
  unlockEncryptedNote,
};
