import React, { Component, CSSProperties } from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';

import PublishIcon from '../icons/published-small';
import SmallPinnedIcon from '../icons/pinned-small';
import SmallSyncIcon from '../icons/sync-small';
import { decorateWith, makeFilterDecorator } from './decorators';
import { getTerms } from '../utils/filter-notes';
import {
  normalizeNoteTitleForDisplay,
  noteTitleAndPreview,
} from '../utils/note-utils';
import { withCheckboxCharacters } from '../utils/task-transform';

import actions from '../state/actions';

import * as S from '../state';
import * as T from '../types';

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+?)\)/;
const HTML_IMG_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HTML_IMG_ALT_RE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const THUMBNAIL_SEARCH_LIMIT = 2000;

const CODE_FENCE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;

const formatNoteDate = (epochSeconds: number): string => {
  if (!epochSeconds || epochSeconds <= 0) return '';
  const date = new Date(epochSeconds * 1000);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  const msPerDay = 86_400_000;
  const daysAgo = Math.floor((now.getTime() - date.getTime()) / msPerDay);
  if (daysAgo < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  return date.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
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

  constructor(props: Props) {
    super(props);
    this.createdAt = Date.now();
  }

  componentDidUpdate(prevProps: Props) {
    const noteIdentityChanged = prevProps.noteId !== this.props.noteId;
    const folderContextChanged =
      prevProps.note?.folderId !== this.props.note?.folderId;

    if (
      noteIdentityChanged ||
      folderContextChanged ||
      prevProps.note?.content !== this.props.note?.content ||
      prevProps.isOpened !== this.props.isOpened ||
      prevProps.displayMode !== this.props.displayMode ||
      prevProps.searchQuery !== this.props.searchQuery
    ) {
      this.props.invalidateHeight();
    }

    if (this.props.lastUpdated < 1000 && !this.updateScheduled) {
      this.updateScheduled = setTimeout(() => this.forceUpdate(), 1000);
    }
  }

  componentWillUnmount() {
    clearTimeout(this.updateScheduled);
  }

  render() {
    const {
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

    const { title: rawTitle, preview } = noteTitleAndPreview(note, searchQuery);
    const title = normalizeNoteTitleForDisplay(rawTitle);
    const isPinned = note.systemTags.includes('pinned');
    const isPublished = !!note.publishURL;
    const recentlyUpdated =
      lastUpdated - this.createdAt > 1000 && Date.now() - lastUpdated < 1200;

    const pinnerClasses = classNames('note-list-item-pinner', {
      'note-list-item-pinned': isPinned,
    });
    const pinnerLabel = isPinned ? `Unpin note ${title}` : `Pin note ${title}`;

    const decorators = getTerms(searchQuery).map(makeFilterDecorator);

    const dateStr = formatNoteDate(note.modificationDate);

    const cleanPreview = withCheckboxCharacters(preview)
      .replace(CODE_FENCE_BLOCK_RE, '')
      .replace(INLINE_CODE_RE, '$1')
      .replace(/\n+/g, ' ')
      .trim();

    const shouldShowThumbnail = !(searchQuery ?? '').trim();
    const thumbnail = (() => {
      if (!shouldShowThumbnail) return null;

      const content = String(note.content ?? '');
      let alt = 'Image';
      let rawSrc = '';

      const md = MD_IMAGE_RE.exec(content);
      if (md && md.index < THUMBNAIL_SEARCH_LIMIT) {
        alt = (md[1] ?? '').trim() || 'Image';
        rawSrc = (md[2] ?? '').trim().replace(/^<|>$/g, '');
      }

      if (!rawSrc) {
        const html = HTML_IMG_SRC_RE.exec(content);
        if (html && html.index < THUMBNAIL_SEARCH_LIMIT) {
          rawSrc = ((html[1] ?? html[2] ?? html[3]) || '').trim().replace(/^<|>$/g, '');
          const altMatch = HTML_IMG_ALT_RE.exec(content);
          if (altMatch) {
            alt = ((altMatch[1] ?? altMatch[2] ?? altMatch[3]) || '').trim() || alt;
          }
        }
      }

      if (!rawSrc) return null;
      rawSrc = rawSrc.replace(/^["']+|["']+$/g, '');
      if (!rawSrc) return null;
      const normalizedSrc = rawSrc.replace(/^(\.\/|\/)/, '');

      const resolveFn = window.electron?.resolveNoteAssetFileUrl;
      const resolvedSrc =
        normalizedSrc.startsWith('assets/') && typeof resolveFn === 'function'
          ? resolveFn({ noteId, note, folders, notebooks, rel: normalizedSrc }) ||
            rawSrc
          : rawSrc;

      if (!resolvedSrc) return null;

      return { src: resolvedSrc, alt };
    })();

    const hasThumbnail = !!thumbnail;
    const classes = classNames('note-list-item', {
      'note-list-item-selected': isOpened,
      'note-list-item-pinned': isPinned,
      'note-recently-updated': recentlyUpdated,
      'published-note': isPublished,
      'note-list-item-has-thumbnail': hasThumbnail,
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
                {decorateWith(decorators, title)}
              </span>
            </div>
            <div className="note-list-item-date-preview">
              <span className="note-list-item-date">{dateStr}</span>
              {cleanPreview && (
                <span className="note-list-item-preview-text">
                  {decorateWith(decorators, cleanPreview.slice(0, 200))}
                </span>
              )}
            </div>
          </button>

          {hasThumbnail && (
            <div className="note-list-item-thumbnail-right">
              <img
                className="note-list-item-thumb-img"
                src={thumbnail.src}
                alt={thumbnail.alt}
                loading="lazy"
                draggable={false}
              />
            </div>
          )}

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
