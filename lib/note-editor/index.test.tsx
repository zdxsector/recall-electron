import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

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

  const unlockedNote = {
    content: '# Public\nBody',
    creationDate: 1,
    deleted: false,
    modificationDate: 1,
    systemTags: [],
    tags: [],
  } as any;

  const createNodeMock = (element: any) => {
    if (element.type === 'div') {
      return {
        getBoundingClientRect: () => ({
          left: 10,
          top: 20,
          width: 58,
          height: 58,
        }),
      };
    }
    return null;
  };

  const setupElectron = (
    unlockResult: any,
    showResult: any = { ok: true, code: 'success' }
  ) => {
    const show = jest.fn().mockResolvedValue(showResult);
    const update = jest.fn().mockResolvedValue({ ok: true, code: 'success' });
    const hide = jest.fn().mockResolvedValue({ ok: true, code: 'success' });
    const unlock = jest.fn().mockResolvedValue(unlockResult);

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        isMac: true,
        secureNotes: {
          nativeAuth: { show, update, hide },
          systemAuth: { unlock },
          test: { getEvents: jest.fn() },
        },
      },
    });

    return { hide, show, unlock, update };
  };

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
  });

  it('renders locked state and creates native auth anchor', async () => {
    const electron = setupElectron({ ok: false, code: 'cancelled' });

    let tree: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
    });

    expect(tree!.root.findByType('h2').children.join('')).toBe(
      'This note is locked.'
    );
    expect(
      tree!.root.findAllByProps({ className: 'note-editor-locked-anchor' })
    ).toHaveLength(1);
    expect(electron.show).toHaveBeenCalledWith({
      noteId: 'note-locked',
      reason: 'View "Secret" in Recall',
      rect: { x: 10, y: 20, width: 58, height: 58 },
      viewportHeight: 800,
      devicePixelRatio: 2,
    });
  });

  it('uses trusted main-process unlock success before storing content', async () => {
    const electron = setupElectron({
      ok: true,
      content: '# Secret\nBody',
    });
    const storeUnlockedNoteContent = jest.fn();

    await act(async () => {
      renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
          storeUnlockedNoteContent={storeUnlockedNoteContent}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(electron.unlock).toHaveBeenCalledWith({
      allowModalFallback: false,
      noteId: 'note-locked',
      encryptedContent: 'YWJjMTIz',
      reason: 'View "Secret" in Recall',
    });
    expect(storeUnlockedNoteContent).toHaveBeenCalledWith(
      'note-locked',
      '# Secret\nBody'
    );
  });

  it('uses native password fallback while embedded auth is pending', async () => {
    const electron = setupElectron(
      {
        ok: true,
        content: '# Secret\nBody',
      },
      new Promise(() => {})
    );
    const storeUnlockedNoteContent = jest.fn();
    let tree: ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
          storeUnlockedNoteContent={storeUnlockedNoteContent}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
    });

    await act(async () => {
      await tree!.root
        .findByProps({ 'aria-label': 'Use native password authentication' })
        .props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(electron.hide).toHaveBeenCalledWith({ noteId: 'note-locked' });
    expect(electron.unlock).toHaveBeenCalledWith({
      allowModalFallback: true,
      noteId: 'note-locked',
      encryptedContent: 'YWJjMTIz',
      reason: 'View "Secret" in Recall',
    });
    expect(storeUnlockedNoteContent).toHaveBeenCalledWith(
      'note-locked',
      '# Secret\nBody'
    );
  });

  it('cancelled auth does not unlock the note', async () => {
    const electron = setupElectron(
      { ok: true, content: '# Secret\nBody' },
      { ok: false, code: 'cancelled' }
    );
    const storeUnlockedNoteContent = jest.fn();
    let tree: ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
          storeUnlockedNoteContent={storeUnlockedNoteContent}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(storeUnlockedNoteContent).not.toHaveBeenCalled();
    expect(electron.unlock).not.toHaveBeenCalled();
    expect(tree!.root.findByProps({ role: 'alert' }).children.join('')).toBe(
      'Authentication was cancelled.'
    );
  });

  it('failed auth does not unlock the note', async () => {
    const electron = setupElectron(
      { ok: true, content: '# Secret\nBody' },
      { ok: false, code: 'authentication_failed' }
    );
    const storeUnlockedNoteContent = jest.fn();

    await act(async () => {
      renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
          storeUnlockedNoteContent={storeUnlockedNoteContent}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(storeUnlockedNoteContent).not.toHaveBeenCalled();
    expect(electron.unlock).not.toHaveBeenCalled();
  });

  it('renderer cannot mark a note unlocked without main-process success', async () => {
    setupElectron({ ok: false, code: 'native_auth_required' });
    const storeUnlockedNoteContent = jest.fn();

    await act(async () => {
      renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
          storeUnlockedNoteContent={storeUnlockedNoteContent}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(storeUnlockedNoteContent).not.toHaveBeenCalled();
  });

  it('calls native auth update on resize', async () => {
    const electron = setupElectron({ ok: false, code: 'cancelled' });
    let resizeHandler: (() => void) | undefined;
    const addSpy = jest
      .spyOn(window, 'addEventListener')
      .mockImplementation((event, handler: any) => {
        if (event === 'resize') {
          resizeHandler = handler;
        }
      });
    const removeSpy = jest
      .spyOn(window, 'removeEventListener')
      .mockImplementation(() => {});
    const rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cafSpy = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {});

    await act(async () => {
      renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
      await Promise.resolve();
      resizeHandler?.();
      await Promise.resolve();
    });

    expect(electron.update).toHaveBeenCalled();
    addSpy.mockRestore();
    removeSpy.mockRestore();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it('calls native auth hide on unmount', async () => {
    const electron = setupElectron({ ok: false, code: 'cancelled' });
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
    });

    await act(async () => {
      tree!.unmount();
      await Promise.resolve();
    });

    expect(electron.hide).toHaveBeenCalledWith({ noteId: 'note-locked' });
  });

  it('cleans up old overlay when changing from locked to unlocked note', async () => {
    const electron = setupElectron({ ok: false, code: 'cancelled' });
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
    });

    await act(async () => {
      tree!.update(
        <NoteEditor
          {...baseProps}
          note={unlockedNote}
          noteId={'note-unlocked' as any}
        />
      );
      await Promise.resolve();
    });

    expect(electron.hide).toHaveBeenCalledWith({ noteId: 'note-locked' });
  });

  it('does not ask for the macOS login password in HTML', async () => {
    let tree: ReactTestRenderer;
    setupElectron(
      { ok: true, content: '# Secret\nBody' },
      { ok: false, code: 'unavailable' }
    );

    await act(async () => {
      tree = renderer.create(
        <NoteEditor
          {...baseProps}
          note={lockedNote}
          noteId={'note-locked' as any}
        />,
        { createNodeMock }
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const json = JSON.stringify(tree!.toJSON());
    expect(json).not.toMatch(/mac login password/i);
    expect(json).not.toMatch(/type":"password"/i);
    expect(json).toMatch(/app-specific note password/i);
  });
});
