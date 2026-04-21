import { getTerms } from '../utils/filter-notes';
import { tagHashOf as t } from '../utils/tag-hash';
import { getTitle } from '../utils/note-utils';

import type * as A from '../state/action-types';
import type * as S from '../state';
import type * as T from '../types';
import { showAllNotes } from '../state/ui/actions';

const emptyList = [] as unknown[];
const LARGE_NOTE_CONTENT_THRESHOLD = 200_000;
const HUGE_NOTE_CONTENT_THRESHOLD = 1_000_000;

// @TODO: Refactor search state into Redux for access
//        and to prevent needing to recalculate separately
type SearchNote = {
  content: string;
  casedContent: string;
  tags: Set<string>;
  creationDate: number;
  modificationDate: number;
  isPinned: boolean;
  isTrashed: boolean;
  folderId: T.FolderId | null;
};

type SearchState = {
  collection: T.Collection;
  hasSelectedFirstNote: boolean;
  excludeIDs: Array<T.EntityId> | null;
  notes: Map<T.EntityId, SearchNote>;
  searchQuery: string;
  searchTags: Set<string>;
  searchTerms: string[];
  sortType: T.SortType;
  sortReversed: boolean;
  titleOnly: boolean | null;
};

const toSearchNote = (note: Partial<T.Note>): SearchNote => ({
  content: note.content?.toLocaleLowerCase() ?? '',
  casedContent: note.content ?? '',
  tags: new Set(note.tags?.map(t) ?? []),
  creationDate: note.creationDate ?? Date.now() / 1000,
  modificationDate: note.modificationDate ?? Date.now() / 1000,
  isPinned: note.systemTags?.includes('pinned') ?? false,
  isTrashed: !!note.deleted,
  folderId: (note.folderId as T.FolderId | null) ?? null,
});

export const tagsFromSearch = (query: string) => {
  const tagPattern = /(?:\btag:)([^\s,]+)/g;
  const searchTags = new Set<string>();
  let match;
  while ((match = tagPattern.exec(query)) !== null) {
    searchTags.add(t(match[1] as T.TagName));
  }
  return searchTags;
};

export let searchNotes: (
  args: Partial<SearchState>,
  maxResults: number
) => [T.EntityId, T.Note | undefined][] = () => [];

