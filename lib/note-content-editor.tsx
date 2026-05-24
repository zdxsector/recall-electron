import React, { Component, createRef } from 'react';
import { connect } from 'react-redux';

import FindBar from './components/find-bar';
import MuyaEditor, { MuyaEditorHandle } from './components/muya-editor';
import actions from './state/actions';
import * as selectors from './state/selectors';
import {
  createLockedNotePlaceholder,
  getLockedNoteTitleFromContent,
  isNoteLocked,
} from './utils/locked-note';

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
  unlockedContent: string | null;
};

type DispatchProps = {
  clearSearch: () => any;
  editNote: (noteId: T.EntityId, changes: Partial<T.Note>) => any;
  insertTask: () => any;
  openNote: (noteId: T.EntityId) => any;
  storeNumberOfMatchesInNote: (matches: number) => any;
  storeSearchSelection: (index: number | null) => any;
  storeUnlockedNoteContent: (noteId: T.EntityId, content: string) => any;
};

type Props = OwnProps & StateProps & DispatchProps;

type LocalState = {
  showFindBar: boolean;
};

class NoteContentEditor extends Component<Props, LocalState> {
  muyaRef = createRef<MuyaEditorHandle>();
  matchCountTimer: ReturnType<typeof setTimeout> | null = null;
  matchCountIdleHandle: number | null = null;
  matchCountSeq = 0;
  lockedSaveSeq = 0;
  state: LocalState = { showFindBar: false };

  componentDidMount() {
    this.props.storeFocusEditor(this.focusEditor);
    this.props.storeHasFocus(this.hasFocus);
    window.addEventListener('toggleChecklist', this.handleChecklist, true);
    window.addEventListener('toggleBold', this.handleToggleBold, true);
    window.addEventListener(
      'applyNoteFormat',
      this.handleApplyNoteFormat,
      true
    );
    window.addEventListener(
      'applyInlineFormat',
      this.handleApplyInlineFormat,
      true
    );
    window.addEventListener('insertTable', this.handleInsertTable, true);
    window.addEventListener(
      'insertAttachment',
      this.handleInsertAttachment,
      true
    );
    window.addEventListener('keydown', this.handleFindShortcut, true);
    this.updateMatchesCount();
    this.focusEditorDelayed();
  }

  // Focus editor with delay to ensure DOM and window are ready (Electron focus quirk)
  focusEditorDelayed = () => {
    setTimeout(() => {
      this.focusEditor();
    }, 100);
  };

  componentWillUnmount() {
    this.lockedSaveSeq += 1;
    window.removeEventListener('toggleChecklist', this.handleChecklist, true);
    window.removeEventListener('toggleBold', this.handleToggleBold, true);
    window.removeEventListener(
      'applyNoteFormat',
      this.handleApplyNoteFormat,
      true
    );
    window.removeEventListener(
      'applyInlineFormat',
      this.handleApplyInlineFormat,
      true
    );
    window.removeEventListener('insertTable', this.handleInsertTable, true);
    window.removeEventListener(
      'insertAttachment',
      this.handleInsertAttachment,
      true
    );
    window.removeEventListener('keydown', this.handleFindShortcut, true);
    if (this.matchCountTimer) {
      clearTimeout(this.matchCountTimer);
      this.matchCountTimer = null;
    }
    if (this.matchCountIdleHandle !== null) {
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
      prevProps.note?.content !== this.props.note?.content ||
      prevProps.unlockedContent !== this.props.unlockedContent
    ) {
      // Avoid doing O(n) work (lowercasing/scanning) on every keystroke for huge notes.
      this.updateMatchesCount();
      // reset search selection when either the note or the search changes
      if (prevProps.searchQuery !== this.props.searchQuery) {
        this.props.storeSearchSelection(null);
      }
    }
  }

  getEditorContent = () => {
    if (isNoteLocked(this.props.note) && this.props.unlockedContent !== null) {
      return this.props.unlockedContent;
    }
    return this.props.note?.content ?? '';
  };

  commitEditorContent = (
    noteId: T.EntityId,
    note: T.Note,
    nextValue: string
  ) => {
    if (!isNoteLocked(note)) {
      this.props.editNote(noteId, { content: nextValue });
      return;
    }

    this.props.storeUnlockedNoteContent(noteId, nextValue);
    this.persistLockedContent(noteId, note, nextValue);
  };

  persistLockedContent = async (
    noteId: T.EntityId,
    note: T.Note,
    nextValue: string
  ) => {
    const seq = ++this.lockedSaveSeq;
    try {
      const result = await window.electron.encryptNoteContent({
        content: nextValue,
      });
      if (
        seq !== this.lockedSaveSeq ||
        !result?.ok ||
        !result.encryptedContent
      ) {
        return;
      }

      const now = Date.now() / 1000;
      const previewTitle = getLockedNoteTitleFromContent(nextValue);
      this.props.editNote(noteId, {
        content: createLockedNotePlaceholder(previewTitle),
        locked: {
          encryptedContent: result.encryptedContent,
          previewTitle,
          lockedAt: note.locked?.lockedAt ?? result.lockedAt ?? now,
          updatedAt: now,
          encryptionVersion: 1,
        },
      });
    } catch {
      // Keep the decrypted session copy available; the next edit will retry encryption.
    }
  };

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

