import React from 'react';
import renderer from 'react-test-renderer';

import { NoteCell } from './note-cell';
import * as T from '../types';

const baseNote: T.Note = {
  content: '# Image note\n\n![Preview](https://example.com/image.png)',
  creationDate: 1,
  deleted: false,
  modificationDate: 1,
  systemTags: [],
  tags: [],
};

const baseProps = {
  displayMode: 'comfy' as T.ListDisplayMode,
  folders: [],
  hasPendingChanges: false,
  invalidateHeight: jest.fn(),
  isOffline: false,
  isOpened: false,
  lastUpdated: 1,
  note: baseNote,
  noteId: 'note-1' as T.EntityId,
  notebooks: [],
  openNote: jest.fn(),
  pinNote: jest.fn(),
  searchQuery: '',
  style: {},
};

describe('NoteCell', () => {
  it('renders thumbnail images with async decoding', () => {
    const tree = renderer.create(<NoteCell {...baseProps} />);

    const image = tree.root.findByType('img');

    expect(image.props.loading).toBe('lazy');
    expect(image.props.decoding).toBe('async');
  });
});
