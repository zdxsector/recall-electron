import React, { Component, CSSProperties, createRef } from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';

import PublishIcon from '../icons/published-small';
import SmallPinnedIcon from '../icons/pinned-small';
import SmallSyncIcon from '../icons/sync-small';
import FileSmallIcon from '../icons/file-small';
import { decorateWith, makeFilterDecorator } from './decorators';
import { getTerms } from '../utils/filter-notes';
import { noteTitleAndPreview } from '../utils/note-utils';
import { withCheckboxCharacters } from '../utils/task-transform';
import { renderNoteToHtml } from '../utils/render-note-to-html';

import actions from '../state/actions';

import * as S from '../state';
import * as T from '../types';

const IMAGE_LINE_ONLY_RE = /^\s*!\[([^\]]*)\]\(\s*([^)]+?)\s*\)\s*$/;
const HTML_IMAGE_LINE_ONLY_RE = /^\s*<img\b[^>]*>\s*$/i;
const HTML_IMAGE_SRC_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HTML_IMAGE_ALT_RE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const MAX_TITLE_THUMBNAIL_LINES = 4;
const MAX_RENDERED_PREVIEW_LINES = 30;
const MAX_RENDERED_PREVIEW_CHARS = 2500;

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const isFenceLine = (line: string) => FENCE_RE.test(String(line ?? ''));

const findTitleLineIndex = (content: string): number => {
  const lines = String(content ?? '').split(/\r?\n/);
  let firstImageIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = String(lines[i]).trim();
    if (!trimmed) continue;
    const imgMatch = IMAGE_LINE_ONLY_RE.exec(trimmed);
    if (imgMatch || HTML_IMAGE_LINE_ONLY_RE.test(trimmed)) {
      if (firstImageIdx === null) firstImageIdx = i;
      continue;
    }
    return i;
  }
  return firstImageIdx ?? -1;
};

const getRenderedPreviewSource = (content: string): string => {
  const allLines = String(content ?? '').split(/\r?\n/);
  if (allLines.length === 0) return '';

  const titleIdx = findTitleLineIndex(content);
  if (titleIdx < 0) return '';
  const titleLine = String(allLines[titleIdx] ?? '').trim();

  // If the "title line" is image-only (e.g. note is only images),
  // include it in the preview so users can still see the image.
  const titleIsImageOnly =
    IMAGE_LINE_ONLY_RE.test(titleLine) ||
    HTML_IMAGE_LINE_ONLY_RE.test(titleLine);

  let startIdx = titleIsImageOnly ? titleIdx : titleIdx + 1;

  // Skip leading blank lines after the title.
  while (startIdx < allLines.length && !String(allLines[startIdx]).trim()) {
    startIdx++;
  }

  let chars = 0;
  const slice: string[] = [];
  // If we enter a fenced code block, keep including lines until we close it,
  // otherwise previews can show raw/unrendered block tokens (e.g. mermaid/math).
  let openFence: { marker: string } | null = null;
  for (let i = startIdx; i < allLines.length; i++) {
    const line = String(allLines[i] ?? '');
    slice.push(line);
    chars += line.length + 1;

    // Track fenced code blocks to avoid cutting mid-block.
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2] ?? '';
      if (!openFence) {
        openFence = { marker };
      } else if (openFence.marker === marker) {
        openFence = null;
      }
    }

    if (slice.length >= MAX_RENDERED_PREVIEW_LINES) break;
    if (chars >= MAX_RENDERED_PREVIEW_CHARS) break;
  }

  // If we cut off while still inside a fence, continue until we close it,
  // with a hard safety cap to prevent huge previews.
  if (openFence) {
    const safetyMaxExtraLines = 40;
    for (
      let i = startIdx + slice.length;
      i < allLines.length && safetyMaxExtraLines > 0;
      i++
    ) {
      const line = String(allLines[i] ?? '');
      slice.push(line);
      const fenceMatch = FENCE_RE.exec(line);
      if (fenceMatch && (fenceMatch[2] ?? '') === openFence.marker) {
        openFence = null;
        break;
      }
    }
  }

  return slice.join('\n').trim();
};

const extractMarkdownImageSrc = (raw: string): string => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  // Support the <url> form and optional title: ![alt](<url> "title")
  if (trimmed.startsWith('<')) {
    const closeIdx = trimmed.indexOf('>');
    if (closeIdx > 1) {
      return trimmed.slice(1, closeIdx).trim();
    }
  }
  // Otherwise, treat the first whitespace-delimited token as the URL.
  return trimmed.split(/\s+/)[0] ?? '';
};

