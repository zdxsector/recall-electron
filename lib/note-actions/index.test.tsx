import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('focus-trap-react', () => {
  const ReactForMock = require('react');
  const FocusTrapMock = ({ children }: any) =>
    ReactForMock.createElement(ReactForMock.Fragment, null, children);
  FocusTrapMock.displayName = 'FocusTrapMock';
  return FocusTrapMock;
});

import { NoteActions } from './index';

const lockedNote = {
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
} as any;

const baseProps = {
  clearUnlockedNoteContent: jest.fn(),
  editNote: jest.fn(),
  hasRevisions: false,
  isPinned: false,
  note: lockedNote,
  noteId: 'note-locked' as any,
  onFocusTrapDeactivate: jest.fn(),
  pinNote: jest.fn(),
  storeUnlockedNoteContent: jest.fn(),
  toggleRevisions: jest.fn(),
  trashNote: jest.fn(),
  unlockedContent: null,
};

const setupElectron = (unlockResult: any) => {
  const unlock = jest.fn().mockResolvedValue(unlockResult);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      secureNotes: {
        systemAuth: { unlock },
      },
    },
  });
  return { unlock };
};

const findButtonByText = (tree: renderer.ReactTestRenderer, text: string) => {
  const button = tree.root
    .findAllByType('button')
    .find((node) =>
      node
        .findAllByProps({ className: 'note-actions-name' })
        .some((label) => label.children.join('') === text)
    );

  if (!button) {
    throw new Error(`Could not find button with text: ${text}`);
  }

  return button;
};

describe('NoteActions locked note actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows remove lock for locked notes', () => {
    const tree = renderer.create(<NoteActions {...baseProps} />);

    expect(findButtonByText(tree, 'Unlock Note')).toBeTruthy();
    expect(findButtonByText(tree, 'Remove Lock')).toBeTruthy();
  });

  it('removes lock only after system authentication succeeds', async () => {
    const electron = setupElectron({ ok: true, content: '# Secret\nBody' });
    const clearUnlockedNoteContent = jest.fn();
    const editNote = jest.fn();
    const onFocusTrapDeactivate = jest.fn();
    const tree = renderer.create(
      <NoteActions
        {...baseProps}
        clearUnlockedNoteContent={clearUnlockedNoteContent}
        editNote={editNote}
        onFocusTrapDeactivate={onFocusTrapDeactivate}
      />
    );

    await act(async () => {
      await findButtonByText(tree, 'Remove Lock').props.onClick();
    });

    expect(electron.unlock).toHaveBeenCalledWith({
      allowModalFallback: true,
      noteId: 'note-locked',
      encryptedContent: 'YWJjMTIz',
      reason: 'Remove lock from "Secret" in Recall',
    });
    expect(editNote).toHaveBeenCalledWith('note-locked', {
      content: '# Secret\nBody',
      locked: null,
    });
    expect(clearUnlockedNoteContent).toHaveBeenCalledWith('note-locked');
    expect(onFocusTrapDeactivate).toHaveBeenCalled();
  });

  it('keeps the lock when system authentication is cancelled', async () => {
    setupElectron({ ok: false, code: 'cancelled' });
    const clearUnlockedNoteContent = jest.fn();
    const editNote = jest.fn();
    const tree = renderer.create(
      <NoteActions
        {...baseProps}
        clearUnlockedNoteContent={clearUnlockedNoteContent}
        editNote={editNote}
      />
    );

    await act(async () => {
      await findButtonByText(tree, 'Remove Lock').props.onClick();
    });

    expect(editNote).not.toHaveBeenCalled();
    expect(clearUnlockedNoteContent).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toBe(
      'Authentication was cancelled or failed.'
    );
  });
});
