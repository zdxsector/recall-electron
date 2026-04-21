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
  noteId: T.EntityId;
  note: T.Note;
};

type DispatchProps = {
  toggleNoteList: () => any;
};

type Props = DispatchProps & StateProps;

export class NoteEditor extends Component<Props> {
  static displayName = 'NoteEditor';

  // Class property declarations for focus management
  private editorHasFocus?: () => boolean;
  private focusNoteEditor?: () => void;

  componentDidMount() {
    this.toggleShortcuts(true);
  }

  componentWillUnmount() {
    this.toggleShortcuts(false);
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

  render() {
    const { hasSearchQuery, hasSearchMatchesInNote, note, noteId } = this.props;

    if (!note) {
      return <div className="note-detail-placeholder" />;
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
  revision: state.ui.selectedRevision,
  hasSearchQuery: state.ui.searchQuery !== '',
  hasSearchMatchesInNote:
    !!state.ui.numberOfMatchesInNote && state.ui.numberOfMatchesInNote > 0,
  isSearchActive: !!state.ui.searchQuery.length,
  isSmallScreen: selectors.isSmallScreen(state),
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  toggleNoteList: actions.ui.toggleNoteList,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteEditor);