const extractHtmlAttribute = (re: RegExp, s: string): string | null => {
  const m = re.exec(String(s ?? ''));
  const value = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  return value || null;
};

type OwnProps = {
  invalidateHeight: () => any;
  noteId: T.EntityId;
  style: CSSProperties;
};

type StateProps = {
  displayMode: T.ListDisplayMode;
  hasPendingChanges: boolean;
  isOffline: boolean;
  isOpened: boolean;
  lastUpdated: number;
  folders: any[];
  notebooks: any[];
  note?: T.Note;
  searchQuery: string;
};

type DispatchProps = {
  openNote: (noteId: T.EntityId) => any;
  pinNote: (noteId: T.EntityId, shouldPin: boolean) => any;
};

type Props = OwnProps & StateProps & DispatchProps;

export class NoteCell extends Component<Props> {
  createdAt: number;
  updateScheduled: ReturnType<typeof setTimeout> | undefined;
  renderedPreviewRef = createRef<HTMLDivElement>();
  renderedPreviewScheduled: ReturnType<typeof setTimeout> | undefined;
  renderedPreviewSeq = 0;

  constructor(props: Props) {
    super(props);

    // prevent bouncing note updates on app boot
    this.createdAt = Date.now();
  }

  componentDidMount() {
    this.scheduleRenderedPreview();
  }

  componentDidUpdate(prevProps: Props) {
    const prevNote = prevProps.note;
    const nextNote = this.props.note;

    // react-virtualized can reuse row components; ensure we refresh previews when
    // the identity/context of the note changes (not only its content).
    // IMPORTANT: Redux updates note objects immutably, so `prevNote !== nextNote`
    // will be true on every content edit. Treating that as an identity change
    // causes us to clear the preview DOM on every keystroke (visible "flash").
    // Only consider the row "identity" changed when the note id changes.
    const noteIdentityChanged = prevProps.noteId !== this.props.noteId;
    const folderContextChanged = prevNote?.folderId !== nextNote?.folderId;

    if (noteIdentityChanged || folderContextChanged) {
      this.props.invalidateHeight();
    }

    if (prevProps.note?.content !== this.props.note?.content) {
      this.props.invalidateHeight();
    }

    if (
      prevProps.isOpened !== this.props.isOpened ||
      prevProps.displayMode !== this.props.displayMode ||
      prevProps.searchQuery !== this.props.searchQuery
    ) {
      this.props.invalidateHeight();
    }

    if (
      noteIdentityChanged ||
      folderContextChanged ||
      prevProps.note?.content !== this.props.note?.content ||
      prevProps.isOpened !== this.props.isOpened ||
      prevProps.displayMode !== this.props.displayMode ||
      prevProps.searchQuery !== this.props.searchQuery
    ) {
      // Prevent stale rendered HTML from briefly showing for another note.
      // Only clear when switching notes, not when content changes to avoid flashing.
      if (noteIdentityChanged || folderContextChanged) {
        const node = this.renderedPreviewRef.current;
        if (node) node.innerHTML = '';
        // Bump seq so any in-flight async preview work is ignored.
        this.renderedPreviewSeq++;
      }
      // When only content changes (not note identity), don't clear the preview
      // to avoid flashing. The new content will smoothly replace the old content.
      this.scheduleRenderedPreview();
    }

    // make sure we reset our update indicator
    // otherwise it won't re-animate on the next update
    if (this.props.lastUpdated < 1000 && !this.updateScheduled) {
      this.updateScheduled = setTimeout(() => this.forceUpdate(), 1000);
    }
  }

  componentWillUnmount() {
    clearTimeout(this.updateScheduled);
    clearTimeout(this.renderedPreviewScheduled);
  }

  shouldShowRenderedPreview() {
    const { displayMode, searchQuery, note } = this.props;
    if (!note) return false;
    if ('condensed' === displayMode) return false;
    if ((searchQuery ?? '').trim()) return false;

    // Always show rendered preview for all notes since Muya is a markdown editor.
    // This provides consistent behavior and avoids flickering between modes.
    return true;
  }

  scheduleRenderedPreview() {
    clearTimeout(this.renderedPreviewScheduled);
    this.renderedPreviewScheduled = setTimeout(
      () => this.renderRenderedPreview(),
      90
    );
  }

