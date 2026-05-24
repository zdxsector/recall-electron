import React, { Component, createRef } from 'react';
import { connect } from 'react-redux';
import { CmdOrCtrl } from '../utils/platform';

import BackIcon from '../icons/back';
import ChecklistIcon from '../icons/check-list';
import EllipsisOutlineIcon from '../icons/ellipsis-outline';
import IconButton from '../icon-button';
import NewNoteIcon from '../icons/new-note';
import PaperclipIcon from '../icons/paperclip';
import ShareIcon from '../icons/share';
import TableIcon from '../icons/table';
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
  showShareDialog: () => any;
  toggleNoteActions: () => any;
  toggleNoteList: () => any;
};

type Props = DispatchProps & StateProps & React.HTMLProps<HTMLDivElement>;

type LocalState = {
  showFormatMenu: boolean;
};

const blockFormatItems = [
  { label: 'Title', command: 'atx-heading 1', className: 'is-title' },
  { label: 'Heading', command: 'atx-heading 2', className: 'is-heading' },
  {
    label: 'Subheading',
    command: 'atx-heading 3',
    className: 'is-subheading',
  },
  { label: 'Body', command: 'paragraph', className: 'is-body' },
  { label: 'Code', command: 'code-block', className: 'is-code' },
];

const inlineFormatItems = [
  { label: 'B', command: 'bold', title: 'Bold', className: 'is-bold' },
  { label: 'I', command: 'italic', title: 'Italic', className: 'is-italic' },
  {
    label: 'U',
    command: 'underline',
    title: 'Underline',
    className: 'is-underline',
  },
  {
    label: 'S',
    command: 'strikeThrough',
    title: 'Strikethrough',
    className: 'is-strikethrough',
  },
];

export class NoteToolbar extends Component<Props, LocalState> {
  static displayName = 'NoteToolbar';

  formatMenuRef = createRef<HTMLDivElement>();
  state: LocalState = { showFormatMenu: false };

  componentDidMount() {
    document.addEventListener('mousedown', this.handleDocumentMouseDown, true);
    window.addEventListener('keydown', this.handleFormatMenuKeyDown, true);
  }

  componentWillUnmount() {
    document.removeEventListener(
      'mousedown',
      this.handleDocumentMouseDown,
      true
    );
    window.removeEventListener('keydown', this.handleFormatMenuKeyDown, true);
  }

  handleDocumentMouseDown = (event: MouseEvent) => {
    if (!this.state.showFormatMenu) return;
    const target = event.target as Node | null;
    if (target && this.formatMenuRef.current?.contains(target)) return;
    this.closeFormatMenu();
  };

  handleFormatMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.closeFormatMenu();
    }
  };

  toggleFormatMenu = () => {
    this.setState(({ showFormatMenu }) => ({
      showFormatMenu: !showFormatMenu,
    }));
  };

  closeFormatMenu = () => {
    if (this.state.showFormatMenu) {
      this.setState({ showFormatMenu: false });
    }
  };

  applyBlockFormat = (label: string) => {
    window.dispatchEvent(
      new CustomEvent('applyNoteFormat', { detail: { label } })
    );
    this.closeFormatMenu();
  };

  applyInlineFormat = (command: string) => {
    window.dispatchEvent(
      new CustomEvent('applyInlineFormat', { detail: { command } })
    );
    this.closeFormatMenu();
  };

  render() {
    const { 'aria-hidden': ariaHidden, note } = this.props;
    return (
      <div aria-hidden={ariaHidden} className="note-toolbar-wrapper">
        {note?.deleted ? this.renderTrashed() : this.renderNormal()}
      </div>
    );
  }

  renderFormatMenu = () => (
    <div
      aria-label="Text format"
      className="note-toolbar__format-menu"
      role="menu"
    >
      {blockFormatItems.map((item) => (
        <button
          className={`note-toolbar__format-menu-item ${item.className}`}
          key={item.command}
          onClick={() => this.applyBlockFormat(item.command)}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
      <div className="note-toolbar__format-menu-separator" />
      <div
        aria-label="Inline format"
        className="note-toolbar__format-inline-row"
        role="group"
      >
        {inlineFormatItems.map((item) => (
          <button
            aria-label={item.title}
            className={`note-toolbar__format-inline-button ${item.className}`}
            key={item.command}
            onClick={() => this.applyInlineFormat(item.command)}
            title={item.title}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  renderNormal = () => {
    const {
      newNote,
      isOffline,
      note,
      searchQuery,
      showShareDialog,
      toggleNoteActions,
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
            <div className="note-toolbar__mac-group">
              <div
                className="note-toolbar__format-menu-wrap"
                ref={this.formatMenuRef}
              >
                <button
                  aria-expanded={this.state.showFormatMenu}
                  aria-haspopup="menu"
                  aria-label="Text format"
                  className="note-toolbar__text-button"
                  onClick={this.toggleFormatMenu}
                  title="Text Format"
                  type="button"
                >
                  Aa
                </button>
                {this.state.showFormatMenu && this.renderFormatMenu()}
              </div>
              <div className="note-toolbar__button">
                <IconButton
                  icon={<ChecklistIcon />}
                  onClick={() =>
                    window.dispatchEvent(new Event('toggleChecklist'))
                  }
                  title={`Insert Checklist • ${CmdOrCtrl}+Shift+C`}
                />
              </div>
              <div className="note-toolbar__button">
                <IconButton
                  icon={<TableIcon />}
                  onClick={() => window.dispatchEvent(new Event('insertTable'))}
                  title="Insert Table"
                />
              </div>
              <div className="note-toolbar__button">
                <IconButton
                  icon={<PaperclipIcon />}
                  onClick={() =>
                    window.dispatchEvent(new Event('insertAttachment'))
                  }
                  title="Attach Image"
                />
              </div>
            </div>
            <div className="note-toolbar__mac-group">
              <div className="note-toolbar__button">
                <IconButton
                  icon={<ShareIcon />}
                  onClick={showShareDialog}
                  title="Share"
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
  showShareDialog: () => actions.ui.showDialog('SHARE'),
  toggleNoteActions: actions.ui.toggleNoteActions,
  toggleNoteList: actions.ui.toggleNoteList,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteToolbar);
