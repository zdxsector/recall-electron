import React, { Component, createRef } from 'react';
import { connect } from 'react-redux';

import MuyaEditor, { MuyaEditorHandle } from './components/muya-editor';
import actions from './state/actions';
import * as selectors from './state/selectors';

import * as S from './state';
import * as T from './types';

type OwnProps = {
  storeFocusEditor: (focusSetter: () => any) => any;
  storeHasFocus: (focusGetter: () => boolean) => any;
};

type StateProps = {
  folders: Map<T.FolderId, T.Folder>;
  notebooks: Map<T.NotebookId, T.Notebook>;
  isFocusMode: boolean;
  keyboardShortcuts: boolean;
  lineLength: T.LineLength;
  noteId: T.EntityId;
  note: T.Note;
  notes: Map<T.EntityId, T.Note>;
  searchQuery: string;
  selectedSearchMatchIndex: number | null;
  spellCheckEnabled: boolean;
  theme: T.Theme;
};

type DispatchProps = {
  clearSearch: () => any;
  editNote: (noteId: T.EntityId, changes: Partial<T.Note>) => any;
  insertTask: () => any;
  openNote: (noteId: T.EntityId) => any;
  storeNumberOfMatchesInNote: (matches: number) => any;
  storeSearchSelection: (index: number | null) => any;
};

type Props = OwnProps & StateProps & DispatchProps;

class NoteContentEditor extends Component<Props> {
  muyaRef = createRef<MuyaEditorHandle>();
  matchCountTimer: ReturnType<typeof setTimeout> | null = null;
  matchCountIdleHandle: number | null = null;
  matchCountSeq = 0;

  componentDidMount() {
    this.props.storeFocusEditor(this.focusEditor);
    this.props.storeHasFocus(this.hasFocus);
    window.addEventListener('toggleChecklist', this.handleChecklist, true);
    this.updateMatchesCount();
    // Auto-focus editor when note opens - use delay for reliable focus in Electron
    this.focusEditorDelayed();
  }

  // Focus editor with delay to ensure DOM and window are ready (Electron focus quirk)
  focusEditorDelayed = () => {
    setTimeout(() => {
      this.focusEditor();
    }, 100);
  };

