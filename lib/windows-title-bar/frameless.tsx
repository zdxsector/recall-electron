import React, { Component } from 'react';

type Props = {
  title?: string;
};

export default class FramelessTitleBar extends Component<Props> {
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
    const isElectronRuntime = this.isElectronRuntime();
    const isWindows = /Win/i.test(navigator.appVersion);
    if (!isElectronRuntime || !isWindows) return null;

    const title = this.props.title ?? 'Recall';

    return (
      <div className="windows-title-bar">
        <div className="windows-title-bar__drag-region" onDoubleClick={this.onDoubleClick}>
          <div className="windows-title-bar__center">
            <span className="windows-title-bar__app-name">{title}</span>
          </div>
        </div>
        {/* Native window controls (minimize/maximize/close) are provided by titleBarOverlay */}
      </div>
    );
  }
}

