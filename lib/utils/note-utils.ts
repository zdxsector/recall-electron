import removeMarkdown from 'remove-markdown';
import { escapeRegExp } from 'lodash';
import { getTerms } from './filter-notes';

import * as T from '../types';

export interface TitleAndPreview {
  title: string;
  preview: string;
}

export const maxTitleChars = 64;
export const maxPreviewChars = 200;
export const untitledNoteTitle = 'No Title';

const isLowSurrogate = (c: number) => 0xdc00 <= c && c <= 0xdfff;

// Muya uses zero-width spaces for empty lines/blocks when serializing to markdown.
// Treat these as "invisible" so they don't produce an empty-looking title.
const INVISIBLE_CHARS_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const stripInvisibleChars = (value: string): string =>
  String(value ?? '').replace(INVISIBLE_CHARS_RE, '');

export const normalizeNoteTitleForDisplay = (value: unknown): string => {
  const normalized = stripInvisibleChars(String(value ?? '')).trim();
  return normalized || untitledNoteTitle;
};

const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)/;
const IMAGE_LINE_ONLY_RE = /^\s*!\[[^\]]*\]\([^)]+\)\s*$/;
const HTML_IMAGE_LINE_ONLY_RE = /^\s*<img\b[^>]*>\s*$/i;
const HTML_IMAGE_ALT_RE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;
const TASK_LINE_RE = /^\s*-\s*\[(?: |x|X)\]\s*(.*)$/;

type ReadLineResult = { line: string; nextOffset: number; done: boolean };
const readNextLine = (content: string, offset: number): ReadLineResult => {
  const s = String(content ?? '');
  if (offset >= s.length) {
    return { line: '', nextOffset: s.length, done: true };
  }
  const nl = s.indexOf('\n', offset);
  const end = nl === -1 ? s.length : nl;
  let line = s.slice(offset, end);
  // Handle Windows line endings without allocating a split array.
  if (line.endsWith('\r')) line = line.slice(0, -1);
  return {
    line,
    nextOffset: nl === -1 ? s.length : end + 1,
    done: nl === -1,
  };
};

const extractHtmlAttribute = (re: RegExp, s: string): string | null => {
  const m = re.exec(String(s ?? ''));
  const value = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  return value || null;
};

const normalizeTitleCandidate = (line: string): string => {
  const rawTrimmed = String(line ?? '').trim();
  const headingMatch = HEADING_RE.exec(rawTrimmed);
  if (headingMatch && headingMatch[1]) {
    return stripInvisibleChars(headingMatch[1]).trim();
  }
  return stripInvisibleChars(rawTrimmed).trim();
};

const findTitleLineIndex = (content: string): number => {
  let firstImageIdx: number | null = null;
  let i = 0;
  let offset = 0;
  while (true) {
    const { line, nextOffset, done } = readNextLine(content, offset);
    offset = nextOffset;

    const rawTrimmed = String(line).trim();
    const visibleTrimmed = stripInvisibleChars(rawTrimmed).trim();
    if (visibleTrimmed) {
      const imgMatch = IMAGE_LINE_RE.exec(rawTrimmed);
      if (imgMatch || HTML_IMAGE_LINE_ONLY_RE.test(rawTrimmed)) {
        if (firstImageIdx === null) firstImageIdx = i;
      } else {
        return i;
      }
    }

    if (done) break;
    i++;
  }

  return firstImageIdx ?? -1;
};

/**
 * Returns a string with markdown stripped
 *
 * @param {String} inputString string for which to remove markdown
 * @returns {String} string with markdown removed
 */
const removeMarkdownWithFix = (inputString) => {
  // Workaround for a bug in `remove-markdown`
  // See https://github.com/stiang/remove-markdown/issues/35
  return removeMarkdown(inputString.replace(/(\s)\s+/g, '$1'), {
    stripListLeaders: false,
  });
};

export const getTitle = (content) => {
  if (!content) {
    return untitledNoteTitle;
  }

  // Title is the first meaningful (non-empty, non-image-only) line.
  // If the first content is an image, prefer the next text line; otherwise fall back
  // to the image alt text.
  let pendingImageAlt: string | null = null;
  let offset = 0;
  while (true) {
    const { line, nextOffset, done } = readNextLine(content, offset);
    offset = nextOffset;
    const rawTrimmed = String(line).trim();
    const visibleTrimmed = stripInvisibleChars(rawTrimmed).trim();
    if (!visibleTrimmed) {
      if (done) break;
      continue;
    }

    const headingMatch = HEADING_RE.exec(rawTrimmed);
    if (headingMatch && headingMatch[1]) {
      const title = stripInvisibleChars(headingMatch[1]).trim();
      if (title) return title.slice(0, maxTitleChars);
    }

    // If the first meaningful line is a task list item, prefer the task text.
    // Skip "empty" tasks like `- [ ]` so the title doesn't become the checkbox syntax.
    const taskMatch = TASK_LINE_RE.exec(rawTrimmed);
    if (taskMatch) {
      const taskText = stripInvisibleChars(String(taskMatch[1] ?? '')).trim();
      if (!taskText) continue;
      return taskText.slice(0, maxTitleChars);
    }

    const imgMatch = IMAGE_LINE_RE.exec(rawTrimmed);
    if (imgMatch) {
      const alt = stripInvisibleChars(String(imgMatch[1] ?? '')).trim();
      if (!pendingImageAlt && alt) pendingImageAlt = alt;
      // Keep looking for real text.
      if (done) break;
      continue;
    }

    if (HTML_IMAGE_LINE_ONLY_RE.test(rawTrimmed)) {
      const altRaw = extractHtmlAttribute(HTML_IMAGE_ALT_RE, rawTrimmed);
      const alt = altRaw ? stripInvisibleChars(altRaw).trim() : null;
      if (!pendingImageAlt && alt) pendingImageAlt = alt;
      // Keep looking for real text.
      if (done) break;
      continue;
    }

    return visibleTrimmed.slice(0, maxTitleChars);
  }

  if (pendingImageAlt) {
    return pendingImageAlt.slice(0, maxTitleChars);
  }

  return untitledNoteTitle;
};

