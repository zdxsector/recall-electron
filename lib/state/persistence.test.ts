import {
  changedNoteIds,
  createPersistenceMiddleware,
  hasPersistedStateChange,
} from './persistence';

const note = (content: string) => ({
  content,
  creationDate: 1,
  deleted: false,
  modificationDate: 1,
  systemTags: [],
  tags: [],
});

const makeState = (overrides: Record<string, any> = {}) => ({
  data: {
    folders: new Map(),
    notebooks: new Map(),
    notes: new Map([['note-1', note('# One')]]),
  },
  settings: { accountName: null },
  simperium: {},
  ui: { collection: { type: 'all' } },
  ...overrides,
});

describe('persistence middleware', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not schedule persistence for navigation-only state changes', () => {
    const persist = jest.fn();
    let state = makeState();
    const middleware = createPersistenceMiddleware(persist as any)({
      dispatch: jest.fn(),
      getState: () => state,
    } as any)((action: any) => {
      state = {
        ...state,
        ui: { collection: { type: 'folder', folderId: action.folderId } },
      };
      return action;
    });

    middleware({ type: 'OPEN_FOLDER', folderId: 'folder-1' } as any);
    jest.advanceTimersByTime(20_000);

    expect(persist).not.toHaveBeenCalled();
  });

  it('persists only the note changed by an edit', () => {
    const persist = jest.fn();
    let state = makeState();
    const middleware = createPersistenceMiddleware(persist as any)({
      dispatch: jest.fn(),
      getState: () => state,
    } as any)((action: any) => {
      const notes = new Map(state.data.notes);
      notes.set(action.noteId, note(action.changes.content));
      state = { ...state, data: { ...state.data, notes } };
      return action;
    });

    middleware({
      type: 'EDIT_NOTE',
      changes: { content: '# Changed' },
      noteId: 'note-1',
    } as any);
    jest.advanceTimersByTime(1_000);

    expect(persist).toHaveBeenCalledWith(state, {
      dirtyNoteIds: ['note-1'],
      structureChanged: false,
    });
  });

  it('tracks changed and removed note identities without scanning content', () => {
    const previous = new Map([
      ['one', note('# One')],
      ['removed', note('# Removed')],
    ]);
    const next = new Map([
      ['one', previous.get('one')!],
      ['two', note('# Two')],
    ]);

    expect(Array.from(changedNoteIds(previous as any, next as any))).toEqual([
      'two',
      'removed',
    ]);
  });

  it('distinguishes persisted data changes from UI-only changes', () => {
    const state = makeState();
    expect(
      hasPersistedStateChange(
        state as any,
        {
          ...state,
          ui: { collection: { type: 'trash' } },
        } as any
      )
    ).toBe(false);
    expect(
      hasPersistedStateChange(
        state as any,
        {
          ...state,
          data: { ...state.data, notes: new Map(state.data.notes) },
        } as any
      )
    ).toBe(true);
  });
});
