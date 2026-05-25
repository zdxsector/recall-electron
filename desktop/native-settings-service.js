'use strict';

const debugFactory = require('debug');

const debug = debugFactory('native-settings-service');

const listDisplayModes = new Set(['expanded', 'comfy', 'condensed']);
const lineLengths = new Set(['full', 'narrow']);
const fontSizes = new Set(['small', 'normal', 'large', 'extra-large']);
const sortTypes = new Set(['alphabetical', 'creationDate', 'modificationDate']);
const themes = new Set(['system', 'light', 'dark']);
const lockedNotesPasswordModes = new Set(['login', 'custom']);
const commands = new Set([
  'changeLockedNotesPassword',
  'exportNotes',
  'importNotes',
  'showAbout',
  'showKeyboardShortcuts',
]);

const pickString = (value, allowed, fallback) =>
  typeof value === 'string' && allowed.has(value) ? value : fallback;

const pickBoolean = (value, fallback) =>
  typeof value === 'boolean' ? value : fallback;

const normalizeSettings = (settings = {}) => ({
  noteDisplay: pickString(settings.noteDisplay, listDisplayModes, 'comfy'),
  lineLength: pickString(settings.lineLength, lineLengths, 'narrow'),
  fontSize: pickString(settings.fontSize, fontSizes, 'normal'),
  sortType: pickString(settings.sortType, sortTypes, 'modificationDate'),
  sortReversed: pickBoolean(settings.sortReversed, false),
  theme: pickString(settings.theme, themes, 'system'),
  keyboardShortcuts: pickBoolean(settings.keyboardShortcuts, true),
  sendNotifications: pickBoolean(settings.sendNotifications, false),
  lockedNotesPasswordMode: pickString(
    settings.lockedNotesPasswordMode,
    lockedNotesPasswordModes,
    'login'
  ),
  lockedNotesUseTouchId: pickBoolean(settings.lockedNotesUseTouchId, true),
});

const normalizeEvent = (event) => {
  if (!event || typeof event !== 'object') {
    return null;
  }

  if (commands.has(event.action)) {
    return { action: event.action };
  }

  switch (event.action) {
    case 'setNoteDisplay':
      return listDisplayModes.has(event.value)
        ? { action: event.action, value: event.value }
        : null;

    case 'setLineLength':
      return lineLengths.has(event.value)
        ? { action: event.action, value: event.value }
        : null;

    case 'setFontSize':
      return fontSizes.has(event.value)
        ? { action: event.action, value: event.value }
        : null;

    case 'setTheme':
      return themes.has(event.value)
        ? { action: event.action, value: event.value }
        : null;

    case 'setLockedNotesPasswordMode':
      return lockedNotesPasswordModes.has(event.value)
        ? { action: event.action, value: event.value }
        : null;

    case 'setKeyboardShortcuts':
    case 'requestNotifications':
    case 'setLockedNotesUseTouchId':
      return typeof event.checked === 'boolean'
        ? { action: event.action, checked: event.checked }
        : null;

    case 'setSortType':
      return sortTypes.has(event.sortType) &&
        typeof event.sortReversed === 'boolean'
        ? {
            action: event.action,
            sortType: event.sortType,
            sortReversed: event.sortReversed,
          }
        : null;

    default:
      return null;
  }
};

function loadAddon() {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    return require('./native-settings-window');
  } catch (error) {
    debug('native settings addon unavailable: %s', error?.message || error);
    return null;
  }
}

function createNativeSettingsService({ onChange } = {}) {
  const addon = loadAddon();

  if (addon && typeof addon.setChangeHandler === 'function') {
    addon.setChangeHandler((event) => {
      const normalized = normalizeEvent(event);
      if (!normalized) {
        return;
      }
      if (typeof onChange === 'function') {
        onChange(normalized);
      }
    });
  }

  const show = (settings) => {
    if (!addon || typeof addon.show !== 'function') {
      return false;
    }
    addon.show(normalizeSettings(settings));
    return true;
  };

  const updateSettings = (settings) => {
    if (!addon || typeof addon.updateSettings !== 'function') {
      return false;
    }
    addon.updateSettings(normalizeSettings(settings));
    return true;
  };

  return {
    isAvailable: () => !!addon,
    show,
    updateSettings,
  };
}

module.exports = {
  createNativeSettingsService,
  normalizeEvent,
  normalizeSettings,
};
