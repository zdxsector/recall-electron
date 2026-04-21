import React, { Component, Fragment, createRef } from 'react';
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
  ListRowRenderer,
} from 'react-virtualized';
import classNames from 'classnames';
import { connect } from 'react-redux';

import NoNotes from './no-notes';
import NoteCell from './note-cell';

import actions from '../state/actions';
import * as selectors from '../state/selectors';

import * as S from '../state';
import * as T from '../types';

type StateProps = {
  collection: T.Collection;
  collectionTitle: string;
  filteredNotes: T.EntityId[];
  isSmallScreen: boolean;
  keyboardShortcuts: boolean;
  noteDisplay: T.ListDisplayMode;
  openedNote: T.EntityId | null;
  searchQuery: string;
  showNoteList: boolean;
  showTrash: boolean;
  windowWidth: number;
};

type DispatchProps = {
  onEmptyTrash: () => any;
  openNote: () => any;
  selectNoteAbove: () => any;
  selectNoteBelow: () => any;
  toggleNoteList: () => any;
};

type Props = Readonly<StateProps & DispatchProps>;

type NoteListItem = T.EntityId | 'notes-header' | 'no-notes';

/**
 * Renders an individual row in the note list
 *
 * @see react-virtual/list
 *
 * @param notes list of filtered note ids
 * @returns does the actual rendering for the List
 */
const renderNote =
  (
    notes: NoteListItem[],
    { heightCache }: { heightCache: CellMeasurerCache }
  ): ListRowRenderer =>
  ({ index, key, parent, style }) => {
    const note = notes[index];

    if ('no-notes' === note) {
      return (
        <CellMeasurer
          cache={heightCache}
          columnIndex={0}
          key="no-notes"
          parent={parent}
          rowIndex={index}
        >
          <div className="note-list is-empty" style={{ ...style, height: 200 }}>
            <span className="note-list-placeholder">No Notes</span>
          </div>
        </CellMeasurer>
      );
    }

    if ('notes-header' === note) {
      return (
        <CellMeasurer
          cache={heightCache}
          columnIndex={0}
          key="notes-header"
          parent={parent}
          rowIndex={index}
        >
          <div className="note-list-header" style={{ ...style }}>
            Notes
          </div>
        </CellMeasurer>
      );
    }

    return (
      <CellMeasurer
        cache={heightCache}
        columnIndex={0}
        key={key}
        parent={parent}
        rowIndex={index}
      >
        <NoteCell
          invalidateHeight={() => heightCache.clear(index, 0)}
          noteId={note}
          style={style}
        />
      </CellMeasurer>
    );
  };

export class NoteList extends Component<Props> {
  static displayName = 'NoteList';

  state = {
    heightCache: new CellMeasurerCache({
      // row height base is 21px for the title + 18px vertical padding
      // max preview lines is 4 lines of 24px
      defaultHeight: 21 + 18 + 24 * 4,
      fixedWidth: true,
      keyMapper: (rowIndex) => {
        const { filteredNotes } = this.props;

        if (filteredNotes.length === 0) {
          return 'no-notes';
        }

        return filteredNotes[rowIndex];
      },
    }),
    lastNoteDisplay: null,
    windowWidth: null,
    lastFilteredNotes: null as T.EntityId[] | null,
    lastSearchQuery: null as string | null,
    shouldRecomputeHeights: false,
  };

  list = createRef<List>();

  static getDerivedStateFromProps = (props: Props, state) => {
    state.heightCache.clear(0);
    state.heightCache.clear(1);
    state.heightCache.clear(2);

    const filteredNotesChanged = props.filteredNotes !== state.lastFilteredNotes;
    const searchQueryChanged = props.searchQuery !== state.lastSearchQuery;

    if (
      props.noteDisplay !== state.lastNoteDisplay ||
      props.windowWidth !== state.windowWidth ||
      filteredNotesChanged ||
      searchQueryChanged
    ) {
      state.heightCache.clearAll();

      return {
        lastNoteDisplay: props.noteDisplay,
        windowWidth: props.windowWidth,
        lastFilteredNotes: props.filteredNotes,
        lastSearchQuery: props.searchQuery,
        shouldRecomputeHeights: true,
      };
    }

    return null;
  };

  componentDidMount() {
    this.toggleShortcuts(true);
  }

  componentWillUnmount() {
    this.toggleShortcuts(false);
  }

