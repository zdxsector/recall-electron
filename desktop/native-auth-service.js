'use strict';

const os = require('os');
const { domRectToAppKitRect } = require('./native-auth-geometry');

const AUTH_RESULT_CODES = new Set([
  'success',
  'cancel',
  'cancelled',
  'error',
  'failure',
  'invalid_password',
  'unavailable',
  'timeout',
]);

const AUTH_METHODS = new Set(['login', 'custom']);
const TRUSTED_AUTH_TTL_MS = 30 * 1000;

const safeReason = (reason) =>
  typeof reason === 'string' && reason.trim()
    ? reason.trim().slice(0, 140)
    : 'View this locked note in Recall';

const isValidNoteId = (noteId) =>
  typeof noteId === 'string' &&
  noteId.length > 0 &&
  noteId.length <= 256 &&
  /^[A-Za-z0-9._:-]+$/.test(noteId);

const errorResult = (code) => ({ ok: false, code, error: code });

const successResult = (code = 'success') => ({ ok: true, code });

const safeAuthMethod = (authMethod) =>
  AUTH_METHODS.has(authMethod) ? authMethod : null;

const safePasswordPlaceholder = (placeholder) =>
  typeof placeholder === 'string' &&
  placeholder.trim().length > 0 &&
  placeholder.trim().length <= 80
    ? placeholder.trim()
    : 'Password';

const normalizeMockResult = (value) => {
  const result = String(value || 'success').toLowerCase();
  return AUTH_RESULT_CODES.has(result) ? result : 'failure';
};

const shouldEnableMockAuth = ({ app, env }) => {
  if (env.SECURE_NOTES_AUTH_MOCK !== '1') {
    return false;
  }

  const isTestRuntime = env.NODE_ENV === 'test' || env.PLAYWRIGHT_TEST === '1';
  const isPackaged = !!app?.isPackaged;

  if (isPackaged && !isTestRuntime) {
    return false;
  }

  return isTestRuntime;
};

const loadNativeAuthAddon = () => {
  const candidates = [
    './native-auth-overlay',
    './native-auth-overlay.node',
    '@recall/native-auth-overlay',
  ];

  for (const request of candidates) {
    try {
      // Optional native dependency. It is intentionally loaded through this
      // narrow boundary so renderer code never reaches native methods directly.
      return require(request);
    } catch {
      // Try the next optional addon location.
    }
  }

  return null;
};

