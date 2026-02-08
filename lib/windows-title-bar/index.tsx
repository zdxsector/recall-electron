import React, { Component } from 'react';
import { connect } from 'react-redux';
import IconButton from '../icon-button';
import MenuIcon from '../icons/menu';
import { toggleNavigation } from '../state/ui/actions';
import * as selectors from '../state/selectors';
import * as S from '../state';
import type * as T from '../types';

type StateProps = {
  collectionTitle: string;
};

type DispatchProps = {
  toggleNavigation: () => any;
};

type Props = StateProps & DispatchProps;

export class WindowsTitleBar extends Component<Props> {
  private isElectronRuntime = () => {
    try {
      return /Electron/i.test(navigator.userAgent);
    } catch {
      return false;
    }
  };

  onDoubleClick = () => {
    try {
      window.electron.windowMaximize();
    } catch {
      // ignore
    }
  };

  render() {
    const {
      collectionTitle,
      toggleNavigation,
    } = this.props;

    // We render based on runtime (UA) so the title bar still shows even if preload fails.
    const isElectronRuntime = this.isElectronRuntime();
    const isWindows = /Win/i.test(navigator.appVersion);

    // Only render on Windows Electron (where we have a custom title bar)
    if (!isElectronRuntime || !isWindows) {
      return null;
    }

    return (
      <div className="windows-title-bar">
        <div
          className="windows-title-bar__drag-region"
          onDoubleClick={this.onDoubleClick}
        >
          <div className="windows-title-bar__left">
            <IconButton
              icon={<MenuIcon />}
              onClick={toggleNavigation}
              title="Menu • Ctrl+Shift+U"
            />
            <span className="windows-title-bar__title">{collectionTitle}</span>
          </div>
          <div className="windows-title-bar__center">
            <span className="windows-title-bar__app-name">Recall</span>
          </div>
        </div>
        <div className="windows-title-bar__right">
          <span aria-hidden="true" />
        </div>
        {/* Native window controls (minimize/maximize/close) are provided by titleBarOverlay */}
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  collectionTitle: selectors.collectionTitle(state),
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = (dispatch) => ({
  toggleNavigation: () => {
    dispatch(toggleNavigation());
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(WindowsTitleBar);
