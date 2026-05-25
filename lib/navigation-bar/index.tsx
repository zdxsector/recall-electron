import React, { Component } from 'react';
import { connect } from 'react-redux';

import IconButton from '../icon-button';
import NavigationBarItem from './item';
import NotebookSidebar from '../notebook-sidebar';
import NotesIcon from '../icons/notes';
import SidebarIcon from '../icons/sidebar';
import TrashIcon from '../icons/trash';
import { isMac } from '../utils/platform';
import actions from '../state/actions';
import * as selectors from '../state/selectors';

import * as S from '../state';
import * as T from '../types';

type StateProps = {
  collection: T.Collection;
  hasTrash: boolean;
  isDialogOpen: boolean;
  showNavigation: boolean;
};

type DispatchProps = {
  onFocusTrapDeactivate: () => any;
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
  isSelected = ({ selectedRow }: { selectedRow: 'all' | 'trash' }) => {
    return this.props.collection.type === selectedRow;
  };

  render() {
    const { hasTrash, isDialogOpen, onShowAllNotes } = this.props;

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
          {hasTrash && (
            <NavigationBarItem
              icon={<TrashIcon />}
              isSelected={this.isSelected({ selectedRow: 'trash' })}
              label="Trash"
              onClick={this.onSelectTrash}
            />
          )}
          <NotebookSidebar />
        </div>
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  collection: state.ui.collection,
  hasTrash: selectors.hasTrashedNotes(state),
  isDialogOpen: state.ui.dialogs.length > 0,
  showNavigation: state.ui.showNavigation,
});

const mapDispatchToProps: S.MapDispatchFunction<DispatchProps> = (
  dispatch
) => ({
  onFocusTrapDeactivate: () => dispatch(actions.ui.toggleNavigation()),
  onShowAllNotes: () => dispatch(actions.ui.showAllNotes()),
  selectTrash: () => dispatch(actions.ui.selectTrash()),
  toggleNavigation: () => dispatch(actions.ui.toggleNavigation()),
});

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);
