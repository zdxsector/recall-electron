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
import MenuIcon from '../icons/menu';
import { toggleNavigation } from '../state/ui/actions';
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
};

type DispatchProps = {
  toggleNavigation: () => any;
};

type Props = OwnProps & StateProps & DispatchProps;

export const MenuBar: FunctionComponent<Props> = ({
  collectionTitle,
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
      <span aria-hidden="true" />
    </div>
  );
};

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  collectionTitle: selectors.collectionTitle(state),
});

const mapDispatchToProps: S.MapDispatch<DispatchProps, OwnProps> = (
  dispatch
) => ({
  toggleNavigation: () => {
    dispatch(toggleNavigation());
  },
});

MenuBar.displayName = 'MenuBar';

export default connect(mapStateToProps, mapDispatchToProps)(MenuBar);
