import React, { Component } from 'react';
import { connect } from 'react-redux';

import IconButton from '../icon-button';
import NavigationBarItem from './item';
import NotebookSidebar from '../notebook-sidebar';
import NotesIcon from '../icons/notes';
import SidebarIcon from '../icons/sidebar';
import TrashIcon from '../icons/trash';
import SettingsIcon from '../icons/settings';
import { isMac } from '../utils/platform';
import actions from '../state/actions';

import * as S from '../state';
import * as T from '../types';

type StateProps = {
  autoHideMenuBar: boolean;
  collection: T.Collection;
  isDialogOpen: boolean;
  showNavigation: boolean;
};

type DispatchProps = {
  onFocusTrapDeactivate: () => any;
  onSettings: () => any;
  onShowAllNotes: () => any;
  selectTrash: () => any;
  toggleNavigation: () => any;
};

type Props = StateProps & DispatchProps;

export class NavigationBar extends Component<Props> {
  static displayName = 'NavigationBar';
  private _isMounted = false;

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  handleFocusTrapDeactivate = () => {
    const { onFocusTrapDeactivate, showNavigation } = this.props;

    // isMounted prevents reopening sidebar after navigation event
    if (showNavigation && this._isMounted) {
      onFocusTrapDeactivate();
    }
  };

  onSelectTrash = () => {
    this.props.selectTrash();
  };

  // Determine if the selected class should be applied for the 'all notes' or 'trash' rows
  isSelected = ({
    selectedRow,
  }: {
    selectedRow: 'all' | 'trash';
  }) => {
    return this.props.collection.type === selectedRow;
  };

  render() {
    const {
      isDialogOpen,
      onSettings,
      onShowAllNotes,
    } = this.props;

    const CmdOrCtrl = isMac ? 'Cmd' : 'Ctrl';

    return (
      <div className="navigation-bar" aria-hidden={isDialogOpen}>
        <div className="navigation-bar__header">
          <div className="navigation-bar__header-actions">
            <IconButton
              icon={<SidebarIcon />}
              onClick={this.props.toggleNavigation}
              title={`Toggle Sidebar • ${CmdOrCtrl}+Shift+U`}
            />
          </div>
        </div>
        <div className="navigation-bar__folders">
          <NavigationBarItem
            icon={<NotesIcon />}
            isSelected={this.isSelected({ selectedRow: 'all' })}
            label="All Notes"
            onClick={onShowAllNotes}
          />
          <NavigationBarItem
            icon={<TrashIcon />}
            isSelected={this.isSelected({ selectedRow: 'trash' })}
            label="Trash"
            onClick={this.onSelectTrash}
          />
          <NavigationBarItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={onSettings}
          />
          <NotebookSidebar />
        </div>
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = ({
  data,
  settings,
  ui: { collection, dialogs, showNavigation },
}) => ({
  autoHideMenuBar: settings.autoHideMenuBar,
  collection,
  isDialogOpen: dialogs.length > 0,
  showNavigation,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  onFocusTrapDeactivate: actions.ui.toggleNavigation,
  onShowAllNotes: actions.ui.showAllNotes,
  onSettings: () => actions.ui.showDialog('SETTINGS'),
  selectTrash: actions.ui.selectTrash,
  toggleNavigation: actions.ui.toggleNavigation,
};

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);