  async renderRenderedPreview() {
    const node = this.renderedPreviewRef.current;
    if (!node) return;

    if (!this.shouldShowRenderedPreview()) {
      node.innerHTML = '';
      return;
    }

    const { note, noteId, folders, notebooks } = this.props;
    const source = getRenderedPreviewSource(note?.content ?? '');
    if (!source) {
      node.innerHTML = '';
      return;
    }

    const seq = ++this.renderedPreviewSeq;

    try {
      const html = await renderNoteToHtml(source);
      if (seq !== this.renderedPreviewSeq) return;

      node.innerHTML = html;

      // Ensure preview content isn't interactive inside the list item button.
      node.querySelectorAll('a').forEach((a) => {
        const span = document.createElement('span');
        span.textContent = a.textContent ?? '';
        a.replaceWith(span);
      });
      node.querySelectorAll('input').forEach((input) => {
        try {
          (input as HTMLInputElement).disabled = true;
          (input as HTMLInputElement).readOnly = true;
          (input as HTMLInputElement).tabIndex = -1;
        } catch {
          // ignore
        }
      });

      // Materialize assets/<name> image URLs into file:// URLs.
      const resolveFn = window.electron?.resolveNoteAssetFileUrl;
      if (typeof resolveFn === 'function') {
        node.querySelectorAll('img').forEach((img) => {
          try {
            const raw = (img.getAttribute('src') ?? '').trim();
            if (!raw) return;

            const normalized = raw.replace(/^(\.\/|\/)/, '');
            if (!normalized.startsWith('assets/')) return;

            const resolved = resolveFn({
              noteId,
              note,
              folders,
              notebooks,
              rel: normalized,
            });
            if (resolved) img.setAttribute('src', resolved);
          } catch {
            // ignore
          }
        });
      }

      // Keep previews lightweight and fixed-size thumbnails.
      node.querySelectorAll('img').forEach((img) => {
        img.setAttribute('loading', 'lazy');
        img.setAttribute('draggable', 'false');
        // Remove any width/height attributes from the editor so CSS controls sizing
        img.removeAttribute('width');
        img.removeAttribute('height');
        img.style.removeProperty('width');
        img.style.removeProperty('height');
      });

      // Apply syntax highlighting to code blocks
      const codeElements = node.querySelectorAll('pre code');
      if (codeElements.length) {
        try {
          const { default: highlight } = await import(
            /* webpackChunkName: 'highlight' */ 'highlight.js'
          );
          if (seq !== this.renderedPreviewSeq) return;
          codeElements.forEach((el) =>
            highlight.highlightElement(el as HTMLElement)
          );
        } catch {
          // ignore highlight errors
        }
      }
    } catch {
      if (seq !== this.renderedPreviewSeq) return;
      node.innerHTML = '';
    }
  }

