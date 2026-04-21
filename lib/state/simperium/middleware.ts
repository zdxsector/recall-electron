import { default as createClient } from 'simperium';

import debugFactory from 'debug';
import actions from '../actions';
import { BucketQueue } from './functions/bucket-queue';
import { InMemoryBucket } from './functions/in-memory-bucket';
import { InMemoryGhost } from './functions/in-memory-ghost';
import { NoteBucket } from './functions/note-bucket';
// import { NoteDoctor } from './functions/note-doctor';
import { PreferencesBucket } from './functions/preferences-bucket';
import { ReduxGhost } from './functions/redux-ghost';
import { getUnconfirmedChanges } from './functions/unconfirmed-changes';
import { start as startConnectionMonitor } from './functions/connection-monitor';
import { confirmBeforeClosingTab } from './functions/tab-close-confirmation';
import { getAccountName } from './functions/username-monitor';
import { isElectron } from '../../utils/platform';
import { stopSyncing } from '../persistence';

import type * as A from '../action-types';
import type * as S from '../';
import type * as T from '../../types';

const debug = debugFactory('simperium-middleware');

type Buckets = {
  account: T.JSONSerializable;
  note: T.Note;
  preferences: T.Preferences;
};

export const initSimperium =
  (logout: () => any, token: string, username: string | null): S.Middleware =>
  (store) => {
    const { dispatch, getState } = store;

    const client = createClient<Buckets>(config.app_id, token, {
      objectStoreProvider: (bucket) => {
        switch (bucket.name) {
          case 'account':
            return new InMemoryBucket();

          case 'note':
            return new NoteBucket(store);

          case 'preferences':
            return new PreferencesBucket(store);
        }
      },

      ghostStoreProvider: (bucket) => {
        switch (bucket.name) {
          case 'account':
            return new InMemoryGhost();

          default:
            return new ReduxGhost(bucket.name, store);
        }
      },
    });
    client.on('unauthorized', () => logout());

    getAccountName(client).then((accountName) => {
      debug(`authenticated: ${accountName}`);
      dispatch(actions.settings.setAccountName(accountName));
    });

    startConnectionMonitor(client, store);
    if (!isElectron) {
      confirmBeforeClosingTab(store);
    }

    const noteBucket = client.bucket('note');
    noteBucket.channel.on(
      'update',
      (entityId, updatedEntity, original, patch, isIndexing) => {
        if (original && patch && 'undefined' !== typeof isIndexing) {
          dispatch({
            type: 'REMOTE_NOTE_UPDATE',
            noteId: entityId as T.EntityId,
            note: updatedEntity,
            remoteInfo: {
              original,
              patch,
              isIndexing,
            },
          });
        } else {
          dispatch({
            type: 'REMOTE_NOTE_UPDATE',
            noteId: entityId as T.EntityId,
            note: updatedEntity,
          });
        }
      }
    );
    noteBucket.channel.on('remove', (noteId) =>
      dispatch({
        type: 'REMOTE_NOTE_DELETE_FOREVER',
        noteId,
      })
    );

    if ('Notification' in window) {
      import(
        /* webpackChunkName: 'change-announcer' */ './functions/change-announcer'
      ).then(({ announceNoteUpdates }) =>
        noteBucket.channel.on('update', announceNoteUpdates(store))
      );
    }

    noteBucket.channel.localQueue.on('send', (change) => {
      dispatch({
        type: 'SUBMIT_PENDING_CHANGE',
        entityId: change.id as T.EntityId,
        ccid: change.ccid,
      });
    });

    noteBucket.channel.on('acknowledge', (entityId, change) => {
      dispatch({
        type: 'ACKNOWLEDGE_PENDING_CHANGE',
        entityId: entityId as T.EntityId,
        ccid: change.ccid,
      });
    });

    const parseVerificationToken = (token: unknown) => {
      try {
        const { username, verified_at: verifiedAt } = JSON.parse(
          token as string
        );
        return { username, verifiedAt };
      } catch (e) {
        return null;
      }
    };

    const updateVerificationState = (entity: T.JSONSerializable) => {
      const { token, sent_to } = entity;

      const parsedToken = parseVerificationToken(token);
      const hasValidToken = parsedToken && parsedToken.username === username;
      const hasPendingEmail = sent_to === username;

      const state = hasValidToken
        ? 'verified'
        : hasPendingEmail
          ? 'pending'
          : 'unverified';

      return dispatch({
        type: 'UPDATE_ACCOUNT_VERIFICATION',
        state,
      });
    };

    const accountBucket = client.bucket('account');
    accountBucket.on('update', (entityId, entity) => {
      if ('email-verification' === entityId) {
        updateVerificationState(entity);
      }
    });
    accountBucket.channel.on('ready', () => {
      if ('unknown' === getState().data.accountVerification) {
        dispatch({
          type: 'UPDATE_ACCOUNT_VERIFICATION',
          state: 'unverified',
        });
      }
    });

    const preferencesBucket = client.bucket('preferences');
    preferencesBucket.channel.on('update', (entityId, updatedEntity) => {
      if ('preferences-key' !== entityId) {
        return;
      }

      if (
        !!updatedEntity.analytics_enabled !== getState().data.analyticsAllowed
      ) {
        dispatch({
          type: 'REMOTE_ANALYTICS_UPDATE',
          allowAnalytics: !!updatedEntity.analytics_enabled,
        });
      }
    });
    preferencesBucket.channel.once('ready', async () => {
      const preferences = await preferencesBucket.get('preferences-key');
      dispatch({
        type: 'REMOTE_ANALYTICS_UPDATE',
        allowAnalytics: !!preferences?.data?.analytics_enabled,
      });
    });

    const noteQueue = new BucketQueue(noteBucket);
    const queueNoteUpdate = (noteId: T.EntityId, delay = 2000) =>
      noteQueue.add(noteId, Date.now() + delay);

    const hasRequestedRevisions = new Set<T.EntityId>();

    const preferencesQueue = new BucketQueue(preferencesBucket);
    const queuePreferencesUpdate = (entityId: T.EntityId, delay = 20) =>
      preferencesQueue.add(entityId, Date.now() + delay);

    if ('production' !== process.env.NODE_ENV) {
      window.account = accountBucket;
      // window.preferencesBucket = preferencesBucket;
      window.noteBucket = noteBucket;
      window.noteQueue = noteQueue;
    }

    // walk notes and queue any for sync which have discrepancies with their ghost
    // new NoteDoctor(store, noteQueue);

    window.addEventListener('storage', (event) => {
      if (event.key === 'recall_logout') {
        stopSyncing();
        client.end();
        logout();
      }
    });

    return (next) => (action: A.ActionType) => {
      const prevState = store.getState();
      const result = next(action);
      const nextState = store.getState();

      switch (action.type) {
        case 'ADD_COLLABORATOR':
          queueNoteUpdate(action.noteId);
          return result;

        case 'REMOVE_COLLABORATOR':
          queueNoteUpdate(action.noteId);
          return result;

        case 'CREATE_NOTE_WITH_ID':
        case 'INSERT_TASK_INTO_NOTE':
        case 'EDIT_NOTE':
          queueNoteUpdate(action.noteId);
          return result;

        case 'FILTER_NOTES':
        case 'OPEN_NOTE':
        case 'SELECT_NOTE': {
          const noteId =
            action.noteId ??
            action.meta?.nextNoteToOpen ??
            getState().ui.openedNote;

          //  Preload the revisions when opening a note but only do it if no revisions are in memory
          if (
            noteId &&
            !nextState.data.noteRevisions.get(noteId)?.size &&
            !hasRequestedRevisions.has(noteId)
          ) {
            hasRequestedRevisions.add(noteId);
            setTimeout(() => {
              if (getState().ui.openedNote === noteId) {
                noteBucket.getRevisions(noteId).then((revisions) => {
                  dispatch({
                    type: 'LOAD_REVISIONS',
                    noteId: noteId,
                    revisions: revisions
                      .map(({ data, version }): [number, T.Note] => [
                        version,
                        data,
                      ])
                      .sort((a, b) => a[0] - b[0]),
                  });
                });
              }
            }, 250);
          }
          return result;
        }

        case 'REVISIONS_TOGGLE': {
          const showRevisions = nextState.ui.showRevisions;
          const noteId = nextState.ui.openedNote;

          if (noteId && showRevisions) {
            noteBucket.getRevisions(noteId).then((revisions) => {
              dispatch({
                type: 'LOAD_REVISIONS',
                noteId: noteId,
                revisions: revisions
                  .map(({ data, version }): [number, T.Note] => [version, data])
                  .sort((a, b) => a[0] - b[0]),
              });
            });
          }

          return result;
        }

        case 'RESTORE_NOTE_REVISION': {
          queueNoteUpdate(action.noteId, 10);
          return result;
        }

        // other note editing actions however
        // should trigger an immediate sync
        case 'MARKDOWN_NOTE':
        case 'PIN_NOTE':
        case 'PUBLISH_NOTE':
        case 'RESTORE_NOTE':
        case 'TRASH_NOTE':
          queueNoteUpdate(action.noteId, 10);
          return result;

        case 'IMPORT_NOTE_WITH_ID': {
          queueNoteUpdate(action.noteId, 10);
          return result;
        }

        case 'DELETE_NOTE_FOREVER':
          setTimeout(() => noteBucket.remove(action.noteId), 10);
          return result;

        case 'SET_ANALYTICS':
          queuePreferencesUpdate('preferences-key' as T.EntityId);
          return result;

        case 'CLOSE_WINDOW': {
          const changes = getUnconfirmedChanges(nextState);
          changes.notes.forEach((noteId) => noteQueue.add(noteId, Date.now()));

          if (changes.notes.length > 0) {
            store.dispatch({
              type: 'SHOW_DIALOG',
              name: 'CLOSE-WINDOW-CONFIRMATION',
            });
            return result;
          }

          store.dispatch({
            type: 'REALLY_CLOSE_WINDOW',
          });
          return result;
        }

        case 'LOGOUT': {
          const changes = getUnconfirmedChanges(nextState);
          changes.notes.forEach((noteId) => noteQueue.add(noteId, Date.now()));

          if (changes.notes.length > 0) {
            store.dispatch({
              type: 'SHOW_DIALOG',
              name: 'LOGOUT-CONFIRMATION',
            });
            return result;
          }

          stopSyncing();
          localStorage.setItem('recall_logout', Math.random().toString());
          client.end();
          logout();
          return result;
        }

        case 'REALLY_LOG_OUT':
          stopSyncing();
          localStorage.setItem('recall_logout', Math.random().toString());
          client.end();
          logout();
          return result;
      }

      return result;
    };
  };
