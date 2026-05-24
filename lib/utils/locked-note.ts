import * as T from '../types';
import { getTitle, normalizeNoteTitleForDisplay } from './note-utils';

export const LOCKED_NOTE_PREVIEW = 'Locked';

export const isNoteLocked = (note?: T.Note | null): boolean =>
  !!note?.locked?.encryptedContent;

export const getLockedNoteTitleFromContent = (content: string): string =>
  normalizeNoteTitleForDisplay(getTitle(content));

export const getLockedNoteTitle = (note?: T.Note | null): string =>
  normalizeNoteTitleForDisplay(
    note?.locked?.previewTitle || getTitle(note?.content || '')
  );

export const createLockedNotePlaceholder = (title: string): string =>
  `# ${normalizeNoteTitleForDisplay(title).replace(/\s+/g, ' ')}\n\n${
    LOCKED_NOTE_PREVIEW
  }`;
