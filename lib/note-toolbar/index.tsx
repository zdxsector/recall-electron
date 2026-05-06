import React, { Component } from 'react';
import { connect } from 'react-redux';
import { CmdOrCtrl } from '../utils/platform';

import BackIcon from '../icons/back';
import ChecklistIcon from '../icons/check-list';
import EllipsisOutlineIcon from '../icons/ellipsis-outline';
import IconButton from '../icon-button';
import InfoIcon from '../icons/info';
import NewNoteIcon from '../icons/new-note';
import TrashIcon from '../icons/trash';
import actions from '../state/actions';

import * as S from '../state';
import * as T from '../types';

type StateProps = {
  isOffline: boolean;
  note: T.Note | null;
  searchQuery: string;
};

type DispatchProps = {
  deleteNoteForever: () => any;
  newNote: (content: string) => any;
  restoreNote: () => any;
  trashNote: () => any;
  toggleNoteActions: () => any;
  toggleNoteInfo: () => any;
  toggleNoteList: () => any;
};

type Props = DispatchProps & StateProps & React.HTMLProps<HTMLDivElement>;

export class NoteToolbar extends Component<Props> {
  static displayName = 'NoteToolbar';

  render() {
    const { 'aria-hidden': ariaHidden, note } = this.props;
    return (
      <div aria-hidden={ariaHidden} className="note-toolbar-wrapper">
        {note?.deleted ? this.renderTrashed() : this.renderNormal()}
      </div>
    );
  }

  renderNormal = () => {
    const {
      newNote,
      isOffline,
      note,
      searchQuery,
      toggleNoteActions,
      toggleNoteInfo,
    } = this.props;

    return (
      <div aria-label="note actions" role="toolbar" className="note-toolbar">
        <div className="note-toolbar__column-left">
          <div className="note-toolbar__button menu-bar__new-note">
            <IconButton
              icon={<NewNoteIcon />}
              onClick={() => newNote(searchQuery)}
              title={`New Note • ${CmdOrCtrl}+Shift+I`}
            />
          </div>
          <div className="note-toolbar__button note-toolbar-back">
            <IconButton
              icon={<BackIcon />}
              onClick={this.props.toggleNoteList}
              title={`Back • ${CmdOrCtrl}+Shift+L`}
            />
          </div>
        </div>
        {isOffline && <div className="offline-badge">OFFLINE</div>}
        {note && (
          <div className="note-toolbar__column-right">
            <div className="note-toolbar__button">
              <IconButton
                icon={<TrashIcon />}
                onClick={this.props.trashNote}
                title="Delete note"
              />
            </div>
            {/* <div className="note-toolbar__button">
            <IconButton
              icon={<ChecklistIcon />}
              onClick={() => window.dispatchEvent(new Event('toggleChecklist'))}
              title={`Insert Checklist • ${CmdOrCtrl}+Shift+C`}
            />
          </div> */}
            <div className="note-toolbar__button">
              <IconButton
                icon={<InfoIcon />}
                onClick={toggleNoteInfo}
                title="Info"
              />
            </div>
            <div className="note-toolbar__button">
              <IconButton
                icon={<EllipsisOutlineIcon />}
                onClick={toggleNoteActions}
                title="Actions"
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  renderTrashed = () => {
    const { isOffline } = this.props;

    return (
      <div className="note-toolbar-trashed">
        <div className="note-toolbar__column-left">
          <IconButton
            icon={<BackIcon />}
            onClick={this.props.toggleNoteList}
            title={`Back • ${CmdOrCtrl}+Shift+L`}
          />
        </div>
        {isOffline && <div className="offline-badge">OFFLINE</div>}
        <div className="note-toolbar__column-right">
          <div className="note-toolbar__button">
            <button
              type="button"
              className="button button-compact button-danger"
              onClick={this.props.deleteNoteForever}
            >
              Delete Forever
            </button>
          </div>
          <div className="note-toolbar__button">
            <button
              type="button"
              className="button button-primary button-compact"
              onClick={this.props.restoreNote}
            >
              Restore Note
            </button>
          </div>
        </div>
      </div>
    );
  };
}

const mapStateToProps: S.MapState<StateProps> = ({
  data,
  ui: { openedNote, searchQuery },
  simperium: { connectionStatus },
}) => {
  const note = openedNote ? (data.notes.get(openedNote) ?? null) : null;

  return {
    isOffline: connectionStatus === 'offline',
    note,
    searchQuery,
  };
};

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  deleteNoteForever: actions.ui.deleteOpenNoteForever,
  newNote: (content: string) =>
    actions.ui.createNote({ content: content ? `# ${content}` : '# ' }),
  restoreNote: actions.ui.restoreOpenNote,
  trashNote: actions.ui.trashOpenNote,
  toggleNoteActions: actions.ui.toggleNoteActions,
  toggleNoteInfo: actions.ui.toggleNoteInfo,
  toggleNoteList: actions.ui.toggleNoteList,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteToolbar);
