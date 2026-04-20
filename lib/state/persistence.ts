import * as A from './action-types';
import * as S from './';
import * as T from '../types';
import { isElectron } from '../utils/platform';

const DB_VERSION = 2020065;
let keepSyncing = true;
const LARGE_NOTE_CONTENT_THRESHOLD = 200_000;
const HUGE_NOTE_CONTENT_THRESHOLD = 1_000_000;

const DEFAULT_NOTEBOOK_ID = 'default-notebook' as unknown as T.NotebookId;
const DEFAULT_FOLDER_ID = 'default-folder' as unknown as T.FolderId;

const migrateNotebooksAndFolders = (
  data: T.RecursivePartial<S.State>
): T.RecursivePartial<S.State> => {
  const notebooks = (data.data as any)?.notebooks as Map<
    T.NotebookId,
    T.Notebook
  > | null;
  const folders = (data.data as any)?.folders as Map<
    T.FolderId,
    T.Folder
  > | null;
  const notes = (data.data as any)?.notes as Map<T.EntityId, T.Note> | null;

  if (!notebooks || !folders || !notes) {
    return data;
  }

  if (notebooks.size === 0) {
    notebooks.set(DEFAULT_NOTEBOOK_ID, { name: 'Notebooks' });
  }

  if (folders.size === 0) {
    folders.set(DEFAULT_FOLDER_ID, {
      name: 'Inbox',
      notebookId: DEFAULT_NOTEBOOK_ID,
      parentFolderId: null,
    });
  }

  // Assign any existing notes without a folder to the default folder.
  notes.forEach((note, noteId) => {
    if (typeof note.folderId === 'undefined' || note.folderId === null) {
      notes.set(noteId, { ...note, folderId: DEFAULT_FOLDER_ID });
    }
    // Markdown-first: ensure all notes have the markdown system tag.
    if (!note.systemTags?.includes('markdown')) {
      notes.set(noteId, {
        ...notes.get(noteId),
        systemTags: [...(note.systemTags ?? []), 'markdown'],
      });
    }
  });

  return data;
};

export const stopSyncing = (): void => {
  keepSyncing = false;
};

// ----------------------------------------
// IndexedDB backend (legacy, non-Electron)
// ----------------------------------------

const openIndexedDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open('recall_v2', DB_VERSION);

    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject();
    r.onupgradeneeded = () => {
      const db = r.result;

      if (!db.objectStoreNames.contains('state')) {
        db.createObjectStore('state');
      }

      if (!db.objectStoreNames.contains('revisions')) {
        db.createObjectStore('revisions');
      }
    };
    r.onblocked = () => reject();
  });

const loadStateFromIndexedDB = (
  accountName: string | null
): Promise<[T.RecursivePartial<S.State>, S.Middleware | null]> =>
  openIndexedDB()
    .then(
      (db): Promise<[T.RecursivePartial<S.State>, S.Middleware | null]> =>
        new Promise((resolve) => {
          let stillGood = true;

          const tx = db.transaction(['state', 'revisions'], 'readonly');

          db.onversionchange = () => {
            stillGood = false;
            resolve([{}, middleware]);
          };

          const stateRequest = tx.objectStore('state').get('state');
          stateRequest.onsuccess = () => {
            if (!stillGood) {
              resolve([{}, middleware]);
              return;
            }

            const state = stateRequest.result;
            if (!state) {
              resolve([{}, middleware]);
              return;
            }

            try {
              if (accountName !== null && state.accountName !== accountName) {
                resolve([{}, middleware]);
                return;
              }

              const noteTags = new Map(
                state.noteTags.map(
                  ([tagHash, noteIds]: [T.TagHash, T.EntityId[]]) => [
                    tagHash,
                    new Set(noteIds),
                  ]
                )
              );

              const cvsMap = new Map(state.cvs);
              const ghostsMap = new Map(state.ghosts);

              const hasPreferences = 'preferences' in state;
              if (!hasPreferences) {
                cvsMap.delete('preferences');
                ghostsMap.delete('preferences');
              }

              const data: T.RecursivePartial<S.State> = {
                data: {
                  analyticsAllowed: state.allowAnalytics ?? null,
                  notes: new Map(state.notes),
                  noteTags,
                  notebooks: new Map(state.notebooks ?? []),
                  folders: new Map(state.folders ?? []),
                  tags: new Map(state.tags),
                  ...(hasPreferences
                    ? { preferences: new Map(state.preferences) }
                    : {}),
                },
                settings: {
                  accountName: state.accountName,
                },
                simperium: {
                  ghosts: [cvsMap, ghostsMap],
                  lastRemoteUpdate: new Map(state.lastRemoteUpdate),
                  lastSync: new Map(state.lastSync),
                },
              };

              const revisionsRequest = tx.objectStore('revisions').openCursor();
              const noteRevisions = new Map<T.EntityId, Map<number, T.Note>>();
              revisionsRequest.onsuccess = () => {
                if (!stillGood) {
                  resolve([data, middleware]);
                  return;
                }

                const cursor = revisionsRequest.result;
                if (cursor) {
                  const key = cursor.key as T.EntityId;
                  noteRevisions.set(key, new Map(cursor.value));
                  cursor.continue();
                } else {
                  const migrated = migrateNotebooksAndFolders(data);
                  resolve([
                    {
                      ...migrated,
                      data: {
                        ...(migrated.data as any),
                        noteRevisions,
                      },
                    },
                    middleware,
                  ]);
                }
              };
              revisionsRequest.onerror = () => resolve([data, middleware]);
            } catch (e) {
              resolve([{}, middleware]);
            }
          };

          stateRequest.onerror = () => resolve([{}, middleware]);
        })
    )
    .catch(() => [{}, null]);

