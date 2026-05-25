'use strict';

const {
  normalizeEvent,
  normalizeSettings,
} = require('../native-settings-service');

describe('NativeSettingsService', () => {
  test('normalizes settings with native-safe defaults', () => {
    expect(
      normalizeSettings({
        noteDisplay: 'condensed',
        lineLength: 'full',
        fontSize: 'large',
        sortType: 'alphabetical',
        sortReversed: true,
        theme: 'dark',
        keyboardShortcuts: false,
        sendNotifications: true,
        lockedNotesPasswordMode: 'custom',
        lockedNotesUseTouchId: false,
      })
    ).toEqual({
      noteDisplay: 'condensed',
      lineLength: 'full',
      fontSize: 'large',
      sortType: 'alphabetical',
      sortReversed: true,
      theme: 'dark',
      keyboardShortcuts: false,
      sendNotifications: true,
      lockedNotesPasswordMode: 'custom',
      lockedNotesUseTouchId: false,
    });

    expect(
      normalizeSettings({
        noteDisplay: 'wide',
        lineLength: null,
        fontSize: 'huge',
        sortType: 'edited',
        sortReversed: 'yes',
        theme: 'sepia',
        keyboardShortcuts: 'false',
        sendNotifications: 'true',
        lockedNotesPasswordMode: 'password',
        lockedNotesUseTouchId: 'no',
      })
    ).toEqual({
      noteDisplay: 'comfy',
      lineLength: 'narrow',
      fontSize: 'normal',
      sortType: 'modificationDate',
      sortReversed: false,
      theme: 'system',
      keyboardShortcuts: true,
      sendNotifications: false,
      lockedNotesPasswordMode: 'login',
      lockedNotesUseTouchId: true,
    });
  });

  test('accepts only known native setting events', () => {
    expect(
      normalizeEvent({
        action: 'setSortType',
        sortType: 'creationDate',
        sortReversed: true,
      })
    ).toEqual({
      action: 'setSortType',
      sortType: 'creationDate',
      sortReversed: true,
    });
    expect(
      normalizeEvent({ action: 'setKeyboardShortcuts', checked: false })
    ).toEqual({ action: 'setKeyboardShortcuts', checked: false });
    expect(normalizeEvent({ action: 'importNotes' })).toEqual({
      action: 'importNotes',
    });

    expect(normalizeEvent({ action: 'setSortType', sortType: 'bad' })).toBe(
      null
    );
    expect(
      normalizeEvent({ action: 'setKeyboardShortcuts', checked: 'false' })
    ).toBe(null);
    expect(
      normalizeEvent({ action: 'openExternal', url: 'file:///tmp/x' })
    ).toBe(null);
  });
});
