import React, { Component } from 'react';
import { connect } from 'react-redux';
import IconButton from '../icon-button';
import MenuIcon from '../icons/menu';
import NewNoteIcon from '../icons/new-note';
import { withoutTags } from '../utils/filter-notes';
import { createNote, toggleNavigation } from '../state/ui/actions';
import * as selectors from '../state/selectors';
import * as S from '../state';
import type * as T from '../types';

type StateProps = {
  collection: T.Collection;
  openedTag: T.TagName | null;
  searchQuery: string;
};

type DispatchProps = {
  onNewNote: (content: string) => any;
  toggleNavigation: () => any;
};

type Props = StateProps & DispatchProps;

export class WindowsTitleBar extends Component<Props> {
  render() {
    const {
      collection,
      openedTag,
      onNewNote,
      searchQuery,
      toggleNavigation,
    } = this.props;

    // Check electron availability
    const hasElectron = !!window?.electron;
    const isWindows = !!window?.electron?.isWindows;

    // Only render on Windows Electron (where we have a frameless window)
    if (!hasElectron || !isWindows) {
      return null;
    }

    let placeholder;
    switch (collection.type) {
      case 'tag':
        placeholder = openedTag;
        break;
      case 'trash':
        placeholder = 'Trash';
        break;
      case 'untagged':
        placeholder = 'Untagged Notes';
        break;
      default:
        placeholder = 'All Notes';
        break;
    }

    // Using titleBarOverlay, native window controls are visible
    // We just add our custom content (menu toggle, title, new note button)
    return (
      <div className="windows-title-bar">
        <div className="windows-title-bar__drag-region">
          <div className="windows-title-bar__left">
            <IconButton
              icon={<MenuIcon />}
              onClick={toggleNavigation}
              title="Menu • Ctrl+Shift+U"
            />
            <span className="windows-title-bar__title">{placeholder}</span>
          </div>
          <div className="windows-title-bar__center">
            <span className="windows-title-bar__app-name">Recall</span>
          </div>
        </div>
        <div className="windows-title-bar__right">
          <IconButton
            icon={<NewNoteIcon />}
            onClick={() => onNewNote(withoutTags(searchQuery))}
            title="New Note • Ctrl+Shift+I"
          />
        </div>
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  collection: state.ui.collection,
  openedTag: selectors.openedTag(state),
  searchQuery: state.ui.searchQuery,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = (dispatch) => ({
  onNewNote: (content: string) => {
    dispatch(createNote(content));
  },
  toggleNavigation: () => {
    dispatch(toggleNavigation());
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(WindowsTitleBar);