const persistRevisionsIndexedDB = async (
  noteId: T.EntityId,
  revisions: [number, T.Note][]
) => {
  const tx = (await openIndexedDB()).transaction('revisions', 'readwrite');

  const readRequest = tx.objectStore('revisions').get(noteId);
  readRequest.onsuccess = () => {
    // we might have some stored revisions
    const savedRevisions = readRequest.result;

    // so merge them to store as many as we can
    const merged: [number, T.Note][] = savedRevisions?.slice() ?? [];
    const seen = new Set<number>(merged.map(([version]) => version));

    revisions.forEach(([version, note]) => {
      if (!seen.has(version)) {
        merged.push([version, note]);
        seen.add(version);
      }
    });
    merged.sort((a, b) => a[0] - b[0]);

    tx.objectStore('revisions').put(merged, noteId);
  };
  readRequest.onerror = () => {
    // it's fine if we have no saved revisions
    tx.objectStore('revisions').put(revisions, noteId);
  };
};

const saveStateToIndexedDB = (state: S.State) => {
  const notes = Array.from(state.data.notes);
  const noteTags = Array.from(state.data.noteTags).map(([tagHash, noteIds]) => [
    tagHash,
    Array.from(noteIds),
  ]);
  const preferences = Array.from(state.data.preferences);
  const notebooks = Array.from(state.data.notebooks);
  const folders = Array.from(state.data.folders);
  const tags = Array.from(state.data.tags);
  const cvs = Array.from(state.simperium.ghosts[0]);
  const ghosts = Array.from(state.simperium.ghosts[1]);
  const lastRemoteUpdate = Array.from(state.simperium.lastRemoteUpdate);
  const lastSync = Array.from(state.simperium.lastSync);

  const data = {
    accountName: state.settings.accountName,
    allowAnalytics: state.data.analyticsAllowed,
    notes,
    noteTags,
    preferences,
    notebooks,
    folders,
    tags,
    cvs,
    ghosts,
    lastRemoteUpdate,
    lastSync,
  };

  return openIndexedDB().then((db) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(data, 'state');
  });
};

// ----------------------------------------
// Electron persistence backend (filesystem bridge via preload)
// ----------------------------------------

const hasElectronPersistenceBackend = (): boolean =>
  isElectron && typeof window.electron?.loadPersistentState === 'function';

const loadStateFromElectronPersistence = async (
  accountName: string | null
): Promise<[T.RecursivePartial<S.State>, S.Middleware | null]> => {
  try {
    const rawState = window.electron.loadPersistentState();
    if (!rawState) {
      return [{}, middleware];
    }

    if (accountName !== null && rawState.accountName !== accountName) {
      return [{}, middleware];
    }

    const noteTags = new Map(
      rawState.noteTags.map(
        ([tagHash, noteIds]: [T.TagHash, T.EntityId[]]) =>
          [tagHash, new Set(noteIds)] as [T.TagHash, Set<T.EntityId>]
      )
    );

    const cvsMap = new Map(rawState.cvs);
    const ghostsMap = new Map(rawState.ghosts);

    const hasPreferences = 'preferences' in rawState;
    if (!hasPreferences) {
      cvsMap.delete('preferences');
      ghostsMap.delete('preferences');
    }

    const data: T.RecursivePartial<S.State> = {
      data: {
        analyticsAllowed: rawState.allowAnalytics ?? null,
        notes: new Map(rawState.notes),
        noteTags,
        notebooks: new Map(rawState.notebooks ?? []),
        folders: new Map(rawState.folders ?? []),
        tags: new Map(rawState.tags),
        ...(hasPreferences
          ? { preferences: new Map(rawState.preferences) }
          : {}),
      },
      settings: {
        accountName: rawState.accountName,
      },
      simperium: {
        ghosts: [cvsMap, ghostsMap],
        lastRemoteUpdate: new Map(rawState.lastRemoteUpdate),
        lastSync: new Map(rawState.lastSync),
      },
    };

    const revisionsArray = window.electron.loadAllRevisions();
    const noteRevisions = new Map<T.EntityId, Map<number, T.Note>>();
    revisionsArray.forEach(
      ([noteId, revisions]: [T.EntityId, [number, T.Note][]]) => {
        noteRevisions.set(noteId, new Map(revisions));
      }
    );

    const migrated = migrateNotebooksAndFolders(data);

    return [
      {
        ...migrated,
        data: {
          ...(migrated.data as any),
          noteRevisions,
        },
      },
      middleware,
    ];
  } catch {
    return [{}, middleware];
  }
};

