/**
 * External dependencies
 */
import React, { FunctionComponent } from 'react';
import { connect } from 'react-redux';

/**
 * Internal dependencies
 */
import { CmdOrCtrl } from '../utils/platform';
import IconButton from '../icon-button';
import { isMac } from '../utils/platform';
import NewNoteIcon from '../icons/new-note';
import MenuIcon from '../icons/menu';
import { withoutTags } from '../utils/filter-notes';
import { createNote, toggleNavigation } from '../state/ui/actions';
import * as selectors from '../state/selectors';

import * as S from '../state';
import type * as T from '../types';

type OwnProps = {
  onNewNote: Function;
  noteBucket: object;
  onNoteOpened: Function;
};

type StateProps = {
  collectionTitle: string;
  searchQuery: string;
};

type DispatchProps = {
  onNewNote: (content: string) => any;
  toggleNavigation: () => any;
};

type Props = OwnProps & StateProps & DispatchProps;

export const MenuBar: FunctionComponent<Props> = ({
  collectionTitle,
  onNewNote,
  searchQuery,
  toggleNavigation,
}) => {
  // On Windows Electron we use a custom title bar that already includes
  // the navigation toggle + collection title.
  const isWindowsElectron =
    /Electron/i.test(navigator.userAgent) && /Win/i.test(navigator.appVersion);
  if (isWindowsElectron) {
    return null;
  }

  const CmdOrCtrl = isMac ? 'Cmd' : 'Ctrl';

  return (
    <div className="menu-bar">
      <IconButton
        icon={<MenuIcon />}
        onClick={toggleNavigation}
        title={`Menu • ${CmdOrCtrl}+Shift+U`}
      />
      <div id="notes-title" className="notes-title" aria-hidden="true">
        {collectionTitle}
      </div>
      <IconButton
        icon={<NewNoteIcon />}
        onClick={() => onNewNote(withoutTags(searchQuery))}
        title={`New Note • ${CmdOrCtrl}+Shift+I`}
      />
    </div>
  );
};

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  collectionTitle: selectors.collectionTitle(state),
  searchQuery: state.ui.searchQuery,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps, OwnProps> = (
  dispatch
) => ({
  onNewNote: (content: string) => {
    dispatch(createNote(content));
  },
  toggleNavigation: () => {
    dispatch(toggleNavigation());
  },
});

MenuBar.displayName = 'MenuBar';

export default connect(mapStateToProps, mapDispatchToProps)(MenuBar);