/**
 * Generate preview for note list
 *
 * Should gather the first non-whitespace content
 * for up to three lines and up to 200 characters
 *
 * @param content
 */
const getPreview = (content: string, searchQuery?: string) => {
  let preview = '';
  let lines = 0;

  // contextual note previews
  if (searchQuery?.trim()) {
    const terms = getTerms(searchQuery);

    // use only the first term of a multi-term query
    if (terms.length > 0) {
      const firstTerm = terms[0].toLocaleLowerCase();
      const leadingChars = 30 - firstTerm.length;

      // prettier-ignore
      const regExp = new RegExp(
        '(?:\\s|^)[^\n]' + // split at a word boundary (pattern must be preceded by whitespace or beginning of string)
          '{0,' + leadingChars + '}' + // up to leadingChars of text before the match
          escapeRegExp(firstTerm) +
          '.{0,200}(?=\\s|$)', // up to 200 characters of text after the match, splitting at a word boundary
        'ims'
      );
      const matches = regExp.exec(content);
      if (matches && matches.length > 0) {
        // Remove blank lines and note title from the search note preview
        const title = getTitle(content);
        preview = matches[0]
          .split('\n')
          .filter(
            (line) =>
              stripInvisibleChars(String(line ?? '')).trim() !== '' &&
              normalizeTitleCandidate(line) !== title
          )
          .join('\n');
        // don't return half of a surrogate pair
        return isLowSurrogate(preview.charCodeAt(0))
          ? preview.slice(1)
          : preview;
      }
    }
  }

  // implicit else: if the query didn't match, fall back to first three lines
  const titleIndex = findTitleLineIndex(content);
  // Build preview from up to 3 non-empty lines after the title line, scanning
  // without splitting the entire document into an array (important for huge notes).
  let offset = 0;
  let idx = 0;
  while (true) {
    const { line: rawLine, nextOffset, done } = readNextLine(content, offset);
    offset = nextOffset;
    if (idx < Math.max(0, titleIndex + 1)) {
      idx++;
      if (done) break;
      continue;
    }
    if (lines >= 3) break;
    const rawTrimmed = String(rawLine ?? '').trim();
    const visibleTrimmed = stripInvisibleChars(rawTrimmed).trim();
    if (!visibleTrimmed) {
      idx++;
      if (done) break;
      continue;
    }
    // Skip empty task list items (`- [ ]` with no text) so the preview
    // doesn’t show a dangling checkbox row.
    const taskMatch = TASK_LINE_RE.exec(rawTrimmed);
    if (
      taskMatch &&
      !stripInvisibleChars(String(taskMatch[1] ?? '')).trim()
    ) {
      idx++;
      if (done) break;
      continue;
    }
    const line = visibleTrimmed;
    if (IMAGE_LINE_ONLY_RE.test(line) || HTML_IMAGE_LINE_ONLY_RE.test(line)) {
      idx++;
      if (done) break;
      continue;
    }
    preview += line + '\n';
    lines++;
    idx++;
    if (done) break;
  }

  return preview.trim();
};

const formatPreview = (stripMarkdown: boolean, s: string): string => {
  const raw = String(s ?? '');
  if (!stripMarkdown) {
    return raw.trim();
  }
  // `remove-markdown` can preserve trailing whitespace/newlines depending on input.
  // Trim so list previews don't gain an extra blank line when re-rendering.
  return String(removeMarkdownWithFix(raw) || raw).trim();
};

const previewCache = new WeakMap<T.Note, [TitleAndPreview, boolean, string?]>();

/**
 * Returns the title and excerpt for a given note
 *
 * @param note generate the previews for this note
 * @returns title and excerpt (if available)
 */
export const noteTitleAndPreview = (
  note: T.Note,
  searchQuery?: string
): TitleAndPreview => {
  const stripMarkdown = isMarkdown(note);
  const cached = previewCache.get(note);
  if (cached) {
    const [value, wasMarkdown, savedQuery] = cached;
    if (wasMarkdown === stripMarkdown && savedQuery === searchQuery) {
      return value;
    }
  }

  const content = note.content || '';
  const title = normalizeNoteTitleForDisplay(
    formatPreview(stripMarkdown, getTitle(content))
  );
  const preview = formatPreview(
    stripMarkdown,
    getPreview(content, searchQuery)
  );
  const result = { title, preview };

  previewCache.set(note, [result, stripMarkdown, searchQuery]);

  return result;
};

function isMarkdown(note: T.Note): boolean {
  return note.systemTags.includes('markdown');
}

export default noteTitleAndPreview;
