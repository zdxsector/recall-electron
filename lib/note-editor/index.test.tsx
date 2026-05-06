import React from 'react';
import renderer from 'react-test-renderer';

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
  toggleNoteList: jest.fn(),
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
