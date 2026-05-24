import React, { Component } from 'react';
import { connect } from 'react-redux';
import FocusTrap from 'focus-trap-react';

import LockIcon from '../icons/lock';
import PinnedIcon from '../icons/pinned';
import actions from '../state/actions';
import {
  createLockedNotePlaceholder,
  getLockedNoteTitle,
  getLockedNoteTitleFromContent,
  isNoteLocked,
} from '../utils/locked-note';

import * as S from '../state';
import * as T from '../types';

type StateProps = {
  hasRevisions: boolean;
  isPinned: boolean;
  noteId: T.EntityId | null;
  note: T.Note | undefined;
  unlockedContent: string | null;
};

type DispatchProps = {
  clearUnlockedNoteContent: (noteId: T.EntityId) => any;
  editNote: (noteId: T.EntityId, changes: Partial<T.Note>) => any;
  onFocusTrapDeactivate: () => any;
  pinNote: (noteId: T.EntityId, shouldPin: boolean) => any;
  storeUnlockedNoteContent: (noteId: T.EntityId, content: string) => any;
  toggleRevisions: () => any;
  trashNote: () => any;
};

type Props = StateProps & DispatchProps;

type LocalState = {
  isLocking: boolean;
  lockError: string | null;
};

export class NoteActions extends Component<Props, LocalState> {
  static displayName = 'NoteActions';
  state: LocalState = { isLocking: false, lockError: null };
  // Note: Cannot use 'isMounted' as it conflicts with React's deprecated getter-only property
  private _isMounted = false;
  containerRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  handleFocusTrapDeactivate = () => {
    const { onFocusTrapDeactivate } = this.props;

    if (this._isMounted) {
      // Bit of a delay so that clicking the note actios toolbar will toggle the view properly.
      setTimeout(() => onFocusTrapDeactivate(), 200);
    }
  };

  render() {
    const { hasRevisions, isPinned, note, unlockedContent } = this.props;
    const noteIsLocked = !!note && isNoteLocked(note);
    const shouldUnlock = noteIsLocked && unlockedContent === null;
    const pinLabel = isPinned ? 'Unpin Note' : 'Pin Note';
    const lockLabel = shouldUnlock ? 'Unlock Note' : 'Lock Note';

    return (
      <FocusTrap
        focusTrapOptions={{
          clickOutsideDeactivates: true,
          onDeactivate: this.handleFocusTrapDeactivate,
        }}
      >
        <div className="note-actions" ref={this.containerRef}>
          <div className="note-actions-panel">
            <button
              className="note-actions-item note-actions-item-button"
              onClick={() => this.pinNote(!isPinned)}
              type="button"
            >
              <span className="note-actions-item-icon" aria-hidden="true">
                <PinnedIcon />
              </span>
              <span className="note-actions-name">{pinLabel}</span>
            </button>

            <button
              className="note-actions-item note-actions-item-button"
              disabled={this.state.isLocking}
              onClick={this.handleLockNote}
              type="button"
            >
              <span className="note-actions-item-icon" aria-hidden="true">
                <LockIcon />
              </span>
              <span className="note-actions-name">
                {this.state.isLocking ? 'Working...' : lockLabel}
              </span>
            </button>

            {this.state.lockError && (
              <div className="note-actions-error" role="alert">
                {this.state.lockError}
              </div>
            )}

            {hasRevisions && (
              <div className="note-actions-item">
                <button
                  className="button button-borderless"
                  onClick={this.props.toggleRevisions}
                >
                  History…
                </button>
              </div>
            )}
            {hasRevisions || (
              <div className="note-actions-item note-actions-item-disabled">
                <span className="note-actions-disabled">
                  History (unavailable)
                </span>
              </div>
            )}
          </div>
          <div className="note-actions-panel">
            <div className="note-actions-item note-actions-trash">
              <button
                className="button button-borderless"
                onClick={this.props.trashNote}
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      </FocusTrap>
    );
  }

  pinNote = (shouldPin: boolean) => {
    if (!this.props.noteId) {
      return;
    }

    this.props.pinNote(this.props.noteId, shouldPin);
    this.props.onFocusTrapDeactivate();
  };

  handleLockNote = async () => {
    const { note, noteId, unlockedContent } = this.props;
    if (!noteId || !note || this.state.isLocking) {
      return;
    }

    if (isNoteLocked(note) && unlockedContent === null) {
      await this.unlockNote(noteId, note);
      return;
    }

    await this.lockNote(noteId, note, unlockedContent ?? note.content ?? '');
  };

  lockNote = async (noteId: T.EntityId, note: T.Note, content: string) => {
    this.setState({ isLocking: true, lockError: null });
    try {
      const result = await window.electron.encryptNoteContent({ content });
      if (!result?.ok || !result.encryptedContent) {
        this.setState({
          isLocking: false,
          lockError: 'This note could not be locked.',
        });
        return;
      }

      const now = Date.now() / 1000;
      const previewTitle = getLockedNoteTitleFromContent(content);
      this.props.editNote(noteId, {
        content: createLockedNotePlaceholder(previewTitle),
        locked: {
          encryptedContent: result.encryptedContent,
          previewTitle,
          lockedAt: note.locked?.lockedAt ?? result.lockedAt ?? now,
          updatedAt: now,
          encryptionVersion: 1,
        },
      });
      this.props.clearUnlockedNoteContent(noteId);
      this.setState({ isLocking: false, lockError: null });
      this.props.onFocusTrapDeactivate();
    } catch {
      this.setState({
        isLocking: false,
        lockError: 'This note could not be locked.',
      });
    }
  };

  unlockNote = async (noteId: T.EntityId, note: T.Note) => {
    if (!note.locked?.encryptedContent) {
      return;
    }

    this.setState({ isLocking: true, lockError: null });
    try {
      const result = await window.electron.secureNotes.systemAuth.unlock({
        allowModalFallback: true,
        noteId,
        encryptedContent: note.locked.encryptedContent,
        reason: `View "${getLockedNoteTitle(note)}" in Recall`,
      });
      if (result?.ok && typeof result.content === 'string') {
        this.props.storeUnlockedNoteContent(noteId, result.content);
        this.setState({ isLocking: false, lockError: null });
        this.props.onFocusTrapDeactivate();
        return;
      }

      const code = result?.code || result?.error;
      this.setState({
        isLocking: false,
        lockError:
          code === 'cancelled' || code === 'authentication_failed'
            ? 'Authentication was cancelled or failed.'
            : 'This note could not be unlocked.',
      });
    } catch {
      this.setState({
        isLocking: false,
        lockError: 'This note could not be unlocked.',
      });
    }
  };
}

const mapStateToProps: S.MapState<StateProps> = ({
  data,
  ui: { openedNote, unlockedNoteContent },
}) => {
  const note = openedNote !== null ? data.notes.get(openedNote) : undefined;

  return {
    noteId: openedNote,
    note: note,
    hasRevisions:
      openedNote !== null && !!data.noteRevisions.get(openedNote)?.size,
    isPinned: !!note?.systemTags.includes('pinned'),
    unlockedContent:
      openedNote !== null
        ? (unlockedNoteContent.get(openedNote) ?? null)
        : null,
  };
};

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  clearUnlockedNoteContent: actions.ui.clearUnlockedNoteContent,
  editNote: actions.data.editNote,
  onFocusTrapDeactivate: actions.ui.closeNoteActions,
  pinNote: actions.data.pinNote,
  storeUnlockedNoteContent: actions.ui.storeUnlockedNoteContent,
  toggleRevisions: actions.ui.toggleRevisions,
  trashNote: actions.ui.trashOpenNote,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteActions);
