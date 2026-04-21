/**
 * External dependencies
 */
import React, { FunctionComponent } from 'react';
import { connect } from 'react-redux';

/**
 * Internal dependencies
 */
import IconButton from '../icon-button';
import { isMac } from '../utils/platform';
import SidebarIcon from '../icons/sidebar';
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
  isNavigationOpen: boolean;
};

type DispatchProps = {
  toggleNavigation: () => any;
};

type Props = OwnProps & StateProps & DispatchProps;

export const MenuBar: FunctionComponent<Props> = ({
  collectionTitle,
  isNavigationOpen,
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
    <div className={`menu-bar${isNavigationOpen ? ' menu-bar--nav-open' : ''}`}>
      <div className="menu-bar__drag-region">
        <div className="menu-bar__left">
          <div className="menu-bar__sidebar-toggle">
            <IconButton
              icon={<SidebarIcon />}
              onClick={toggleNavigation}
              title={`Toggle Sidebar • ${CmdOrCtrl}+Shift+U`}
            />
          </div>
          <div className="menu-bar__title-area" aria-hidden="true">
            <div id="notes-title" className="menu-bar__title">
              {collectionTitle}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  collectionTitle: selectors.collectionTitle(state),
  isNavigationOpen: state.ui.showNavigation,
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
