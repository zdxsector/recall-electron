import React, { Component } from 'react';
import { connect } from 'react-redux';
import SearchResultsBar from '../search-results-bar';
import NoteDetail from '../note-detail';
import actions from '../state/actions';
import * as selectors from '../state/selectors';

import * as S from '../state';
import * as T from '../types';
type StateProps = {
  isEditorActive: boolean;
  isSearchActive: boolean;
  isSmallScreen: boolean;
  hasSearchMatchesInNote: boolean;
  hasSearchQuery: boolean;
  keyboardShortcuts: boolean;
  noteId: T.EntityId | null;
  note: T.Note | null;
  searchQuery: string;
};

type DispatchProps = {
  createNote: (note?: Partial<T.Note>) => any;
  toggleNoteList: () => any;
};

type Props = DispatchProps & StateProps;

export class NoteEditor extends Component<Props> {
  static displayName = 'NoteEditor';

  // Class property declarations for focus management
  private editorHasFocus?: () => boolean;
  private focusNoteEditor?: () => void;
  private isCreatingEmptyNote = false;

  componentDidMount() {
    this.toggleShortcuts(true);
  }

  componentWillUnmount() {
    this.toggleShortcuts(false);
  }

  componentDidUpdate(prevProps: Props) {
    if (!prevProps.note && this.props.note) {
      this.isCreatingEmptyNote = false;
    }
  }

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

  storeEditorHasFocus = (f) => (this.editorHasFocus = f);

  storeFocusEditor = (f) => (this.focusNoteEditor = f);

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

  render() {
    const { hasSearchQuery, hasSearchMatchesInNote, note } = this.props;

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

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  keyboardShortcuts: state.settings.keyboardShortcuts,
  isEditorActive: !state.ui.showNavigation,
  noteId: state.ui.openedNote,
  note: state.data.notes.get(state.ui.openedNote),
  searchQuery: state.ui.searchQuery,
  revision: state.ui.selectedRevision,
  hasSearchQuery: state.ui.searchQuery !== '',
  hasSearchMatchesInNote:
    !!state.ui.numberOfMatchesInNote && state.ui.numberOfMatchesInNote > 0,
  isSearchActive: !!state.ui.searchQuery.length,
  isSmallScreen: selectors.isSmallScreen(state),
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  createNote: actions.ui.createNote,
  toggleNoteList: actions.ui.toggleNoteList,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteEditor);