const persistRevisionsElectronPersistence = (
  noteId: T.EntityId,
  revisions: [number, T.Note][]
) => window.electron.saveNoteRevisions(noteId, revisions);

const saveStateToElectronPersistence = (state: S.State) => {
  const notes = Array.from(state.data.notes);
  const noteTags = Array.from(state.data.noteTags).map(([tagHash, noteIds]) => [
    tagHash,
    Array.from(noteIds),
  ]);
  const preferences = Array.from(state.data.preferences);
  const notebooks = Array.from(state.data.notebooks);
  const folders = Array.from(state.data.folders);
  const tags = Array.from(state.data.tags);
  const cvs = Array.from(state.simperium.ghosts[0]);
  const ghosts = Array.from(state.simperium.ghosts[1]);
  const lastRemoteUpdate = Array.from(state.simperium.lastRemoteUpdate);
  const lastSync = Array.from(state.simperium.lastSync);

  const data = {
    accountName: state.settings.accountName,
    allowAnalytics: state.data.analyticsAllowed,
    notes,
    noteTags,
    preferences,
    notebooks,
    folders,
    tags,
    cvs,
    ghosts,
    lastRemoteUpdate,
    lastSync,
  };

  window.electron.savePersistentState(data);
  return Promise.resolve();
};

// ----------------------------------------
// Public API
// ----------------------------------------

export const loadState = (
  accountName: string | null
): Promise<[T.RecursivePartial<S.State>, S.Middleware | null]> =>
  hasElectronPersistenceBackend()
    ? loadStateFromElectronPersistence(accountName)
    : loadStateFromIndexedDB(accountName);

const persistRevisions = async (
  noteId: T.EntityId,
  revisions: [number, T.Note][]
) =>
  hasElectronPersistenceBackend()
    ? persistRevisionsElectronPersistence(noteId, revisions)
    : persistRevisionsIndexedDB(noteId, revisions);

export const saveState = (state: S.State) =>
  hasElectronPersistenceBackend()
    ? saveStateToElectronPersistence(state)
    : saveStateToIndexedDB(state);

export const middleware: S.Middleware =
  ({ dispatch, getState }) =>
  (next) => {
    let worker: ReturnType<typeof setTimeout> | null = null;
    let maxWorker: ReturnType<typeof setTimeout> | null = null;
    let lastSavedAt = 0;
    let pendingSaveIsLarge = false;

    const saveNow = () => {
      if (!keepSyncing) return;
      try {
        saveState(getState());
      } finally {
        lastSavedAt = Date.now();
        pendingSaveIsLarge = false;
        if (maxWorker) {
          clearTimeout(maxWorker);
          maxWorker = null;
        }
      }
    };

    const saveOnIdleIfPossible = () => {
      if (!keepSyncing) return;
      // For large notes, try to push persistence work into idle time to avoid
      // stalling the UI thread during typing.
      if (
        pendingSaveIsLarge &&
        typeof (globalThis as any).requestIdleCallback === 'function'
      ) {
        try {
          (globalThis as any).requestIdleCallback(() => saveNow(), {
            timeout: 5000,
          });
          return;
        } catch {
          // fall back
        }
      }
      saveNow();
    };

    const getSaveDelayMs = (action: A.ActionType): number => {
      if (action.type === 'EDIT_NOTE') {
        const content = (action as any)?.changes?.content;
        if (typeof content === 'string') {
          const len = content.length;
          if (len >= HUGE_NOTE_CONTENT_THRESHOLD) return 15_000;
          if (len >= LARGE_NOTE_CONTENT_THRESHOLD) return 5_000;
        }
      }
      return 1000;
    };

    const shouldTreatAsLargeSave = (action: A.ActionType): boolean => {
      if (action.type !== 'EDIT_NOTE') return false;
      const content = (action as any)?.changes?.content;
      return typeof content === 'string' && content.length >= LARGE_NOTE_CONTENT_THRESHOLD;
    };

    return (action) => {
      const result = next(action);

      if (worker) {
        clearTimeout(worker);
      }
      if (keepSyncing) {
        pendingSaveIsLarge = shouldTreatAsLargeSave(action);
        const delay = getSaveDelayMs(action as A.ActionType);
        worker = setTimeout(() => saveOnIdleIfPossible(), delay);

        // Safety: if user types continuously in a huge note, we still want
        // persistence to happen occasionally. Schedule a max-interval save that
        // does not get reset by more typing.
        const maxIntervalMs =
          pendingSaveIsLarge ? (Date.now() - lastSavedAt > 60_000 ? 2_000 : 60_000) : 0;
        if (pendingSaveIsLarge && !maxWorker) {
          maxWorker = setTimeout(() => saveOnIdleIfPossible(), maxIntervalMs);
        }
      }

      const typed: A.ActionType = action as A.ActionType;

      if (typed.type === 'LOAD_REVISIONS' && typed.revisions.length > 0) {
        persistRevisions(typed.noteId, typed.revisions);
      }

      return result;
    };
  };