export const middleware: S.Middleware = (store) => {
  const searchState: SearchState = {
    collection: { type: 'all' },
    excludeIDs: [],
    hasSelectedFirstNote: false,
    notes: new Map(),
    searchQuery: '',
    searchTags: new Set(),
    searchTerms: [],
    sortType: store.getState().settings.sortType,
    sortReversed: store.getState().settings.sortReversed,
    titleOnly: false,
  };

  const indexAlphabetical: T.EntityId[] = [];
  const indexCreationDate: T.EntityId[] = [];
  const indexModification: T.EntityId[] = [];

  type Comparator<U> = (a: U, b: U) => number;

  const indexNote = (noteId: T.EntityId): void => {
    const compareWith =
      (compare: Comparator<SearchNote>): Comparator<T.EntityId> =>
      (a: T.EntityId, b: T.EntityId) => {
        const noteA = searchState.notes.get(a);
        const noteB = searchState.notes.get(b);

        if (!noteA || !noteB) {
          return a.localeCompare(b);
        }

        if (noteA.isPinned !== noteB.isPinned) {
          return noteA.isPinned ? -1 : 1;
        }

        const comparison = compare(noteA, noteB);

        return comparison !== 0 ? comparison : a.localeCompare(b);
      };

    const alphabetical = compareWith((a, b) =>
      a.casedContent.localeCompare(b.casedContent)
    );
    const creationDate = compareWith((a, b) => b.creationDate - a.creationDate);
    const modification = compareWith(
      (a, b) => b.modificationDate - a.modificationDate
    );

    const findSpot = (
      index: T.EntityId[],
      id: T.EntityId,
      compare: Comparator<T.EntityId>,
      start: number,
      end: number
    ): number => {
      if (start >= end) {
        return start;
      }

      const midPoint = Math.floor((start + end) / 2);
      const comparison = compare(id, index[midPoint]);

      if (comparison < 0) {
        return findSpot(index, id, compare, start, midPoint);
      }

      if (comparison > 0) {
        return findSpot(index, id, compare, midPoint + 1, end);
      }

      return midPoint;
    };

    (
      [
        [indexAlphabetical, alphabetical],
        [indexCreationDate, creationDate],
        [indexModification, modification],
      ] as [T.EntityId[], Comparator<T.EntityId>][]
    ).forEach(([index, compare]) => {
      const existingAt = index.indexOf(noteId);

      // remove existing entry
      if (existingAt > -1) {
        index.splice(existingAt, 1);
      }

      const nextAt = findSpot(index, noteId, compare, 0, index.length);
      index.splice(nextAt, 0, noteId);
    });
  };

  const removeNoteFromIndex = (noteId: T.EntityId) => {
    (
      [
        indexAlphabetical,
        indexCreationDate,
        indexModification,
      ] as T.EntityId[][]
    ).forEach((index) => {
      const at = index.indexOf(noteId);
      if (at > -1) {
        index.splice(at, 1);
      }
    });
  };

  if ('production' !== process.env.NODE_ENV) {
    window.indexAlphabetical = indexAlphabetical;
    window.indexCreationDate = indexCreationDate;
    window.indexModification = indexModification;
    window.searchState = searchState;
  }

  const runSearch = (
    args: Partial<SearchState> = {},
    maxResults = Infinity
  ): T.EntityId[] => {
    const {
      collection,
      excludeIDs,
      notes,
      searchTags,
      searchTerms,
      sortReversed,
      sortType,
      titleOnly,
    } = { ...searchState, ...args };
    const matches = new Set<T.EntityId>();
    const pinnedMatches = new Set<T.EntityId>();
    const storeNotes = store.getState().data.notes;

    const sortIndex =
      sortType === 'alphabetical'
        ? indexAlphabetical
        : sortType === 'creationDate'
          ? indexCreationDate
          : indexModification;

    for (
      let i = 0;
      i < sortIndex.length && pinnedMatches.size + matches.size <= maxResults;
      i++
    ) {
      const noteId = sortIndex[sortReversed ? sortIndex.length - i - 1 : i];
      if (excludeIDs?.includes(noteId)) {
        continue;
      }

      const note = notes.get(noteId);
      if (!note || !storeNotes.has(noteId)) {
        continue;
      }

      const showTrash = collection.type === 'trash';
      if (showTrash !== note.isTrashed) {
        continue;
      }

      if (
        collection.type === 'folder' &&
        note.folderId !== collection.folderId
      ) {
        continue;
      }

      let hasAllTags = true;
      for (const tagName of searchTags.values()) {
        if (!note.tags.has(tagName)) {
          hasAllTags = false;
          break;
        }
      }
      if (!hasAllTags) {
        continue;
      }

      const openedTagHash = collection.type === 'tag' && t(collection.tagName);
      if (
        searchTerms.length === 0 &&
        searchTags.size === 0 &&
        openedTagHash &&
        !note.tags.has(openedTagHash)
      ) {
        continue;
      }

      const searchText = titleOnly ? getTitle(note.content) : note.content;

      if (
        searchTerms.length > 0 &&
        !searchTerms.every((term) =>
          searchText.includes(term.toLocaleLowerCase())
        )
      ) {
        continue;
      }

      if (note.isPinned) {
        pinnedMatches.add(noteId);
      } else {
        matches.add(noteId);
      }
    }

    return [...pinnedMatches.values(), ...matches.values()];
  };

  searchNotes = (args, maxResults) =>
    runSearch(args, maxResults).map((noteId) => [
      noteId,
      store.getState().data.notes.get(noteId),
    ]);

  const setFilteredNotes = (
    noteIds: T.EntityId[]
  ): { noteIds: T.EntityId[] } => {
    return { noteIds };
  };

  const withSearch = <T extends A.ActionType>(action: T): T => ({
    ...action,
    meta: {
      ...action.meta,
      searchResults: setFilteredNotes(runSearch()),
    },
  });

  const withNextNote = <T extends A.ActionType>(
    noteId: T.EntityId,
    action: T
  ): T => {
    const {
      ui: { filteredNotes, openedNote },
    } = store.getState();

    if (!openedNote || openedNote !== noteId) {
      return action;
    }

    const noteAt = filteredNotes.findIndex((noteId) => noteId === openedNote);
    const nextNoteToOpen =
      noteAt === -1
        ? (filteredNotes[0] ?? null)
        : (filteredNotes[noteAt + 1] ?? filteredNotes[noteAt - 1] ?? null);

    return {
      ...action,
      meta: {
        ...action.meta,
        nextNoteToOpen,
      },
    };
  };

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const queueSearchWithDelay = (delayMs: number) => {
    clearTimeout(searchTimer!);
    searchTimer = setTimeout(() => {
      const searchResults = setFilteredNotes(runSearch());

      store.dispatch({
        type: 'FILTER_NOTES',
        ...searchResults,
        meta: {
          searchResults,
        },
      });
    }, delayMs);
  };
  const queueSearch = () => queueSearchWithDelay(30);

  // For very large notes, lowercasing/indexing on every EDIT_NOTE will freeze typing.
  // Defer the expensive work until the user pauses.
  const pendingContentWork = new Map<
    T.EntityId,
    {
      timer: ReturnType<typeof setTimeout> | null;
      idleHandle: number | null;
      seq: number;
    }
  >();

  const cancelPendingContentWork = (noteId: T.EntityId) => {
    const w = pendingContentWork.get(noteId);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;
    if (w.idleHandle != null) {
      try {
        (globalThis as any).cancelIdleCallback?.(w.idleHandle);
      } catch {
        // ignore
      }
      try {
        clearTimeout(w.idleHandle as any);
      } catch {
        // ignore
      }
      w.idleHandle = null;
    }
  };

  const scheduleIndexLargeNoteContent = (
    noteId: T.EntityId,
    content: string
  ) => {
    const note = searchState.notes.get(noteId);
    if (!note) return;

    const len = String(content ?? '').length;
    const delayMs =
      len >= HUGE_NOTE_CONTENT_THRESHOLD ? 1500 : len >= LARGE_NOTE_CONTENT_THRESHOLD ? 500 : 0;
    if (delayMs <= 0) {
      note.content = content.toLocaleLowerCase();
      note.casedContent = content;
      indexNote(noteId);
      queueSearch();
      return;
    }

    const prev = pendingContentWork.get(noteId) ?? {
      timer: null,
      idleHandle: null,
      seq: 0,
    };
    prev.seq += 1;
    pendingContentWork.set(noteId, prev);
    cancelPendingContentWork(noteId);

    const seq = prev.seq;
    prev.timer = setTimeout(() => {
      const compute = () => {
        const w = pendingContentWork.get(noteId);
        if (!w || w.seq !== seq) return;
        const n = searchState.notes.get(noteId);
        if (!n) return;
        n.content = content.toLocaleLowerCase();
        n.casedContent = content;
        indexNote(noteId);
        // Use a slightly longer delay for the subsequent full search to avoid
        // ping-ponging with rapid edits.
        queueSearchWithDelay(60);
      };

      if (
        typeof (globalThis as any).requestIdleCallback === 'function' &&
        len >= LARGE_NOTE_CONTENT_THRESHOLD
      ) {
        try {
          prev.idleHandle = (globalThis as any).requestIdleCallback(
            () => {
              prev.idleHandle = null;
              compute();
            },
            { timeout: 2000 }
          );
          return;
        } catch {
          // fall back
        }
      }

      prev.idleHandle = setTimeout(() => {
        prev.idleHandle = null;
        compute();
      }, 0) as unknown as number;
    }, delayMs);
  };

  store.getState().data.notes.forEach((note, noteId) => {
    searchState.notes.set(noteId, toSearchNote(note));
    indexNote(noteId);
  });
  queueSearch();

  return (rawNext) => (action: A.ActionType) => {
    const next = (action: A.ActionType) => {
      if (
        !searchState.hasSelectedFirstNote &&
        action.meta?.searchResults?.noteIds.length
      ) {
        searchState.hasSelectedFirstNote = true;
        return rawNext({
          ...action,
          meta: {
            ...action.meta,
            nextNoteToOpen: action.meta?.searchResults.noteIds[0],
          },
        });
      }

      return rawNext(action);
    };

    switch (action.type) {
      case 'CREATE_NOTE_WITH_ID': {
        // Preserve the current collection context when creating a new note.
        // The note is already assigned the correct folderId/tags by the data middleware.
        const noteFolderId = action.note?.folderId as T.FolderId | null;
        const noteTags = action.note?.tags;

        if (noteFolderId) {
          // If note was created in a folder, stay in that folder view
          searchState.collection = {
            type: 'folder',
            folderId: noteFolderId,
          };
        } else if (noteTags && noteTags.length > 0) {
          // If note has tags (created in a tag view), stay in that tag view
          searchState.collection = {
            type: 'tag',
            tagName: noteTags[0],
          };
        } else if (searchState.collection.type === 'trash') {
          // Don't stay in trash when creating a note
          searchState.collection = { type: 'all' };
        }
        // Otherwise, preserve the current collection (e.g., 'all')

        searchState.notes.set(action.noteId, toSearchNote(action.note ?? {}));
        indexNote(action.noteId);
        queueSearch();
        return next(action);
      }
      case 'IMPORT_NOTE_WITH_ID':
      case 'REMOTE_NOTE_UPDATE':
      case 'RESTORE_NOTE_REVISION':
        searchState.notes.set(action.noteId, toSearchNote(action.note ?? {}));
        indexNote(action.noteId);
        queueSearch();
        return next(action);

      case 'DELETE_NOTE_FOREVER':
      case 'REMOTE_NOTE_DELETE_FOREVER':
        searchState.notes.delete(action.noteId);
        removeNoteFromIndex(action.noteId);
        return next(withNextNote(action.noteId, withSearch(action)));

      case 'EDIT_NOTE': {
        const note = searchState.notes.get(action.noteId)!;
        let deferHeavySearchWork = false;
        if ('undefined' !== typeof action.changes.content) {
          const nextContent = action.changes.content ?? '';
          // Always keep cased content current for title extraction, but avoid
          // lowercasing/indexing huge notes on every keystroke.
          note.casedContent = nextContent;
          if (String(nextContent).length >= LARGE_NOTE_CONTENT_THRESHOLD) {
            scheduleIndexLargeNoteContent(action.noteId, nextContent);
            // Defer `withSearch` for huge docs; it runs a full search which can
            // be very expensive while typing.
            deferHeavySearchWork = true;
          } else {
            note.content = nextContent.toLocaleLowerCase();
          }
        }
        if ('undefined' !== typeof action.changes.tags) {
          note.tags = new Set(action.changes.tags.map(t));
        }
        if ('undefined' !== typeof action.changes.creationDate) {
          note.creationDate = action.changes.creationDate;
        }

        note.modificationDate =
          'undefined' !== typeof action.changes.modificationDate
            ? action.changes.modificationDate
            : Date.now() / 1000;

        if ('undefined' !== typeof action.changes.deleted) {
          note.isTrashed = !!action.changes.deleted;
        }
        if ('undefined' !== typeof action.changes.systemTags) {
          note.isPinned = action.changes.systemTags.includes('pinned');
        }
        if ('undefined' !== typeof action.changes.folderId) {
          note.folderId =
            (action.changes.folderId as T.FolderId | null) ?? null;
        }
        if (deferHeavySearchWork) {
          return next(action);
        }
        indexNote(action.noteId);
        return next(withSearch(action));
      }

      case 'OPEN_TAG':
        searchState.collection = {
          type: 'tag',
          tagName: action.tagName,
        };
        return next(withSearch(action));

      case 'OPEN_FOLDER': {
        searchState.collection = {
          type: 'folder',
          folderId: action.folderId,
        };
        // Check if currently opened note is in this folder
        const { openedNote } = store.getState().ui;
        const folderNotes = runSearch();
        const noteInFolder = openedNote && folderNotes.includes(openedNote);
        // Close the editor if the opened note is not in this folder (or folder is empty)
        const searchAction = withSearch(action);
        if (openedNote && !noteInFolder) {
          return next({
            ...searchAction,
            meta: {
              ...searchAction.meta,
              nextNoteToOpen: null,
            },
          });
        }
        return next(searchAction);
      }

      case 'PIN_NOTE': {
        const note = searchState.notes.get(action.noteId);
        if (!note) {
          return next(action);
        }

        note.isPinned = action.shouldPin;
        note.modificationDate = Date.now() / 1000;
        indexNote(action.noteId);

        return next(withSearch(action));
      }

      case 'RESTORE_NOTE': {
        const note = searchState.notes.get(action.noteId);
        if (!note) {
          return next(action);
        }

        note.isTrashed = false;
        note.modificationDate = Date.now() / 1000;
        indexNote(action.noteId);

        return next(withNextNote(action.noteId, withSearch(action)));
      }

      case 'SELECT_TRASH':
        searchState.collection = { type: 'trash' };
        return next(withSearch(action));

      case 'SHOW_ALL_NOTES':
        searchState.collection = { type: 'all' };
        return next(withSearch(action));

      case 'SEARCH':
        searchState.searchQuery = action.searchQuery;
        searchState.searchTerms = getTerms(action.searchQuery);
        searchState.searchTags = tagsFromSearch(action.searchQuery);
        return next(withSearch(action));

      case 'setSortReversed':
        searchState.sortReversed = action.sortReversed;
        return next(withSearch(action));

      case 'setSortType':
        searchState.sortType = action.sortType;
        if (typeof action.sortReversed !== 'undefined') {
          searchState.sortReversed = action.sortReversed;
        }
        return next(withSearch(action));

      case 'TOGGLE_SORT_ORDER':
        searchState.sortReversed = !searchState.sortReversed;
        return next(withSearch(action));

      case 'TRASH_NOTE': {
        const note = searchState.notes.get(action.noteId);
        if (!note) {
          return next(action);
        }

        note.isTrashed = true;
        note.modificationDate = Date.now() / 100;
        indexNote(action.noteId);

        return next(withNextNote(action.noteId, withSearch(action)));
      }
    }

    return next(action);
  };
};