const createNativeAuthService = ({
  app,
  env = process.env,
  nativeAddon,
  platform = process.platform,
  systemPreferences,
  loadAddon = loadNativeAuthAddon,
} = {}) => {
  const testEvents = [];
  const trustedAuthNotes = new Map();
  const isMockMode = shouldEnableMockAuth({ app, env });
  let addonLoadFailed = false;
  let addon = null;

  if (!isMockMode) {
    try {
      addon = nativeAddon === undefined ? loadAddon() : nativeAddon;
    } catch {
      addonLoadFailed = true;
      addon = null;
    }
  }

  const canObserve = () => isMockMode || env.NODE_ENV === 'test';

  const canLogNativeAuth = () =>
    env.RECALL_DEBUG_NATIVE_AUTH === '1' ||
    (env.NODE_ENV === 'development' && !app?.isPackaged);

  const devLog = (message) => {
    if (canLogNativeAuth()) {
      // eslint-disable-next-line no-console
      console.info(message);
    }
  };

  const record = (event, payload = {}) => {
    if (!canObserve()) {
      return;
    }

    const safePayload = {};
    if (typeof payload.noteId === 'string') {
      safePayload.noteId = payload.noteId;
    }
    if (typeof payload.code === 'string') {
      safePayload.code = payload.code;
    }
    if (typeof payload.kind === 'string') {
      safePayload.kind = payload.kind;
    }

    testEvents.push({
      event,
      payload: safePayload,
      timestamp: Date.now(),
    });
  };

  const requireSupportedPlatform = () => {
    if (platform !== 'darwin' && !isMockMode) {
      return errorResult('unsupported_platform');
    }

    return null;
  };

  const grantTrustedAuth = (noteId) => {
    if (isValidNoteId(noteId)) {
      trustedAuthNotes.set(noteId, Date.now());
    }
  };

  const consumeTrustedAuth = (noteId) => {
    if (!isValidNoteId(noteId)) {
      return false;
    }

    const grantedAt = trustedAuthNotes.get(noteId);
    trustedAuthNotes.delete(noteId);

    return (
      typeof grantedAt === 'number' &&
      Date.now() - grantedAt <= TRUSTED_AUTH_TTL_MS
    );
  };

  const recordAuthFailure = (noteId, code) => {
    if (code === 'cancelled' || code === 'cancel') {
      record('auth-result-cancel', { noteId, code: 'cancelled' });
      return;
    }
    if (code === 'timeout') {
      record('auth-result-timeout', { noteId, code: 'timeout' });
      return;
    }
    if (
      code === 'unavailable' ||
      code === 'unsupported_platform' ||
      code === 'system_auth_unavailable' ||
      code === 'embedded_ui_unavailable' ||
      code === 'native_addon_unavailable' ||
      code === 'native_addon_load_failed'
    ) {
      record('auth-result-unavailable', { noteId, code });
      return;
    }
    record('auth-result-failure', {
      noteId,
      code: code || 'authentication_failed',
    });
  };

  const normalizeNativeAuthCode = (
    result,
    fallback = 'authentication_failed'
  ) =>
    typeof result?.code === 'string' && result.code ? result.code : fallback;

  const mockAuthResult = (
    noteId,
    {
      grantTrusted = false,
      successCode = 'success',
      unavailableCode = 'unavailable',
    } = {}
  ) => {
    const result = normalizeMockResult(env.SECURE_NOTES_AUTH_MOCK_RESULT);
    if (result === 'success') {
      if (grantTrusted) {
        grantTrustedAuth(noteId);
      }
      record('auth-result-success', { noteId });
      return successResult(successCode);
    }
    if (result === 'cancel') {
      recordAuthFailure(noteId, 'cancelled');
      return errorResult('cancelled');
    }
    if (result === 'cancelled') {
      recordAuthFailure(noteId, 'cancelled');
      return errorResult('cancelled');
    }
    if (result === 'invalid_password') {
      recordAuthFailure(noteId, 'invalid_password');
      return errorResult('invalid_password');
    }
    if (result === 'timeout') {
      recordAuthFailure(noteId, 'timeout');
      return errorResult('timeout');
    }
    if (result === 'unavailable') {
      recordAuthFailure(noteId, unavailableCode);
      return errorResult(unavailableCode);
    }
    if (result === 'error') {
      recordAuthFailure(noteId, 'verification_error');
      return errorResult('verification_error');
    }

    recordAuthFailure(noteId, 'authentication_failed');
    return errorResult('authentication_failed');
  };

  const normalizeOverlayPayload = (payload = {}) => {
    const noteId = payload?.noteId;
    if (!isValidNoteId(noteId)) {
      return errorResult('missing_note_id');
    }

    const rect = domRectToAppKitRect(payload);
    if (!rect) {
      return errorResult('invalid_rect');
    }

    const normalized = { noteId, rect };
    if (payload?.passwordRect !== undefined) {
      const passwordRect = domRectToAppKitRect({
        ...payload,
        rect: payload.passwordRect,
      });
      if (!passwordRect) {
        return errorResult('invalid_rect');
      }
      normalized.passwordRect = passwordRect;
    }

    const authMethod = safeAuthMethod(payload?.authMethod || 'login');
    if (!authMethod) {
      return errorResult('invalid_auth_method');
    }

    normalized.authMethod = authMethod;
    normalized.passwordPlaceholder = safePasswordPlaceholder(
      payload?.passwordPlaceholder
    );
    normalized.useTouchId = payload?.useTouchId !== false;

    return normalized;
  };

  const callAddonShow = async (win, payload) => {
    const unsupported = requireSupportedPlatform();
    if (unsupported) {
      return unsupported;
    }

    const normalized = normalizeOverlayPayload(payload);
    if (normalized.ok === false) {
      return normalized;
    }

    if (isMockMode) {
      record('auth-overlay-show', { noteId: normalized.noteId });
      if (normalized.passwordRect) {
        record('auth-password-overlay-show', { noteId: normalized.noteId });
      }
      return mockAuthResult(normalized.noteId, { grantTrusted: true });
    }

    if (!addon || typeof addon.show !== 'function') {
      devLog('native-auth: embedded view unavailable');
      record('auth-overlay-show', {
        noteId: normalized.noteId,
        code: addonLoadFailed
          ? 'native_addon_load_failed'
          : 'embedded_ui_unavailable',
      });
      return errorResult(
        addonLoadFailed ? 'native_addon_load_failed' : 'embedded_ui_unavailable'
      );
    }

    try {
      const nativeWindowHandle =
        typeof win?.getNativeWindowHandle === 'function'
          ? win.getNativeWindowHandle()
          : null;
      devLog('native-auth: attempting embedded LAAuthenticationView');
      const addonPayload = {
        authMethod: normalized.authMethod,
        debug: canLogNativeAuth(),
        nativeWindowHandle,
        noteId: normalized.noteId,
        passwordPlaceholder: normalized.passwordPlaceholder,
        reason: safeReason(payload?.reason),
        rect: normalized.rect,
        useTouchId: normalized.useTouchId,
      };
      if (normalized.passwordRect) {
        addonPayload.passwordRect = normalized.passwordRect;
      }
      const result = await addon.show(addonPayload);

      record('auth-overlay-show', { noteId: normalized.noteId });

      if (result?.ok) {
        grantTrustedAuth(normalized.noteId);
        record('auth-result-success', { noteId: normalized.noteId });
        return successResult(normalizeNativeAuthCode(result, 'success'));
      }

      const code = normalizeNativeAuthCode(result);
      if (code === 'embedded_ui_unavailable') {
        devLog('native-auth: embedded view unavailable');
      }
      recordAuthFailure(normalized.noteId, code);
      return errorResult(code);
    } catch {
      record('auth-overlay-show', {
        noteId: normalized.noteId,
        code: 'native_addon_failed',
      });
      return errorResult('native_addon_failed');
    }
  };

  const callAddonUpdate = async (win, payload) => {
    const unsupported = requireSupportedPlatform();
    if (unsupported) {
      return unsupported;
    }

    const normalized = normalizeOverlayPayload(payload);
    if (normalized.ok === false) {
      return normalized;
    }

    if (isMockMode) {
      record('auth-overlay-update', { noteId: normalized.noteId });
      if (normalized.passwordRect) {
        record('auth-password-overlay-update', { noteId: normalized.noteId });
      }
      return successResult();
    }

    if (!addon || typeof addon.update !== 'function') {
      record('auth-overlay-update', {
        noteId: normalized.noteId,
        code: addonLoadFailed
          ? 'native_addon_load_failed'
          : 'native_addon_unavailable',
      });
      return errorResult(
        addonLoadFailed
          ? 'native_addon_load_failed'
          : 'native_addon_unavailable'
      );
    }

    try {
      const nativeWindowHandle =
        typeof win?.getNativeWindowHandle === 'function'
          ? win.getNativeWindowHandle()
          : null;
      const addonPayload = {
        authMethod: normalized.authMethod,
        nativeWindowHandle,
        noteId: normalized.noteId,
        passwordPlaceholder: normalized.passwordPlaceholder,
        rect: normalized.rect,
        useTouchId: normalized.useTouchId,
      };
      if (normalized.passwordRect) {
        addonPayload.passwordRect = normalized.passwordRect;
      }
      const result = await addon.update(addonPayload);
      record('auth-overlay-update', { noteId: normalized.noteId });
      return result?.ok === false
        ? errorResult(normalizeNativeAuthCode(result, 'native_addon_failed'))
        : successResult(normalizeNativeAuthCode(result, 'success'));
    } catch {
      record('auth-overlay-update', {
        noteId: normalized.noteId,
        code: 'native_addon_failed',
      });
      return errorResult('native_addon_failed');
    }
  };

  const hide = async (win, payload = {}) => {
    const noteId = isValidNoteId(payload?.noteId) ? payload.noteId : undefined;
    if (noteId) {
      trustedAuthNotes.delete(noteId);
    } else {
      trustedAuthNotes.clear();
    }

    if (isMockMode) {
      record('auth-overlay-hide', { noteId });
      return successResult();
    }

    if (platform !== 'darwin') {
      return successResult();
    }

    if (!addon || typeof addon.hide !== 'function') {
      record('auth-overlay-hide', {
        noteId,
        code: addonLoadFailed
          ? 'native_addon_load_failed'
          : 'native_addon_unavailable',
      });
      return successResult();
    }

    try {
      const nativeWindowHandle =
        typeof win?.getNativeWindowHandle === 'function'
          ? win.getNativeWindowHandle()
          : null;
      await addon.hide({ nativeWindowHandle, noteId });
      record('auth-overlay-hide', { noteId });
      devLog('native-auth: overlay removed');
      return successResult();
    } catch {
      record('auth-overlay-hide', { noteId, code: 'native_addon_failed' });
      return errorResult('native_addon_failed');
    }
  };

  const authenticate = async (payload = {}) => {
    if (!isValidNoteId(payload?.noteId)) {
      return errorResult('missing_note_id');
    }

    const noteId = payload.noteId;
    const reason = safeReason(payload.reason);

    const unsupported = requireSupportedPlatform();
    if (unsupported) {
      return unsupported;
    }

    if (consumeTrustedAuth(noteId)) {
      record('auth-result-success', { noteId, kind: 'trusted_native_auth' });
      return successResult();
    }

    if (!payload.allowModalFallback) {
      return errorResult('native_auth_required');
    }

    if (isMockMode) {
      return mockAuthResult(noteId, {
        successCode: 'embedded_ui_unavailable_using_modal_fallback',
        unavailableCode: 'system_auth_unavailable',
      });
    }

    if (addon && typeof addon.authenticate === 'function') {
      try {
        devLog('native-auth: falling back to evaluatePolicy modal');
        const result = await addon.authenticate({
          debug: canLogNativeAuth(),
          noteId,
          reason,
        });
        if (result?.ok) {
          record('auth-result-success', { noteId });
          return successResult('embedded_ui_unavailable_using_modal_fallback');
        }
        const code = normalizeNativeAuthCode(result);
        const publicCode =
          code === 'unavailable' ? 'system_auth_unavailable' : code;
        recordAuthFailure(noteId, publicCode);
        return errorResult(publicCode);
      } catch {
        record('auth-result-failure', { noteId, code: 'native_addon_failed' });
        return errorResult('native_addon_failed');
      }
    }

    if (typeof systemPreferences?.promptTouchID !== 'function') {
      record('auth-result-unavailable', {
        noteId,
        code: 'system_auth_unavailable',
      });
      return errorResult('system_auth_unavailable');
    }

    try {
      devLog('native-auth: falling back to evaluatePolicy modal');
      await systemPreferences.promptTouchID(reason);
      record('auth-result-success', { noteId });
      return successResult('embedded_ui_unavailable_using_modal_fallback');
    } catch {
      record('auth-result-cancel', { noteId, code: 'cancelled' });
      return errorResult('cancelled');
    }
  };

  const getLoginUsername = async () => {
    const unsupported = requireSupportedPlatform();
    if (unsupported) {
      return unsupported;
    }

    if (isMockMode) {
      return {
        ok: true,
        code: 'success',
        username: env.SECURE_NOTES_AUTH_MOCK_USERNAME || 'test-user',
      };
    }

    if (addon && typeof addon.getConsoleUsername === 'function') {
      try {
        const result = await addon.getConsoleUsername();
        if (result?.ok && typeof result.username === 'string') {
          return {
            ok: true,
            code: 'success',
            username: result.username.slice(0, 128),
          };
        }
        return errorResult(normalizeNativeAuthCode(result, 'user_not_found'));
      } catch {
        return errorResult('native_addon_failed');
      }
    }

    try {
      const username = os.userInfo().username;
      if (typeof username === 'string' && username) {
        return { ok: true, code: 'success', username: username.slice(0, 128) };
      }
    } catch {
      // Fall through to the safe typed error.
    }

    return errorResult('user_not_found');
  };

  const hasCustomPassword = async () => {
    const unsupported = requireSupportedPlatform();
    if (unsupported) {
      return { ...unsupported, configured: false };
    }

    if (isMockMode) {
      return {
        ok: true,
        code: 'success',
        configured:
          env.SECURE_NOTES_AUTH_MOCK_CUSTOM_PASSWORD_CONFIGURED === '1',
      };
    }

    if (!addon || typeof addon.hasCustomPasswordConfigured !== 'function') {
      return {
        ...errorResult(
          addonLoadFailed
            ? 'native_addon_load_failed'
            : 'native_addon_unavailable'
        ),
        configured: false,
      };
    }

    try {
      const result = await addon.hasCustomPasswordConfigured();
      return {
        ok: result?.ok !== false,
        code: normalizeNativeAuthCode(result, 'success'),
        configured: result?.configured === true,
      };
    } catch {
      return { ...errorResult('native_addon_failed'), configured: false };
    }
  };

  const changeCustomPassword = async (win, payload = {}) => {
    const unsupported = requireSupportedPlatform();
    if (unsupported) {
      return unsupported;
    }

    const noteId = isValidNoteId(payload?.noteId)
      ? payload.noteId
      : 'locked-notes-settings';

    if (isMockMode) {
      return mockAuthResult(noteId, { grantTrusted: false });
    }

    if (!addon || typeof addon.changeCustomPassword !== 'function') {
      return errorResult(
        addonLoadFailed
          ? 'native_addon_load_failed'
          : 'native_addon_unavailable'
      );
    }

    try {
      const nativeWindowHandle =
        typeof win?.getNativeWindowHandle === 'function'
          ? win.getNativeWindowHandle()
          : null;
      const result = await addon.changeCustomPassword({
        nativeWindowHandle,
        noteId,
        reason: safeReason(
          payload?.reason || 'Change the password used for locked notes'
        ),
      });
      if (result?.ok) {
        record('custom-password-change-success', { noteId });
        return successResult(normalizeNativeAuthCode(result, 'success'));
      }
      const code = normalizeNativeAuthCode(result);
      recordAuthFailure(noteId, code);
      return errorResult(code);
    } catch {
      record('auth-result-failure', { noteId, code: 'native_addon_failed' });
      return errorResult('native_addon_failed');
    }
  };

  return {
    authenticate,
    changeCustomPassword,
    consumeTrustedAuth,
    getLoginUsername,
    getTestEvents: () => testEvents.slice(),
    grantTrustedAuth,
    hasCustomPassword,
    hide,
    isAddonLoaded: () => !!addon,
    isMockMode: () => isMockMode,
    show: callAddonShow,
    update: callAddonUpdate,
  };
};

module.exports = {
  createNativeAuthService,
  isValidNoteId,
  normalizeMockResult,
  shouldEnableMockAuth,
};
