import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../note-detail', () => () => null);
jest.mock('../search-results-bar', () => () => null);

import { NoteEditor } from './index';

const baseProps = {
  createNote: jest.fn(),
  hasSearchMatchesInNote: false,
  hasSearchQuery: false,
  isEditorActive: true,
  isSearchActive: false,
  isSmallScreen: false,
  keyboardShortcuts: false,
  note: null,
  noteId: null,
  searchQuery: '',
  storeUnlockedNoteContent: jest.fn(),
  toggleNoteList: jest.fn(),
  unlockedContent: null,
};

describe('NoteEditor empty state', () => {
  it('creates a blank note when the empty editor is clicked', () => {
    const createNote = jest.fn();
    const tree = renderer.create(
      <NoteEditor {...baseProps} createNote={createNote} />
    );

    tree.root.findByProps({ 'aria-label': 'New note editor' }).props.onClick();

    expect(createNote).toHaveBeenCalledWith({ content: '# ' });
  });

  it('uses the first printable key as note content', () => {
    const createNote = jest.fn();
    const preventDefault = jest.fn();
    const tree = renderer.create(
      <NoteEditor {...baseProps} createNote={createNote} />
    );

    tree.root.findByProps({ 'aria-label': 'New note editor' }).props.onKeyDown({
      altKey: false,
      ctrlKey: false,
      key: 'A',
      metaKey: false,
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(createNote).toHaveBeenCalledWith({ content: '# A' });
  });

  it('uses the current search query as the initial title', () => {
    const createNote = jest.fn();
    const tree = renderer.create(
      <NoteEditor
        {...baseProps}
        createNote={createNote}
        searchQuery="Draft title"
      />
    );

    tree.root.findByProps({ 'aria-label': 'New note editor' }).props.onClick();

    expect(createNote).toHaveBeenCalledWith({ content: '# Draft title' });
  });
});

describe('NoteEditor locked state', () => {
  it('uses the password field as a native unlock trigger', async () => {
    const decryptNoteContent = jest.fn().mockResolvedValue({
      ok: true,
      content: '# Secret\nBody',
    });
    const storeUnlockedNoteContent = jest.fn();

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        decryptNoteContent,
        isMac: true,
      },
    });

    const tree = renderer.create(
      <NoteEditor
        {...baseProps}
        note={
          {
            content: '# Secret\n\nLocked',
            creationDate: 1,
            deleted: false,
            locked: {
              encryptedContent: 'YWJjMTIz',
              encryptionVersion: 1,
              lockedAt: 1,
              previewTitle: 'Secret',
            },
            modificationDate: 1,
            systemTags: [],
            tags: [],
          } as any
        }
        noteId={'note-locked' as any}
        storeUnlockedNoteContent={storeUnlockedNoteContent}
      />
    );

    const input = tree.root.findByProps({
      'aria-label': 'Unlock locked note',
    });

    expect(input.props.readOnly).toBe(true);
    expect(input.props.type).toBe('password');

    await act(async () => {
      input.props.onClick();
    });

    expect(decryptNoteContent).toHaveBeenCalledWith({
      encryptedContent: 'YWJjMTIz',
      reason: 'View "Secret" in Recall',
    });
    expect(storeUnlockedNoteContent).toHaveBeenCalledWith(
      'note-locked',
      '# Secret\nBody'
    );
  });
});