  componentWillUnmount() {
    window.removeEventListener('toggleChecklist', this.handleChecklist, true);
    if (this.matchCountTimer) {
      clearTimeout(this.matchCountTimer);
      this.matchCountTimer = null;
    }
    if (this.matchCountIdleHandle != null) {
      try {
        (window as any).cancelIdleCallback?.(this.matchCountIdleHandle);
      } catch {
        // ignore
      }
      try {
        clearTimeout(this.matchCountIdleHandle as any);
      } catch {
        // ignore
      }
      this.matchCountIdleHandle = null;
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (
      prevProps.searchQuery !== this.props.searchQuery ||
      prevProps.note?.content !== this.props.note?.content
    ) {
      // Avoid doing O(n) work (lowercasing/scanning) on every keystroke for huge notes.
      this.updateMatchesCount();
      // reset search selection when either the note or the search changes
      if (prevProps.searchQuery !== this.props.searchQuery) {
        this.props.storeSearchSelection(null);
      }
    }
  }

  handleChecklist = (event: Event) => {
    // Insert a task list item at the current cursor position in Muya.
    // Fallback: append to the end of the note if the editor isn't mounted yet.
    const { noteId, note } = this.props;
    if (!noteId || !note) {
      return;
    }

    const insertChecklist = this.muyaRef.current?.insertChecklist;
    if (typeof insertChecklist === 'function') {
      insertChecklist();
      this.props.insertTask();
      return;
    }

    const current = note.content ?? '';
    const insertViaEditor = this.muyaRef.current?.insertText;
    if (typeof insertViaEditor === 'function') {
      insertViaEditor('- [ ] ');
      this.props.insertTask();
      return;
    }

    const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    this.props.editNote(noteId, { content: `${current}${prefix}- [ ] ` });
    this.props.insertTask();
    this.focusEditor();
  };

  focusEditor = () => this.muyaRef.current?.focus();

  hasFocus = () => this.muyaRef.current?.hasFocus() || false;

  onChange = (nextValue: string) => {
    const { noteId } = this.props;
    if (!noteId) {
      return;
    }
    this.props.editNote(noteId, { content: nextValue });
  };

  updateMatchesCount = () => {
    const q = (this.props.searchQuery ?? '').trim();
    if (!q) {
      this.props.storeNumberOfMatchesInNote(0);
      return;
    }
    const content = this.props.note?.content ?? '';
    const len = String(content).length;
    const isLarge = len >= 200_000;
    const delayMs = isLarge ? 350 : 80;
    const seq = ++this.matchCountSeq;

    if (this.matchCountTimer) {
      clearTimeout(this.matchCountTimer);
    }

    this.matchCountTimer = setTimeout(() => {
      const compute = () => {
        // If a newer request came in, drop this one.
        if (seq !== this.matchCountSeq) return;
        const currentQ = (this.props.searchQuery ?? '').trim();
        if (!currentQ) {
          this.props.storeNumberOfMatchesInNote(0);
          return;
        }
        const currentContent = this.props.note?.content ?? '';
        const haystack = String(currentContent).toLowerCase();
        const needle = currentQ.toLowerCase();
        let count = 0;
        let idx = 0;
        while (true) {
          const nextIdx = haystack.indexOf(needle, idx);
          if (nextIdx === -1) break;
          count++;
          idx = nextIdx + needle.length;
        }
        // Still current?
        if (seq !== this.matchCountSeq) return;
        this.props.storeNumberOfMatchesInNote(count);
      };

      if (isLarge && typeof (window as any).requestIdleCallback === 'function') {
        try {
          this.matchCountIdleHandle = (window as any).requestIdleCallback(
            () => {
              this.matchCountIdleHandle = null;
              compute();
            },
            { timeout: 1500 }
          );
          return;
        } catch {
          // fall back to setTimeout
        }
      }
      // Fallback: async but not idle.
      this.matchCountIdleHandle = window.setTimeout(() => {
        this.matchCountIdleHandle = null;
        compute();
      }, 0) as unknown as number;
    }, delayMs);
  };

  // Handle click on editor shell - ensures focus even when Electron loses track
  handleShellClick = () => {
    // Only focus if not already focused to avoid disrupting selection
    if (!this.hasFocus()) {
      this.focusEditor();
    }
  };

  render() {
    return (
      <div
        className="note-content-editor-shell"
        onClick={this.handleShellClick}
      >
        <MuyaEditor
          ref={this.muyaRef}
          noteId={this.props.noteId as unknown as string}
          value={this.props.note?.content ?? ''}
          note={this.props.note}
          folders={Array.from(this.props.folders)}
          notebooks={Array.from(this.props.notebooks)}
          onChange={this.onChange}
        />
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  folders: state.data.folders,
  notebooks: state.data.notebooks,
  isFocusMode: state.settings.focusModeEnabled,
  keyboardShortcuts: state.settings.keyboardShortcuts,
  lineLength: state.settings.lineLength,
  noteId: state.ui.openedNote as T.EntityId,
  note: state.data.notes.get(state.ui.openedNote as T.EntityId) as T.Note,
  notes: state.data.notes,
  searchQuery: state.ui.searchQuery,
  selectedSearchMatchIndex: state.ui.selectedSearchMatchIndex,
  spellCheckEnabled: state.settings.spellCheckEnabled,
  theme: selectors.getTheme(state),
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  clearSearch: () => actions.ui.search(''),
  editNote: actions.data.editNote,
  insertTask: () => ({ type: 'INSERT_TASK' }),
  openNote: actions.ui.selectNote,
  storeNumberOfMatchesInNote: (matches) => ({
    type: 'STORE_NUMBER_OF_MATCHES_IN_NOTE',
    matches,
  }),
  storeSearchSelection: (index) => ({
    type: 'STORE_SEARCH_SELECTION',
    index,
  }),
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteContentEditor);