    const current = this.getEditorContent();
    const insertViaEditor = this.muyaRef.current?.insertText;
    if (typeof insertViaEditor === 'function') {
      insertViaEditor('- [ ] ');
      this.props.insertTask();
      return;
    }

    const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    this.commitEditorContent(noteId, note, `${current}${prefix}- [ ] `);
    this.props.insertTask();
    this.focusEditor();
  };

  handleInsertTable = () => {
    const insertTable = this.muyaRef.current?.insertTable;
    if (typeof insertTable === 'function') {
      insertTable();
      return;
    }

    const { noteId, note } = this.props;
    if (!noteId || !note) {
      return;
    }
    const current = this.getEditorContent();
    const prefix = current.length > 0 && !current.endsWith('\n') ? '\n\n' : '';
    this.commitEditorContent(
      noteId,
      note,
      `${current}${prefix}| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n`
    );
    this.focusEditor();
  };

  handleToggleBold = () => {
    const toggleInlineFormat = this.muyaRef.current?.toggleInlineFormat;
    if (typeof toggleInlineFormat === 'function') {
      toggleInlineFormat('bold');
    }
  };

  handleApplyNoteFormat = (event: Event) => {
    const label = (event as CustomEvent<{ label?: string }>).detail?.label;
    if (typeof label !== 'string' || label.length === 0) {
      return;
    }
    this.muyaRef.current?.applyBlockFormat(label);
  };

  handleApplyInlineFormat = (event: Event) => {
    const command = (event as CustomEvent<{ command?: string }>).detail
      ?.command;
    if (
      command !== 'bold' &&
      command !== 'italic' &&
      command !== 'underline' &&
      command !== 'strikeThrough'
    ) {
      return;
    }
    this.muyaRef.current?.toggleInlineFormat(command);
  };

  handleInsertAttachment = () => {
    const { folders, notebooks, noteId, note } = this.props;
    if (!noteId || !note) {
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }

      try {
        const saved = await window.electron.saveNoteAssetFromBuffer({
          noteId,
          note,
          mimeType: file.type || 'application/octet-stream',
          buffer: await file.arrayBuffer(),
          folders: Array.from(folders),
          notebooks: Array.from(notebooks),
        });
        if (!saved?.rel) {
          return;
        }
        const alt = file.name.replace(/\.[^.]+$/, '') || 'Attachment';
        this.muyaRef.current?.insertText(`![${alt}](${saved.rel})`);
      } catch {
        // Best-effort toolbar helper; paste/import flows remain available.
      }
    };
    input.click();
  };

  focusEditor = () => {
    const editor = this.muyaRef.current;
    if (!editor) {
      return;
    }

    if (typeof editor.focusTitle === 'function') {
      editor.focusTitle();
      return;
    }

    editor.focus();
  };

  hasFocus = () => this.muyaRef.current?.hasFocus() || false;

  onChange = (nextValue: string) => {
    const { noteId, note } = this.props;
    if (!noteId || !note) {
      return;
    }
    this.commitEditorContent(noteId, note, nextValue);
  };

  updateMatchesCount = () => {
    const q = (this.props.searchQuery ?? '').trim();
    if (!q) {
      this.props.storeNumberOfMatchesInNote(0);
      return;
    }
    const content = this.getEditorContent();
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
        const currentContent = this.getEditorContent();
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

      if (
        isLarge &&
        typeof (window as any).requestIdleCallback === 'function'
      ) {
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

  handleFindShortcut = (e: KeyboardEvent) => {
    const cmdOrCtrl = e.metaKey || e.ctrlKey;
    if (cmdOrCtrl && e.key.toLowerCase() === 'f' && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.setState({ showFindBar: true });
    }
  };

  handleFindSearch = (value: string) => {
    return this.muyaRef.current?.search(value) ?? { total: 0, index: -1 };
  };

  handleFindNav = (action: 'previous' | 'next') => {
    return this.muyaRef.current?.find(action) ?? { total: 0, index: -1 };
  };

  handleFindClear = () => {
    this.muyaRef.current?.clearSearch();
  };

  handleFindClose = () => {
    this.setState({ showFindBar: false });
    this.focusEditor();
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
        {this.state.showFindBar && (
          <FindBar
            onSearch={this.handleFindSearch}
            onFind={this.handleFindNav}
            onClear={this.handleFindClear}
            onClose={this.handleFindClose}
          />
        )}
        <MuyaEditor
          ref={this.muyaRef}
          noteId={this.props.noteId as unknown as string}
          value={this.getEditorContent()}
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
  unlockedContent:
    state.ui.openedNote !== null
      ? (state.ui.unlockedNoteContent.get(state.ui.openedNote) ?? null)
      : null,
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
  storeUnlockedNoteContent: actions.ui.storeUnlockedNoteContent,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteContentEditor);
