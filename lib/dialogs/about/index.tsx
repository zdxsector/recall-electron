import React, { Component } from 'react';
import { connect } from 'react-redux';
import RecallLogo from '../../icons/recall';
import CrossIcon from '../../icons/cross';
import TopRightArrowIcon from '../../icons/arrow-top-right';
import Dialog from '../../dialog';

const appVersion = config.version;

type OwnProps = {
  closeDialog: () => void;
};

type Props = OwnProps;

export class AboutDialog extends Component<Props> {
  render() {
    const { closeDialog } = this.props;
    const thisYear = new Date().getFullYear();

    return (
      <div className="about">
        <Dialog hideTitleBar onDone={closeDialog} title="About">
          <div className="about-top">
            <RecallLogo />

            <h1>Recall</h1>
            <small>Version {appVersion}</small>
          </div>

          <ul className="about-links">
            {/* <li>
              <a
                target="_blank"
                href="https://recall.com/blog/"
                rel="noopener noreferrer"
              >
                <span className="about-links-title">Blog</span>
                <br />
                recall.com/blog/
              </a>
              <TopRightArrowIcon />
            </li>
            <li>
              <a
                target="_blank"
                href="https://twitter.com/recallapp"
                rel="noopener noreferrer"
              >
                <span className="about-links-title">Twitter</span>
                <br />
                @recallapp
              </a>
              <TopRightArrowIcon />
            </li> */}
            <li>
              <a
                target="_blank"
                href="https://github.com/zdxsector/recall-electron"
                rel="noopener noreferrer"
              >
                <span className="about-links-title">Contribute</span>
                <br />
                GitHub.com
              </a>
              <TopRightArrowIcon />
            </li>
            {/* <li>
              <a
                target="_blank"
                href="https://automattic.com/work-with-us/"
                rel="noopener noreferrer"
              >
                Made with love by the folks at Automattic.
                <br />
                Are you a developer? We&rsquo;re hiring.
              </a>
              <TopRightArrowIcon />
            </li> */}
          </ul>

          <div className="about-bottom">
            <p>
              I made this to be fully offline for you. You
              do not need to be worry about the developer
              because he is alright. If you have heart to 
              support the developer email me at 
              sponsor@slybacalso.me
            </p>
          </div>

          <button
            type="button"
            aria-label="Close dialog"
            className="about-done button"
            onClick={closeDialog}
          >
            <CrossIcon />
          </button>
        </Dialog>
      </div>
    );
  }
}

export default AboutDialog;