  componentDidUpdate() {
    if (this.state.shouldRecomputeHeights) {
      try {
        this.list.current?.recomputeRowHeights?.();
        this.list.current?.forceUpdateGrid?.();
      } catch {
        // ignore
      } finally {
        // eslint-disable-next-line react/no-did-update-set-state
        this.setState({ shouldRecomputeHeights: false });
      }
    }
  }

  handleShortcut = (event: KeyboardEvent) => {
    if (!this.props.keyboardShortcuts) {
      return;
    }
    const { ctrlKey, metaKey, shiftKey } = event;
    const key = event.key.toLowerCase();
    const { isSmallScreen, showNoteList } = this.props;

    const cmdOrCtrl = ctrlKey || metaKey;
    if (cmdOrCtrl && shiftKey && key === 'k') {
      this.props.selectNoteAbove();

      event.stopPropagation();
      event.preventDefault();
      return false;
    }

    if (cmdOrCtrl && shiftKey && key === 'j') {
      this.props.selectNoteBelow();

      event.stopPropagation();
      event.preventDefault();
      return false;
    }

    if (isSmallScreen && cmdOrCtrl && shiftKey && key === 'l') {
      this.props.toggleNoteList();

      event.stopPropagation();
      event.preventDefault();
      return false;
    }

    if (isSmallScreen && showNoteList && key === 'Enter') {
      this.props.openNote();

      event.stopPropagation();
      event.preventDefault();
      return false;
    }

    return true;
  };

  toggleShortcuts = (doEnable: boolean) => {
    if (doEnable) {
      window.addEventListener('keydown', this.handleShortcut, true);
    } else {
      window.removeEventListener('keydown', this.handleShortcut, true);
    }
  };

  render() {
    const {
      collection,
      collectionTitle,
      filteredNotes,
      noteDisplay,
      onEmptyTrash,
      openedNote,
      showTrash,
    } = this.props;
    const { heightCache } = this.state;

    const compositeNoteList: NoteListItem[] = filteredNotes.length > 0 ? filteredNotes : [];

    const selectedIndex = compositeNoteList.findIndex(
      (item) => item === openedNote
    );

    const renderNoteRow = renderNote(compositeNoteList, { heightCache });
    const isEmptyList = compositeNoteList.length === 0;

    const emptyTrashButton = (
      <div className="note-list-empty-trash">
        <button
          type="button"
          className="button button-borderless button-danger"
          onClick={onEmptyTrash}
        >
          Empty Trash
        </button>
      </div>
    );

    return (
      <div className={classNames('note-list', { 'is-empty': isEmptyList })}>
        {isEmptyList ? (
          <NoNotes></NoNotes>
        ) : (
          <Fragment>
            <div className={`note-list-items ${noteDisplay}`}>
              <AutoSizer>
                {({ height, width }) => (
                  <List
                    // Ideally aria-label is changed to aria-labelledby to
                    // reference the existing #notes-title element instead of
                    // computing the label, but is not currently possible due to
                    // a limitation with react-virtualized. https://git.io/JqLvR
                    aria-label={collectionTitle}
                    ref={this.list}
                    estimatedRowSize={24 + 18 + 21 * 4}
                    height={height}
                    noteDisplay={noteDisplay}
                    notes={compositeNoteList}
                    rowCount={compositeNoteList.length}
                    rowHeight={heightCache.rowHeight}
                    rowRenderer={renderNoteRow}
                    scrollToIndex={selectedIndex}
                    tabIndex={null}
                    width={width}
                  />
                )}
              </AutoSizer>
            </div>
            {showTrash && emptyTrashButton}
          </Fragment>
        )}
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = (state) => {
  return {
    collection: state.ui.collection,
    collectionTitle: selectors.collectionTitle(state),
    isSmallScreen: selectors.isSmallScreen(state),
    keyboardShortcuts: state.settings.keyboardShortcuts,
    noteDisplay: state.settings.noteDisplay,
    filteredNotes: state.ui.filteredNotes,
    openedNote: state.ui.openedNote,
    searchQuery: state.ui.searchQuery,
    showNoteList: state.ui.showNoteList,
    showTrash: selectors.showTrash(state),
    windowWidth: state.browser.windowWidth,
  };
};

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  onEmptyTrash: actions.ui.emptyTrash,
  openNote: actions.ui.openNote,
  selectNoteAbove: actions.ui.selectNoteAbove,
  selectNoteBelow: actions.ui.selectNoteBelow,
  toggleNoteList: actions.ui.toggleNoteList,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteList);
