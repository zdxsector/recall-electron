import React, { Component } from 'react';
import { connect } from 'react-redux';

import NotePreview from '../components/note-preview';

import type * as S from '../state';
import type * as T from '../types';

type OwnProps = {
  noteId: T.EntityId;
  note?: T.Note;
};

type StateProps = {
  noteId: T.EntityId | null;
  note: T.Note | null;
};

type Props = OwnProps &
  StateProps &
  Pick<React.HTMLProps<HTMLDivElement>, 'aria-hidden'>;

export class NoteRevisions extends Component<Props> {
  static displayName = 'NoteRevisions';

  render() {
    const { note, noteId, 'aria-hidden': ariaHidden } = this.props;

    return (
      <div aria-hidden={ariaHidden} className="note-revisions">
        <NotePreview noteId={noteId} note={note} />
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps, OwnProps> = (state, props) => {
  const noteId = props.noteId ?? state.ui.openedNote;
  const note = props.note ?? state.data.notes.get(noteId);

  return {
    noteId,
    note,
  };
};

export default connect(mapStateToProps)(NoteRevisions);
