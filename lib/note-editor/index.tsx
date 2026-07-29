import React, { Component } from 'react';
import { connect } from 'react-redux';
import SearchResultsBar from '../search-results-bar';
import NoteDetail from '../note-detail';
import LockIcon from '../icons/lock';
import actions from '../state/actions';
import * as selectors from '../state/selectors';
import { domRectToNativeAuthPayload } from '../utils/native-auth-rect';
import { getLockedNoteTitle, isNoteLocked } from '../utils/locked-note';

import * as S from '../state';
import * as T from '../types';
type StateProps = {
  isEditorActive: boolean;
  isSearchActive: boolean;
  isSmallScreen: boolean;
  hasSearchMatchesInNote: boolean;
  hasSearchQuery: boolean;
  keyboardShortcuts: boolean;
  lockedNotesPasswordMode: T.LockedNotesPasswordMode;
  lockedNotesUseTouchId: boolean;
  noteId: T.EntityId | null;
  note: T.Note | null;
  searchQuery: string;
  unlockedContent: string | null;
};

type DispatchProps = {
  createNote: (note?: Partial<T.Note>) => any;
  storeUnlockedNoteContent: (noteId: T.EntityId, content: string) => any;
  toggleNoteList: () => any;
};

type Props = DispatchProps & StateProps;

type LocalState = {
  embeddedAuthUnavailable: boolean;
  isUnlocking: boolean;
  lockedNotesLoginUsername: string | null;
  systemAuthUnavailable: boolean;
  unlockError: string | null;
};

export class NoteEditor extends Component<Props, LocalState> {
  static displayName = 'NoteEditor';
  state: LocalState = {
    embeddedAuthUnavailable: false,
    isUnlocking: false,
    lockedNotesLoginUsername: null,
    systemAuthUnavailable: false,
    unlockError: null,
  };

  // Class property declarations for focus management
  private editorHasFocus?: () => boolean;
  private focusNoteEditor?: () => void;
  private isCreatingEmptyNote = false;
  private nativeAuthAnchorRef = React.createRef<HTMLDivElement>();
  private nativePasswordAnchorRef = React.createRef<HTMLDivElement>();
  private nativeAuthNoteId: T.EntityId | null = null;
  private nativeAuthResizeObserver?: ResizeObserver;
  private nativeAuthUpdateFrame: number | null = null;
  private attemptedNativeAuthNoteId: T.EntityId | null = null;
  private trustedUnlockSucceededNoteId: T.EntityId | null = null;
  private isComponentMounted = false;

  componentDidMount() {
    this.isComponentMounted = true;
    this.toggleShortcuts(true);
    this.loadLockedNotesLoginUsername();
    this.syncNativeAuthOverlay();
  }

  componentWillUnmount() {
    this.isComponentMounted = false;
    this.toggleShortcuts(false);
    this.teardownNativeAuthOverlay();
  }

  componentDidUpdate(prevProps: Props) {
    if (!prevProps.note && this.props.note) {
      this.isCreatingEmptyNote = false;
    }
    if (prevProps.noteId !== this.props.noteId) {
      this.attemptedNativeAuthNoteId = null;
      this.trustedUnlockSucceededNoteId = null;
      this.setState({
        embeddedAuthUnavailable: false,
        isUnlocking: false,
        systemAuthUnavailable: false,
        unlockError: null,
      });
    }
    this.syncNativeAuthOverlay(prevProps);
  }

  loadLockedNotesLoginUsername = async () => {
    if (
      !window.electron?.isMac ||
      typeof window.electron?.secureNotes?.lockedNotes?.getLoginUsername !==
        'function'
    ) {
      return;
    }

    try {
      const result =
        await window.electron.secureNotes.lockedNotes.getLoginUsername();
      if (
        this.isComponentMounted &&
        result?.ok &&
        typeof result.username === 'string'
      ) {
        this.setState({ lockedNotesLoginUsername: result.username });
      }
    } catch {
      // Display copy falls back to "your" when the safe username lookup fails.
    }
  };