  render() {
    const {
      displayMode,
      hasPendingChanges,
      isOffline,
      isOpened,
      lastUpdated,
      folders,
      notebooks,
      noteId,
      note,
      openNote,
      pinNote,
      searchQuery,
      style,
    } = this.props;

    if (!note) {
      return <div>{"Couldn't find note"}</div>;
    }

    const { title, preview } = noteTitleAndPreview(note, searchQuery);
    const isPinned = note.systemTags.includes('pinned');
    const isPublished = !!note.publishURL;
    const recentlyUpdated =
      lastUpdated - this.createdAt > 1000 && Date.now() - lastUpdated < 1200;

    const pinnerClasses = classNames('note-list-item-pinner', {
      'note-list-item-pinned': isPinned,
    });
    const pinnerLabel = isPinned ? `Unpin note ${title}` : `Pin note ${title}`;

    const decorators = getTerms(searchQuery).map(makeFilterDecorator);
    const showRenderedPreview = this.shouldShowRenderedPreview();

    // If an image appears in the first 4 non-empty editor lines, show a thumbnail in the title row.
    // Skip this when searching so contextual text previews remain clear.
    const shouldShowTitleThumbnail = !(searchQuery ?? '').trim();
    const titleThumbnail = (() => {
      if (!shouldShowTitleThumbnail) return null;

      const content = String(note.content ?? '');
      const candidateLines: string[] = [];
      for (const line of content.split(/\r?\n/)) {
        const trimmed = String(line).trim();
        if (!trimmed) continue;
        candidateLines.push(trimmed);
        if (candidateLines.length >= MAX_TITLE_THUMBNAIL_LINES) break;
      }

      let alt = 'Image';
      let rawSrc = '';
      for (const line of candidateLines) {
        const md = IMAGE_LINE_ONLY_RE.exec(line);
        if (md) {
          alt = (md[1] ?? '').trim() || 'Image';
          rawSrc = extractMarkdownImageSrc(md[2] ?? '').replace(/^<|>$/g, '');
          break;
        }
        if (HTML_IMAGE_LINE_ONLY_RE.test(line)) {
          const src = extractHtmlAttribute(HTML_IMAGE_SRC_RE, line);
          if (!src) continue;
          rawSrc = src.replace(/^<|>$/g, '');
          alt = extractHtmlAttribute(HTML_IMAGE_ALT_RE, line) || alt;
          break;
        }
      }

      if (!rawSrc) return null;
      const normalizedSrc = rawSrc.replace(/^(\.\/|\/)/, '');

      const resolveFn = window.electron?.resolveNoteAssetFileUrl;
      const resolvedSrc =
        normalizedSrc.startsWith('assets/') && typeof resolveFn === 'function'
          ? resolveFn({
              noteId,
              note,
              folders,
              notebooks,
              rel: normalizedSrc,
            }) || rawSrc
          : rawSrc;

      // Avoid rendering very large data: thumbnails in the list (can be huge and cause jank).
      const isHttp = /^https?:\/\//i.test(resolvedSrc);
      const isFile = /^file:\/\//i.test(resolvedSrc);
      const isSmallDataImage =
        /^data:image\//i.test(resolvedSrc) && resolvedSrc.length <= 8_192;
      const showThumb = isFile || isHttp || isSmallDataImage;

      return (
        <span className="note-list-item-title-thumbnail">
          {showThumb ? (
            <img
              className="note-list-item-image-thumb"
              src={resolvedSrc}
              alt={alt}
              loading="lazy"
            />
          ) : (
            <span className="note-list-item-image-fallback" aria-hidden="true">
              <FileSmallIcon />
            </span>
          )}
        </span>
      );
    })();

    const hasTitleThumbnail = !!titleThumbnail;
    const classes = classNames('note-list-item', {
      'note-list-item-selected': isOpened,
      'note-list-item-pinned': isPinned,
      'note-recently-updated': recentlyUpdated,
      'published-note': isPublished,
      'note-list-item-has-title-thumbnail': hasTitleThumbnail,
    });

    return (
      <div style={style} className={classes} role="row">
        <div className="note-list-item-content" role="cell">
          <div className="note-list-item-status">
            <button
              aria-label={pinnerLabel}
              className={pinnerClasses}
              onClick={() => pinNote(noteId, !isPinned)}
            >
              <SmallPinnedIcon />
            </button>
          </div>

          <button
            aria-label={`Edit note ${title}`}
            className="note-list-item-text"
            onClick={() => openNote(noteId)}
          >
            <div className="note-list-item-title">
              <span className="note-list-item-title-text">
                {decorateWith(decorators, withCheckboxCharacters(title))}
              </span>
              {titleThumbnail}
            </div>
            {'expanded' === displayMode &&
              (showRenderedPreview ? (
                <div
                  className="note-list-item-excerpt note-list-item-excerpt-rendered"
                  ref={this.renderedPreviewRef}
                />
              ) : (
                preview.length > 0 && (
                  <div className="note-list-item-excerpt">
                    {withCheckboxCharacters(preview)
                      .split('\n')
                      .map((line, index) => (
                        <React.Fragment key={index}>
                          {index > 0 && <br />}
                          {decorateWith(decorators, line.slice(0, 200))}
                        </React.Fragment>
                      ))}
                  </div>
                )
              ))}
            {'comfy' === displayMode &&
              (showRenderedPreview ? (
                <div
                  className="note-list-item-excerpt note-list-item-excerpt-rendered"
                  ref={this.renderedPreviewRef}
                />
              ) : (
                preview.length > 0 && (
                  <div className="note-list-item-excerpt">
                    {decorateWith(
                      decorators,
                      withCheckboxCharacters(preview).slice(0, 200)
                    )}
                  </div>
                )
              ))}
          </button>
          <div className="note-list-item-status-right">
            {hasPendingChanges && (
              <span
                className={classNames('note-list-item-pending-changes', {
                  'is-offline': isOffline,
                })}
              >
                <SmallSyncIcon />
              </span>
            )}
            {isPublished && (
              <span className="note-list-item-published-icon">
                <PublishIcon />
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps, OwnProps> = (
  state,
  { noteId }
) => ({
  displayMode: state.settings.noteDisplay,
  // In offline mode we consider notes always locally saved; no pending sync.
  hasPendingChanges: false,
  isOffline: false,
  isOpened: state.ui.openedNote === noteId,
  lastUpdated: -Infinity,
  folders: Array.from(state.data.folders),
  notebooks: Array.from(state.data.notebooks),
  note: state.data.notes.get(noteId),
  searchQuery: state.ui.searchQuery,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  openNote: actions.ui.openNote,
  pinNote: actions.data.pinNote,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteCell);
