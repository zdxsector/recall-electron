import { combineReducers } from 'redux';

import type * as A from '../action-types';
import type * as T from '../../types';

const DEFAULT_FOLDER_ID = 'default-folder' as unknown as T.FolderId;

export const analyticsAllowed: A.Reducer<boolean | null> = (
  state = null,
  action
) => {
  switch (action.type) {
    case 'REMOTE_ANALYTICS_UPDATE':
    case 'SET_ANALYTICS':
      return action.allowAnalytics;

    default:
      return state;
  }
};

const accountVerification: A.Reducer<T.VerificationState> = (
  state = 'unknown',
  action
) =>
  action.type === 'UPDATE_ACCOUNT_VERIFICATION' && 'dismissed' !== state
    ? action.state
    : state;

const modified = <Entity extends { modificationDate: number }>(
  entity: Entity
): Entity => ({
  ...entity,
  modificationDate: Date.now() / 1000,
});

export const notes: A.Reducer<Map<T.EntityId, T.Note>> = (
  state = new Map(),
  action
) => {
  switch (action.type) {
    case 'ADD_COLLABORATOR': {
      const note = state.get(action.noteId);
      if (!note) {
        return state;
      }

      const tagName = action.collaboratorAccount;

      // Add collaborator account as a tag (for Simperium sharing)
      const tags = note.tags.includes(tagName)
        ? note.tags
        : [...note.tags, tagName];

      return tags !== note.tags
        ? new Map(state).set(action.noteId, modified({ ...note, tags }))
        : state;
    }

    case 'CREATE_NOTE_WITH_ID':
      return new Map(state).set(action.noteId, {
        content: '',
        creationDate: Date.now() / 1000,
        modificationDate: Date.now() / 1000,
        deleted: false,
        publishURL: '',
        shareURL: '',
        systemTags: [],
        tags: [],
        ...action.note,
      });

    case 'DELETE_NOTE_FOREVER':
    case 'NOTE_BUCKET_REMOVE':
    case 'REMOTE_NOTE_DELETE_FOREVER': {
      if (!state.has(action.noteId)) {
        return state;
      }

      const next = new Map(state);
      next.delete(action.noteId);
      return next;
    }

    case 'EDIT_NOTE': {
      const prev = state.get(action.noteId) ?? {
        content: '',
        creationDate: Date.now() / 1000,
        modificationDate: Date.now() / 1000,
        deleted: false,
        publishURL: '',
        shareURL: '',
        systemTags: [],
        tags: [],
      };

      return new Map(state).set(
        action.noteId,
        modified({ ...prev, ...action.changes })
      );
    }

    case 'NOTE_BUCKET_UPDATE':
    case 'REMOTE_NOTE_UPDATE':
    case 'RESTORE_NOTE_REVISION':
      return new Map(state).set(action.noteId, action.note);

    case 'IMPORT_NOTE_WITH_ID': {
      return new Map(state).set(action.noteId, action.note);
    }

    case 'MARKDOWN_NOTE': {
      if (!state.has(action.noteId)) {
        return state;
      }

      const note = state.get(action.noteId)!;
      const alreadyMarkdown = note.systemTags.includes('markdown');
      if (alreadyMarkdown === action.shouldEnableMarkdown) {
        return state;
      }

      const systemTags = action.shouldEnableMarkdown
        ? [...note.systemTags, 'markdown' as T.SystemTag]
        : note.systemTags.filter((tag) => tag !== 'markdown');

      return new Map(state).set(
        action.noteId,
        modified({ ...note, systemTags })
      );
    }

    case 'PIN_NOTE': {
      if (!state.has(action.noteId)) {
        return state;
      }

      const note = state.get(action.noteId)!;
      const alreadyPinned = note.systemTags.includes('pinned');
      if (alreadyPinned === action.shouldPin) {
        return state;
      }

      const systemTags = action.shouldPin
        ? [...note.systemTags, 'pinned' as T.SystemTag]
        : note.systemTags.filter((tag) => tag !== 'pinned');

      return new Map(state).set(
        action.noteId,
        modified({ ...note, systemTags })
      );
    }

    case 'PUBLISH_NOTE': {
      if (!state.has(action.noteId)) {
        return state;
      }

      const note = state.get(action.noteId)!;
      const alreadyPinned = note.systemTags.includes('published');
      if (alreadyPinned === action.shouldPublish) {
        return state;
      }

      const systemTags = action.shouldPublish
        ? [...note.systemTags, 'published' as T.SystemTag]
        : note.systemTags.filter((tag) => tag !== 'published');

      return new Map(state).set(
        action.noteId,
        modified({ ...note, systemTags })
      );
    }

    case 'REMOVE_COLLABORATOR': {
      const note = state.get(action.noteId);
      if (!note) {
        return state;
      }

      const tagName = action.collaboratorAccount;
      const tags = note.tags.filter((t) => t !== tagName);

      return tags.length !== note.tags.length
        ? new Map(state).set(action.noteId, modified({ ...note, tags }))
        : state;
    }

    case 'RESTORE_NOTE':
      if (!state.has(action.noteId)) {
        return state;
      }

      return new Map(state).set(
        action.noteId,
        modified({
          ...state.get(action.noteId)!,
          deleted: false,
        })
      );

    case 'TRASH_NOTE':
      if (!state.has(action.noteId)) {
        return state;
      }

      return new Map(state).set(
        action.noteId,
        modified({
          ...state.get(action.noteId)!,
          deleted: true,
        })
      );

    case 'DELETE_FOLDER': {
      // Reassign notes in the deleted folder back to the default folder.
      const next = new Map(state);
      let changed = false;
      next.forEach((note, noteId) => {
        if (note.folderId === action.folderId) {
          changed = true;
          next.set(noteId, modified({ ...note, folderId: DEFAULT_FOLDER_ID }));
        }
      });
      return changed ? next : state;
    }

    default:
      return state;
  }
};