  handleShortcut = (event: KeyboardEvent) => {
    if (!this.props.keyboardShortcuts) {
      return;
    }

    const { ctrlKey, metaKey, shiftKey } = event;
    const key = event.key.toLowerCase();

    const cmdOrCtrl = ctrlKey || metaKey;

    // focus the note editor
    if (shiftKey && cmdOrCtrl && 'y' === key && this.props.isEditorActive) {
      if (!this.editFieldHasFocus() || this.props.isSearchActive) {
        this.focusNoteEditor?.();

        event.stopPropagation();
        event.preventDefault();
        return false;
      }
    }

    return true;
  };

  editFieldHasFocus = () => this.editorHasFocus && this.editorHasFocus();

  storeEditorHasFocus = (f: () => boolean) => (this.editorHasFocus = f);

  storeFocusEditor = (f: () => void) => (this.focusNoteEditor = f);

  toggleShortcuts = (doEnable: boolean) => {
    if (doEnable) {
      window.addEventListener('keydown', this.handleShortcut, true);
    } else {
      window.removeEventListener('keydown', this.handleShortcut, true);
    }
  };

  createNoteFromEmptyEditor = (content?: string) => {
    if (this.props.note || this.isCreatingEmptyNote) {
      return;
    }

    this.isCreatingEmptyNote = true;

    const fallbackContent = this.props.searchQuery;
    const nextContent = content ?? fallbackContent;
    const titleContent = nextContent ? `# ${nextContent}` : '# ';

    this.props.createNote({ content: titleContent });
  };

  handleEmptyEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.createNoteFromEmptyEditor();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      this.createNoteFromEmptyEditor(event.key);
    }
  };

  isShowingLockedNote = () => {
    const { note, noteId, unlockedContent } = this.props;
    return (
      !!note &&
      isNoteLocked(note) &&
      unlockedContent === null &&
      this.trustedUnlockSucceededNoteId !== noteId
    );
  };

  getNativeAuthPayload = () => {
    const anchor = this.nativeAuthAnchorRef.current;
    const passwordAnchor = this.nativePasswordAnchorRef.current;
    const { noteId } = this.props;
    if (!anchor || !noteId) {
      return null;
    }

    const payload = domRectToNativeAuthPayload(
      noteId,
      anchor.getBoundingClientRect(),
      window.innerHeight,
      window.devicePixelRatio || 1,
      passwordAnchor?.getBoundingClientRect()
    );

    if (!payload) {
      return null;
    }

    payload.authMethod = this.props.lockedNotesPasswordMode;
    payload.passwordPlaceholder = this.getPasswordPlaceholder();
    payload.useTouchId = this.props.lockedNotesUseTouchId;
    return payload;
  };

  getPasswordPlaceholder = () => {
    if (this.props.lockedNotesPasswordMode === 'custom') {
      return 'Enter note password';
    }

    const username = this.state.lockedNotesLoginUsername;
    return username
      ? `Enter ${username} login password`
      : 'Enter login password';
  };

  getLockedNotePrompt = () => {
    const { lockedNotesPasswordMode, lockedNotesUseTouchId } = this.props;
    const prefix = lockedNotesUseTouchId ? 'Use Touch ID or enter' : 'Enter';

    if (lockedNotesPasswordMode === 'custom') {
      return `${prefix} note password to view this note.`;
    }

    const username = this.state.lockedNotesLoginUsername || 'your';
    return `${prefix} ${username} login password to view this note.`;
  };

  startResizeObserver = () => {
    const anchor = this.nativeAuthAnchorRef.current;
    if (!anchor || this.nativeAuthResizeObserver) {
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.nativeAuthResizeObserver = new ResizeObserver(() => {
        this.scheduleNativeAuthOverlayUpdate();
      });
      this.nativeAuthResizeObserver.observe(anchor);
      const passwordAnchor = this.nativePasswordAnchorRef.current;
      if (passwordAnchor) {
        this.nativeAuthResizeObserver.observe(passwordAnchor);
      }
    }

    window.addEventListener('resize', this.scheduleNativeAuthOverlayUpdate);
  };

  stopResizeObserver = () => {
    if (this.nativeAuthResizeObserver) {
      this.nativeAuthResizeObserver.disconnect();
      this.nativeAuthResizeObserver = undefined;
    }
    window.removeEventListener('resize', this.scheduleNativeAuthOverlayUpdate);
    if (this.nativeAuthUpdateFrame !== null) {
      cancelAnimationFrame(this.nativeAuthUpdateFrame);
      this.nativeAuthUpdateFrame = null;
    }
  };

  scheduleNativeAuthOverlayUpdate = () => {
    if (this.nativeAuthUpdateFrame !== null) {
      return;
    }

    this.nativeAuthUpdateFrame = requestAnimationFrame(() => {
      this.nativeAuthUpdateFrame = null;
      this.updateNativeAuthOverlay();
    });
  };

  updateNativeAuthOverlay = async () => {
    if (!this.isShowingLockedNote() || !this.nativeAuthNoteId) {
      return;
    }

    const payload = this.getNativeAuthPayload();
    if (!payload) {
      return;
    }

    try {
      await window.electron.secureNotes.nativeAuth.update(payload);
    } catch {
      // Overlay alignment is best-effort; the trusted unlock path is separate.
    }
  };

  showNativeAuthOverlay = async () => {
    const payload = this.getNativeAuthPayload();
    const { note, noteId } = this.props;
    if (!payload || !noteId || !note) {
      return;
    }

    this.nativeAuthNoteId = noteId;
    this.attemptedNativeAuthNoteId = noteId;
    this.startResizeObserver();
    this.setState({ isUnlocking: true, unlockError: null });
    try {
      const result = await window.electron.secureNotes.nativeAuth.show({
        ...payload,
        reason: `View "${getLockedNoteTitle(note)}" in Recall`,
      });

      if (
        !this.isComponentMounted ||
        this.props.noteId !== noteId ||
        this.nativeAuthNoteId !== noteId ||
        !this.isShowingLockedNote()
      ) {
        return;
      }

      if (result?.ok) {
        await this.handleUnlockNote({ fromNativeAuth: true });
        return;
      }

      const code = result?.code || result?.error;
      this.setState({
        embeddedAuthUnavailable: this.isEmbeddedAuthUnavailableCode(code),
        isUnlocking: false,
        systemAuthUnavailable: this.isSystemAuthUnavailableCode(code),
        unlockError: this.getUnlockErrorMessage(code),
      });
    } catch {
      if (!this.isComponentMounted) {
        return;
      }
      this.setState({
        embeddedAuthUnavailable: true,
        isUnlocking: false,
        systemAuthUnavailable: false,
        unlockError: 'This note could not be unlocked.',
      });
    }
  };

  hideNativeAuthOverlay = async () => {
    const noteId = this.nativeAuthNoteId;
    this.nativeAuthNoteId = null;
    this.stopResizeObserver();
    try {
      await window.electron.secureNotes.nativeAuth.hide({
        noteId: noteId ?? undefined,
      });
    } catch {
      // best-effort cleanup
    }
  };

  teardownNativeAuthOverlay = () => {
    this.hideNativeAuthOverlay();
  };

  syncNativeAuthOverlay = (prevProps?: Props) => {
    const isLocked = this.isShowingLockedNote();
    const noteChanged = prevProps && prevProps.noteId !== this.props.noteId;
    const settingsChanged =
      prevProps &&
      (prevProps.lockedNotesPasswordMode !==
        this.props.lockedNotesPasswordMode ||
        prevProps.lockedNotesUseTouchId !== this.props.lockedNotesUseTouchId);

    if (!isLocked) {
      if (this.nativeAuthNoteId !== null) {
        this.hideNativeAuthOverlay();
      }
      return;
    }

    if ((noteChanged || settingsChanged) && this.nativeAuthNoteId !== null) {
      this.hideNativeAuthOverlay();
      if (settingsChanged) {
        this.attemptedNativeAuthNoteId = null;
      }
    }

    if (
      this.nativeAuthNoteId !== this.props.noteId &&
      this.attemptedNativeAuthNoteId !== this.props.noteId
    ) {
      this.showNativeAuthOverlay();
    } else {
      this.scheduleNativeAuthOverlayUpdate();
    }
  };

  handleUnlockNote = async ({
    allowModalFallback = false,
    fromNativeAuth = false,
  }: { allowModalFallback?: boolean; fromNativeAuth?: boolean } = {}) => {
    const { note, noteId, storeUnlockedNoteContent } = this.props;
    if (
      !noteId ||
      !note?.locked?.encryptedContent ||
      (this.state.isUnlocking && !fromNativeAuth && !allowModalFallback)
    ) {
      return;
    }

    this.setState({ isUnlocking: true, unlockError: null });
    try {
      const result = await window.electron.secureNotes.systemAuth.unlock({
        allowModalFallback,
        noteId,
        encryptedContent: note.locked.encryptedContent,
        reason: `View "${getLockedNoteTitle(note)}" in Recall`,
      });

      if (!this.isComponentMounted || this.props.noteId !== noteId) {
        return;
      }

      if (result?.ok && typeof result.content === 'string') {
        this.trustedUnlockSucceededNoteId = noteId;
        storeUnlockedNoteContent(noteId, result.content);
        this.hideNativeAuthOverlay();
        this.setState({
          isUnlocking: false,
          unlockError: null,
        });
        return;
      }

      const code = result?.code || result?.error;
      this.setState({
        embeddedAuthUnavailable: false,
        isUnlocking: false,
        systemAuthUnavailable: this.isSystemAuthUnavailableCode(code),
        unlockError: this.getUnlockErrorMessage(code),
      });
    } catch {
      if (!this.isComponentMounted) {
        return;
      }
      this.setState({
        isUnlocking: false,
        unlockError: 'This note could not be unlocked.',
      });
    }
  };

  handleLockedNoteButtonClick = async () => {
    if (this.state.isUnlocking) {
      return;
    }

    if (
      this.state.embeddedAuthUnavailable &&
      !this.state.systemAuthUnavailable &&
      window.electron?.isMac
    ) {
      await this.hideNativeAuthOverlay();
      await this.handleUnlockNote({ allowModalFallback: true });
      return;
    }

    await this.hideNativeAuthOverlay();
    this.attemptedNativeAuthNoteId = null;
    this.showNativeAuthOverlay();
  };

  isEmbeddedAuthUnavailableCode = (code?: string) =>
    code === 'unavailable' ||
    code === 'embedded_ui_unavailable' ||
    code === 'native_addon_unavailable' ||
    code === 'native_addon_load_failed';

  isSystemAuthUnavailableCode = (code?: string) =>
    code === 'unsupported_platform' ||
    code === 'fallback_unavailable' ||
    code === 'system_auth_unavailable';

  getUnlockErrorMessage = (code?: string) => {
    if (code === 'cancelled') {
      return 'Authentication was cancelled.';
    }
    if (code === 'timeout') {
      return 'Authentication timed out.';
    }
    if (code === 'invalid_password') {
      return 'Invalid password.';
    }
    if (code === 'verification_error') {
      return 'Password verification failed.';
    }
    if (code === 'decrypt_failed') {
      return (
        'Recall could not access the Keychain item needed to unlock this note. ' +
        'Do not delete "Recall Safe Storage".'
      );
    }
    if (code === 'encryption_unavailable') {
      return 'Keychain encryption is unavailable on this device.';
    }
    if (this.isEmbeddedAuthUnavailableCode(code)) {
      return 'Embedded authentication is unavailable.';
    }
    if (this.isSystemAuthUnavailableCode(code)) {
      return 'System authentication is unavailable on this device.';
    }
    if (code === 'authentication_failed') {
      return 'Authentication failed.';
    }
    return 'This note could not be unlocked.';
  };

  renderLockedNote = () => {
    const isMac = window.electron?.isMac;
    const {
      embeddedAuthUnavailable,
      isUnlocking,
      systemAuthUnavailable,
      unlockError,
    } = this.state;
    const canUseSystemFallback =
      embeddedAuthUnavailable && isMac && !systemAuthUnavailable;
    const actionLabel = canUseSystemFallback
      ? 'Use System Authentication'
      : 'Try Again';
    return (
      <div className="note-editor note-editor--locked">
        <div className="note-editor-locked-panel" role="group">
          <div className="note-editor-locked-symbol" aria-hidden="true">
            <div className="note-editor-locked-icon">
              <LockIcon filled />
            </div>
            <div
              className="note-editor-locked-anchor"
              ref={this.nativeAuthAnchorRef}
            />
          </div>
          <h2>This note is locked.</h2>
          <p>
            {systemAuthUnavailable && !isUnlocking
              ? 'System authentication is unavailable on this device.'
              : canUseSystemFallback && !isUnlocking
                ? 'Embedded authentication is unavailable. Use system authentication fallback to view this note.'
                : this.getLockedNotePrompt()}
          </p>
          {isMac && !systemAuthUnavailable && (
            <div
              aria-hidden="true"
              className="note-editor-native-password-anchor"
              ref={this.nativePasswordAnchorRef}
            />
          )}
          {!isUnlocking && (
            <button
              aria-label="Unlock locked note"
              className="note-editor-locked-button"
              onClick={this.handleLockedNoteButtonClick}
              type="button"
            >
              {actionLabel}
            </button>
          )}
          {unlockError && (
            <div className="note-editor-locked-error" role="alert">
              {unlockError}
            </div>
          )}
        </div>
      </div>
    );
  };

  render() {
    const { hasSearchQuery, hasSearchMatchesInNote, note, unlockedContent } =
      this.props;

    if (!note) {
      return (
        <div
          aria-label="New note editor"
          aria-multiline="true"
          className="note-editor note-editor--empty"
          onClick={() => this.createNoteFromEmptyEditor()}
          onKeyDown={this.handleEmptyEditorKeyDown}
          role="textbox"
          tabIndex={0}
        >
          <div className="note-editor-empty-surface" />
        </div>
      );
    }

    if (isNoteLocked(note) && unlockedContent === null) {
      return this.renderLockedNote();
    }

    return (
      <div className="note-editor">
        <NoteDetail
          storeFocusEditor={this.storeFocusEditor}
          storeHasFocus={this.storeEditorHasFocus}
        />
        {hasSearchQuery && hasSearchMatchesInNote && <SearchResultsBar />}
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = (state) => {
  const openedNote = state.ui.openedNote;
  return {
    keyboardShortcuts: state.settings.keyboardShortcuts,
    lockedNotesPasswordMode: state.settings.lockedNotesPasswordMode,
    lockedNotesUseTouchId: state.settings.lockedNotesUseTouchId,
    isEditorActive: !state.ui.showNavigation,
    noteId: openedNote,
    note:
      openedNote !== null ? (state.data.notes.get(openedNote) ?? null) : null,
    unlockedContent:
      openedNote !== null
        ? (state.ui.unlockedNoteContent.get(openedNote) ?? null)
        : null,
    searchQuery: state.ui.searchQuery,
    hasSearchQuery: state.ui.searchQuery !== '',
    hasSearchMatchesInNote:
      !!state.ui.numberOfMatchesInNote && state.ui.numberOfMatchesInNote > 0,
    isSearchActive: !!state.ui.searchQuery.length,
    isSmallScreen: selectors.isSmallScreen(state),
  };
};

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  createNote: actions.ui.createNote,
  storeUnlockedNoteContent: actions.ui.storeUnlockedNoteContent,
  toggleNoteList: actions.ui.toggleNoteList,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteEditor);