export const noteRevisions: A.Reducer<Map<T.EntityId, Map<number, T.Note>>> = (
  state = new Map(),
  action
) => {
  switch (action.type) {
    case 'LOAD_REVISIONS': {
      // merge the new revisions - we might have fewer inbound than we have stored
      const stored = state.get(action.noteId) ?? new Map();
      const next = new Map(stored);
      action.revisions.forEach(([version, note]) => next.set(version, note));

      return new Map(state).set(action.noteId, next);
    }

    default:
      return state;
  }
};

export const preferences: A.Reducer<Map<T.EntityId, T.Preferences>> = (
  state = new Map(),
  action
) => {
  switch (action.type) {
    case 'SET_ANALYTICS':
      return new Map(state).set('preferences-key', {
        ...(state.get('preferences-key') ?? {}),
        analytics_enabled: action.allowAnalytics,
      });

    case 'PREFERENCES_BUCKET_REMOVE': {
      const next = new Map(state);
      return next.delete(action.id) ? next : state;
    }

    case 'PREFERENCES_BUCKET_UPDATE':
      return new Map(state).set(action.id, action.data);

    default:
      return state;
  }
};

export const notebooks: A.Reducer<Map<T.NotebookId, T.Notebook>> = (
  state = new Map(),
  action
) => {
  switch (action.type) {
    case 'CREATE_NOTEBOOK':
      return new Map(state).set(action.notebookId, action.notebook);
    case 'RENAME_NOTEBOOK': {
      const existing = state.get(action.notebookId);
      if (!existing) {
        return state;
      }
      return new Map(state).set(action.notebookId, {
        ...existing,
        name: action.name,
      });
    }
    case 'DELETE_NOTEBOOK': {
      const next = new Map(state);
      return next.delete(action.notebookId) ? next : state;
    }
    default:
      return state;
  }
};

export const folders: A.Reducer<Map<T.FolderId, T.Folder>> = (
  state = new Map(),
  action
) => {
  switch (action.type) {
    case 'CREATE_FOLDER':
      return new Map(state).set(action.folderId, action.folder);
    case 'RENAME_FOLDER': {
      const existing = state.get(action.folderId);
      if (!existing) {
        return state;
      }
      return new Map(state).set(action.folderId, {
        ...existing,
        name: action.name,
      });
    }
    case 'DELETE_FOLDER': {
      // Delete the folder and all descendants so the UI tree stays consistent.
      const next = new Map(state);
      const toDelete = new Set<T.FolderId>();
      const queue: T.FolderId[] = [action.folderId];
      while (queue.length) {
        const cur = queue.pop()!;
        if (toDelete.has(cur)) continue;
        toDelete.add(cur);
        next.forEach((folder, folderId) => {
          if (folder.parentFolderId === cur) {
            queue.push(folderId);
          }
        });
      }
      let changed = false;
      toDelete.forEach((id) => {
        changed = next.delete(id) || changed;
      });
      return changed ? next : state;
    }
    default:
      return state;
  }
};

export default combineReducers({
  accountVerification,
  analyticsAllowed,
  notes,
  noteRevisions,
  preferences,
  notebooks,
  folders,
});
