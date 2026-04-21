const {
  contextBridge,
  ipcRenderer,
  clipboard,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const sanitizeFilename = require('sanitize-filename');

const NOTES_ROOT_NAME = 'Recall';
const toAssetUrl = (absPath) =>
  pathToFileURL(absPath).href.replace(/^file:\/\//, 'recall-asset://');
const META_DIR_NAME = '.recall';
const META_FILE_NAME = 'store.json';
const REVISIONS_FILE_NAME = 'revisions.json';
const DEBUG_PERSIST = process.env.RECALL_DEBUG_PERSIST === '1';

const summarizeNewlines = (value) => {
  const text = String(value ?? '');
  const total = (text.match(/\n/g) || []).length;
  const leadingMatch = text.match(/^\n+/);
  const trailingMatch = text.match(/\n+$/);
  let maxRun = 0;
  let current = 0;
  for (const ch of text) {
    if (ch === '\n') {
      current += 1;
      if (current > maxRun) {
        maxRun = current;
      }
    } else {
      current = 0;
    }
  }
  return {
    length: text.length,
    totalNewlines: total,
    leadingNewlines: leadingMatch ? leadingMatch[0].length : 0,
    trailingNewlines: trailingMatch ? trailingMatch[0].length : 0,
    maxConsecutiveNewlines: maxRun,
  };
};

// Legacy migration helper:
// Older versions persisted notes primarily as HTML and converted back to markdown on load.
// That conversion path can lose soft line breaks (`\n` inside text nodes). To keep
// newlines stable across restarts, we prefer loading `.md` files, and for legacy `.html`
// files we perform a best-effort HTML->Markdown conversion with a soft-break workaround,
// then write a sibling `.md` file so future loads are markdown-first.
let _turndown = undefined;
const getTurndown = () => {
  if (_turndown !== undefined) return _turndown;
  try {
    const TurndownService = require('turndown');
    _turndown = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      blankReplacement: (_content, node) => {
        // turndown sets `isBlock` on nodes it considers blocks.
        return node && node.isBlock ? '\n\n' : '';
      },
    });
    // Explicit rules so empty markers always survive conversion.
    _turndown.addRule('muSoftLineBreak', {
      filter: (node) =>
        node &&
        node.nodeName === 'SPAN' &&
        node.classList &&
        node.classList.contains('mu-soft-line-break'),
      replacement: () => '\n',
    });
    _turndown.addRule('muHardLineBreak', {
      filter: (node) =>
        node &&
        node.nodeName === 'SPAN' &&
        node.classList &&
        node.classList.contains('mu-hard-line-break'),
      replacement: () => '  \n',
    });
  } catch {
    _turndown = null;
  }
  return _turndown;
};

const turnSoftBreakToSpan = (html) => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<x-mt id="turn-root">${String(html ?? '')}</x-mt>`,
      'text/html'
    );
    const root = doc.querySelector('#turn-root');
    if (!root) return String(html ?? '');

    const travel = (childNodes) => {
      for (const node of Array.from(childNodes)) {
        if (
          node.nodeType === Node.TEXT_NODE &&
          node.parentElement?.tagName !== 'CODE'
        ) {
          let startLen = 0;
          let endLen = 0;
          const original = String(node.nodeValue ?? '');
          const text = original
            .replace(/^(\n+)/, (_m, p) => {
              startLen = p.length;
              return '';
            })
            .replace(/(\n+)$/, (_m, p) => {
              endLen = p.length;
              return '';
            });

          if (/\n/.test(text)) {
            const tokens = text.split('\n');
            const params = [];
            const len = tokens.length;
            for (let i = 0; i < len; i++) {
              let piece = tokens[i];
              if (i === 0 && startLen) piece = '\n'.repeat(startLen) + piece;
              else if (i === len - 1 && endLen)
                piece = piece + '\n'.repeat(endLen);

              params.push(document.createTextNode(piece));
              if (i !== len - 1) {
                const softBreak = document.createElement('span');
                softBreak.classList.add('mu-soft-line-break');
                params.push(softBreak);
              }
            }
            node.replaceWith(...params);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          travel(node.childNodes);
        }
      }
    };
    travel(root.childNodes);
    return root.innerHTML;
  } catch {
    return String(html ?? '');
  }
};

const legacyHtmlToMarkdown = (html) => {
  const turndown = getTurndown();
  if (!turndown) return null;
  try {
    const prepared = turnSoftBreakToSpan(String(html ?? ''));
    return turndown.turndown(prepared);
  } catch {
    return null;
  }
};

const getNotesRoot = () => {
  const documents = ipcRenderer.sendSync('recall:getPath', 'documents');
  if (!documents) {
    throw new Error('Could not resolve documents path from main process');
  }
  return path.join(documents, NOTES_ROOT_NAME);
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const readJsonFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to read JSON file:', filePath, e);
    return null;
  }
};

const writeJsonFile = (filePath, data) => {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to write JSON file:', filePath, e);
  }
};

const safeRmDir = (root, dirRel) => {
  try {
    if (!dirRel) return;
    const full = path.join(root, dirRel);
    // safety: only allow deleting within our root
    if (!full.startsWith(root)) {
      return;
    }
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to delete directory:', dirRel, e);
  }
};

const ensureUniqueDirPath = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return dirPath;
  }
  const parent = path.dirname(dirPath);
  const base = path.basename(dirPath);
  for (let i = 2; i < 500; i++) {
    const candidate = path.join(parent, `${base} (${i})`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return dirPath;
};

const cleanupEmptyDirs = (startDir, stopDir) => {
  try {
    let cur = startDir;
    while (cur && cur.startsWith(stopDir) && cur !== stopDir) {
      if (!fs.existsSync(cur)) {
        cur = path.dirname(cur);
        continue;
      }
      const entries = fs.readdirSync(cur);
      if (entries.length > 0) {
        break;
      }
      fs.rmdirSync(cur);
      cur = path.dirname(cur);
    }
  } catch {
    // best-effort cleanup
  }
};

const safeName = (name, fallback) => {
  const cleaned = sanitizeFilename(String(name || '').trim()) || fallback;
  return cleaned.length > 0 ? cleaned : fallback;
};

const noteTitleFromContent = (content) => {
  const s = String(content || '');
  const lines = s.split(/\r?\n/);
  let title = '';
  for (const line of lines) {
    let candidate = line.trim();
    if (!candidate) continue;
    candidate = candidate.replace(/^\s*#{1,6}\s+/, '').trim();
    // Strip markdown image syntax: ![alt](src)
    candidate = candidate.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
    if (candidate) {
      title = candidate.slice(0, 64);
      break;
    }
  }
  return title || 'New Note';
};

const buildFolderPath = (foldersArray, notebooksArray, folderId) => {
  const folders = new Map(foldersArray || []);
  const notebooks = new Map(notebooksArray || []);
  const parts = [];
  let cur = folderId;
  const seen = new Set();
  while (cur && folders.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const folder = folders.get(cur);
    parts.unshift(safeName(folder.name, 'Folder'));
    cur = folder.parentFolderId || null;
  }

  // Include notebook name as the first path segment (keeps notebooks separate on disk)
  const topFolder =
    folderId && folders.has(folderId) ? folders.get(folderId) : null;
  const notebookId = topFolder?.notebookId;
  const notebook =
    notebookId && notebooks.has(notebookId) ? notebooks.get(notebookId) : null;
  const notebookName = safeName(notebook?.name ?? 'Notebook', 'Notebook');
  return [notebookName, ...parts];
};

const getOrCreateNoteDir = (
  root,
  foldersArray,
  notebooksArray,
  noteId,
  note
) => {
  const folderParts = buildFolderPath(
    foldersArray,
    notebooksArray,
    note.folderId || null
  );
  const folderDir = path.join(root, ...folderParts);
  ensureDir(folderDir);

  const title = noteTitleFromContent(note.content);
  const noteDirName = safeName(title, 'New Note');
  const noteDir = path.join(folderDir, noteDirName);
  ensureDir(noteDir);
  ensureDir(path.join(noteDir, 'assets'));

  const htmlFile = path.join(noteDir, `${noteDirName}.html`);
  const mdFile = path.join(noteDir, `${noteDirName}.md`);
  return { noteDir, htmlFile, mdFile, folderDir, noteDirName, folderParts };
};

const validChannels = [
  'appCommand',
  'appStateUpdate',
  'clearCookies',
  'closeWindow',
  'editorCommand',
  'importNotes',
  'noteImportChannel',
  'reallyCloseWindow',
  'reload',
  'setAutoHideMenuBar',
  'tokenLogin',
  'wpLogin',
  'window:maximized',
  'window:setTitleBarOverlay',
];

const electronAPI = {
  confirmLogout: (changes) => {
    const response = ipcRenderer.sendSync('recall:showMessageBoxSync', {
      type: 'warning',
      buttons: [
        'Export Unsynced Notes',
        "Don't Logout Yet",
        'Lose Changes and Logout',
      ],
      title: 'Unsynced Notes Detected',
      message:
        'Logging out will delete any unsynced notes. ' +
        'Do you want to continue or give it a little more time to finish trying to sync?\n\n' +
        changes,
    });

    switch (response) {
      case 0:
        return 'export';

      case 1:
        return 'reconsider';

      case 2:
        return 'logout';
    }
  },
  confirm: ({ title, message, detail } = {}) => {
    try {
      const response = ipcRenderer.sendSync('recall:showMessageBoxSync', {
        type: 'warning',
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        cancelId: 0,
        title: title || 'Confirm',
        message: message || 'Are you sure?',
        detail: detail || undefined,
      });
      return response === 1;
    } catch (e) {
      return false;
    }
  },
  // Filesystem-backed persistence helpers used by the renderer-side
  // `lib/state/persistence.ts` module when running under Electron.
  loadPersistentState: () => {
    try {
      const root = getNotesRoot();
      const metaDir = path.join(root, META_DIR_NAME);
      const metaPath = path.join(metaDir, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath);
      if (!rawMeta) {
        return null;
      }

      // Rehydrate notes content from on-disk HTML files.
      // `rawMeta` is expected to be the same shape as the old persisted payload,
      // except that note contents may be omitted or stale.
      const notesArray = rawMeta.notes ?? [];
      const notePaths = rawMeta.notePaths ?? {};
      let didUpdateNotePaths = false;
      const hydratedNotes = notesArray.map(([noteId, note]) => {
        try {
          // Prefer markdown, but support legacy htmlRel for backward compatibility.
          const htmlRel = notePaths?.[noteId]?.htmlRel;
          const mdRel = notePaths?.[noteId]?.mdRel;
          // Robust fallback: mdRel might exist but file can be missing (e.g. partial migration).
          const relCandidates = [mdRel, htmlRel].filter(Boolean);
          let fileRel = null;
          let filePath = null;
          for (const rel of relCandidates) {
            const candidatePath = path.join(root, rel);
            if (fs.existsSync(candidatePath)) {
              fileRel = rel;
              filePath = candidatePath;
              break;
            }
          }
          if (filePath && fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const content = (() => {
              // Markdown-first: prefer loading `.md` directly.
              if (mdRel && fileRel === mdRel) return raw;

              // Legacy: if we're reading an `.html` note, convert to markdown so the
              // editor sees stable newlines/blocks.
              if (htmlRel && fileRel === htmlRel) {
                const converted = legacyHtmlToMarkdown(raw);
                if (typeof converted === 'string' && converted.length > 0) {
                  // Best-effort: write a sibling `.md` so future loads don't need conversion.
                  if (!mdRel && /\.html$/i.test(htmlRel)) {
                    const mdRelCandidate = htmlRel.replace(/\.html$/i, '.md');
                    const mdAbs = path.join(root, mdRelCandidate);
                    try {
                      if (!fs.existsSync(mdAbs)) {
                        ensureDir(path.dirname(mdAbs));
                        fs.writeFileSync(mdAbs, converted, 'utf8');
                      }
                      notePaths[noteId] = {
                        ...(notePaths?.[noteId] ?? {}),
                        mdRel: mdRelCandidate,
                      };
                      didUpdateNotePaths = true;
                    } catch {
                      // best-effort; still return converted content
                    }
                  }
                  return converted;
                }
                // Fallback: if conversion fails, keep raw (better than crashing).
                return raw;
              }

              return raw;
            })();
            if (DEBUG_PERSIST) {
              // eslint-disable-next-line no-console
              console.log('[persist:load]', {
                noteId,
                fileRel,
                htmlRel,
                mdRel,
                rawStats: summarizeNewlines(raw),
                contentStats: summarizeNewlines(content),
              });
            }
            return [noteId, { ...note, content }];
          }
        } catch (e) {
          // ignore per-note read errors
        }
        return [noteId, note];
      });

      // If we added mdRel entries during a legacy migration pass, persist them immediately
      // so the app doesn't need to reconvert on every startup.
      if (didUpdateNotePaths) {
        try {
          writeJsonFile(metaPath, { ...rawMeta, notePaths });
        } catch {
          // best-effort
        }
      }

      return { ...rawMeta, notes: hydratedNotes };
    } catch (e) {
      // If anything goes wrong, signal "no state"; the app will
      // simply start from an empty store.
      // eslint-disable-next-line no-console
      console.error('Failed to load persistent state from filesystem:', e);
      return null;
    }
  },
  savePersistentState: (data) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);

      // Persist metadata
      const metaDir = path.join(root, META_DIR_NAME);
      const metaPath = path.join(metaDir, META_FILE_NAME);
      const previousMeta = readJsonFile(metaPath) ?? {};
      const prevNotePaths = previousMeta.notePaths ?? {};

      // Store metadata without duplicating full note contents; the markdown files are the source of truth.
      const notesArray = data.notes ?? [];
      const metaNotes = notesArray.map(([noteId, note]) => {
        if (!note) {
          return [noteId, note];
        }
        // Keep everything except content.
        const { content, ...rest } = note;
        return [noteId, rest];
      });

      // Persist each note as a folder containing <Title>.html and assets/
      const foldersArray = data.folders ?? [];
      const notebooksArray = data.notebooks ?? [];
      const nextNotePaths = { ...(previousMeta.notePaths ?? {}) };
      const activeNoteIds = new Set();

      // Convert markdown -> HTML when persisting to disk.
      // (We still keep markdown in-memory for the editor.)
      const showdown = (() => {
        try {
          return require('showdown');
        } catch {
          return null;
        }
      })();
      const markdownConverter = showdown
        ? new showdown.Converter({
            // best-effort parity with renderer conversion
            tables: true,
            strikethrough: true,
            tasklists: true,
          })
        : null;

      notesArray.forEach(([noteId, note]) => {
        if (!note) {
          return;
        }
        if (note.deleted) {
          // Remove deleted notes from disk if we have a previous path.
          safeRmDir(root, prevNotePaths?.[noteId]?.dirRel);
          delete nextNotePaths[noteId];
          return;
        }
        activeNoteIds.add(noteId);
        const prevDirRel = prevNotePaths?.[noteId]?.dirRel;
        const prevDir = prevDirRel ? path.join(root, prevDirRel) : null;

        const {
          htmlFile: desiredHtmlFile,
          mdFile: desiredMdFile,
          noteDir: desiredNoteDir,
        } = getOrCreateNoteDir(root, foldersArray, notebooksArray, noteId, note);
        let finalNoteDir = desiredNoteDir;
        let finalHtmlFile = desiredHtmlFile;
        let finalMdFile = desiredMdFile;

        if (
          prevDir &&
          fs.existsSync(prevDir) &&
          path.resolve(prevDir) !== path.resolve(desiredNoteDir)
        ) {
          ensureDir(path.dirname(desiredNoteDir));
          const uniqueTarget = ensureUniqueDirPath(desiredNoteDir);
          fs.renameSync(prevDir, uniqueTarget);
          cleanupEmptyDirs(path.dirname(prevDir), root);
          finalNoteDir = uniqueTarget;
          const newDirName = path.basename(uniqueTarget);
          finalHtmlFile = path.join(uniqueTarget, `${newDirName}.html`);
          finalMdFile = path.join(uniqueTarget, `${newDirName}.md`);
        }

        ensureDir(finalNoteDir);
        ensureDir(path.join(finalNoteDir, 'assets'));
        ensureDir(path.dirname(finalHtmlFile));
        const markdown = String(note.content || '');
        const html = markdownConverter
          ? markdownConverter.makeHtml(markdown)
          : markdown;
        if (DEBUG_PERSIST) {
          // eslint-disable-next-line no-console
          console.log('[persist:save]', {
            noteId,
            htmlRel: path.relative(root, finalHtmlFile),
            mdRel: path.relative(root, finalMdFile),
            markdownStats: summarizeNewlines(markdown),
            htmlStats: summarizeNewlines(html),
          });
        }
        fs.writeFileSync(finalMdFile, markdown, 'utf8');
        fs.writeFileSync(finalHtmlFile, html, 'utf8');

        nextNotePaths[noteId] = {
          dirRel: path.relative(root, finalNoteDir),
          htmlRel: path.relative(root, finalHtmlFile),
          mdRel: path.relative(root, finalMdFile),
        };
      });

      // Cleanup notes that disappeared entirely (e.g. deleted forever).
      Object.keys(prevNotePaths).forEach((noteId) => {
        if (!activeNoteIds.has(noteId) && !nextNotePaths[noteId]) {
          safeRmDir(root, prevNotePaths?.[noteId]?.dirRel);
          delete nextNotePaths[noteId];
        }
      });

      writeJsonFile(metaPath, {
        ...data,
        notes: metaNotes,
        notePaths: nextNotePaths,
      });

      // Cleanup empty directories that may remain after moves/deletes.
      cleanupEmptyDirs(path.join(root, META_DIR_NAME), root);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save persistent state to filesystem:', e);
    }
  },
  loadAllRevisions: () => {
    try {
      const root = getNotesRoot();
      const revisionsPath = path.join(root, META_DIR_NAME, REVISIONS_FILE_NAME);
      const data = readJsonFile(revisionsPath);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load revisions from filesystem:', e);
      return [];
    }
  },
  saveNoteRevisions: (noteId, revisions) => {
    try {
      const root = getNotesRoot();
      const revisionsPath = path.join(root, META_DIR_NAME, REVISIONS_FILE_NAME);
      const existing = readJsonFile(revisionsPath) ?? [];
      const map = new Map(existing);
      map.set(noteId, revisions);
      writeJsonFile(revisionsPath, Array.from(map.entries()));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save revisions to filesystem:', e);
    }
  },
  saveNoteAssetFromDataUrl: async ({
    noteId,
    note,
    mimeType,
    dataUrl,
    folders,
    notebooks,
  }) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = notebooks ?? rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;

      // Ensure the note's dirRel is persisted as soon as we create/resolve it so
      // subsequent asset URL resolutions don't depend on a later full persistence pass.
      if (!existingDirRel) {
        try {
          const nextNotePaths = {
            ...notePaths,
            [noteId]: {
              ...(notePaths?.[noteId] ?? {}),
              dirRel: path.relative(root, noteDir),
            },
          };
          writeJsonFile(metaPath, { ...rawMeta, notePaths: nextNotePaths });
        } catch {
          // best-effort
        }
      }

      const assetsDir = path.join(noteDir, 'assets');
      ensureDir(assetsDir);

      // Normalize whitespace in base64 payload (some clipboard sources insert newlines).
      const normalizedDataUrl = (() => {
        const s = String(dataUrl || '');
        if (!s.startsWith('data:image/')) return s;
        const commaIdx = s.indexOf(',');
        if (commaIdx < 0) return s;
        return (
          s.slice(0, commaIdx + 1) + s.slice(commaIdx + 1).replace(/\s+/g, '')
        );
      })();

      // Choose output format: keep JPEGs as JPEG; everything else as PNG.
      const outputIsJpeg = mimeType === 'image/jpeg';
      const ext =
        mimeType === 'image/jpeg'
          ? 'jpg'
          : mimeType === 'image/gif'
            ? 'gif'
            : mimeType === 'image/webp'
              ? 'webp'
              : mimeType === 'image/svg+xml'
                ? 'svg'
                : mimeType === 'image/bmp'
                  ? 'bmp'
                  : mimeType === 'image/tiff'
                    ? 'tiff'
                    : 'png';

      // --- PERFORMANCE OPTIMIZATION ---
      // Try to decode base64 directly and write to disk without nativeImage re-encoding.
      // This avoids the expensive synchronous nativeImage.createFromDataURL() + toPNG()/toJPEG()
      // pipeline which can block the UI for large images.
      const commaIdx = normalizedDataUrl.indexOf(',');
      if (commaIdx > 0) {
        const base64Data = normalizedDataUrl.slice(commaIdx + 1);
        const rawBuffer = Buffer.from(base64Data, 'base64');

        // For small images (< 100KB), skip nativeImage entirely and write directly.
        // For larger images, use nativeImage to resize if needed, but yield to event loop.
        const MAX_DIRECT_WRITE_SIZE = 100 * 1024; // 100KB
        const MAX_IMAGE_DIMENSION = 2048; // Resize if larger than this

        if (rawBuffer.length < MAX_DIRECT_WRITE_SIZE) {
          // Small image: write directly without re-encoding
          const fileName = `pasted-${Date.now()}.${ext}`;
          const filePath = path.join(assetsDir, fileName);
          await fs.promises.writeFile(filePath, rawBuffer);
          const rel = `assets/${fileName}`;
          const fileUrl = toAssetUrl(filePath);
          return { rel, fileUrl };
        }

        // For larger images, yield to event loop before heavy processing
        await new Promise((resolve) => setImmediate(resolve));

        // Decode using Electron-native image pipeline
        const img = nativeImage.createFromDataURL(normalizedDataUrl);
        if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
          // eslint-disable-next-line no-console
          console.error('Failed to save note asset: nativeImage is empty', {
            noteId,
            mimeType,
          });
          return null;
        }

        // Resize large images to improve performance and reduce storage
        const size = img.getSize();
        let finalImg = img;
        if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
          const scale = Math.min(
            MAX_IMAGE_DIMENSION / size.width,
            MAX_IMAGE_DIMENSION / size.height
          );
          const newWidth = Math.round(size.width * scale);
          const newHeight = Math.round(size.height * scale);
          finalImg = img.resize({ width: newWidth, height: newHeight, quality: 'good' });
        }

        // Yield again before encoding
        await new Promise((resolve) => setImmediate(resolve));

        const buffer = outputIsJpeg ? finalImg.toJPEG(85) : finalImg.toPNG();
        const fileName = `pasted-${Date.now()}.${ext}`;
        const filePath = path.join(assetsDir, fileName);
        await fs.promises.writeFile(filePath, buffer);

        const rel = `assets/${fileName}`;
        const fileUrl = toAssetUrl(filePath);
        return { rel, fileUrl };
      }

      // Fallback: original path for edge cases
      const img = nativeImage.createFromDataURL(normalizedDataUrl);
      if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
        // eslint-disable-next-line no-console
        console.error('Failed to save note asset: nativeImage is empty', {
          noteId,
          mimeType,
        });
        return null;
      }

      const buffer = outputIsJpeg ? img.toJPEG(85) : img.toPNG();

      const fileName = `pasted-${Date.now()}.${ext}`;
      const filePath = path.join(assetsDir, fileName);
      await fs.promises.writeFile(filePath, buffer);

      const rel = `assets/${fileName}`;
      const fileUrl = toAssetUrl(filePath);
      return { rel, fileUrl };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save note asset:', e, {
        noteId,
        mimeType,
      });
      return null;
    }
  },
  // PERFORMANCE: New optimized API that accepts raw binary data directly,
  // completely bypassing base64 encoding/decoding overhead.
  saveNoteAssetFromBuffer: async ({
    noteId,
    note,
    mimeType,
    buffer, // ArrayBuffer or Uint8Array from File.arrayBuffer()
    folders,
    notebooks,
  }) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = notebooks ?? rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;

      if (!existingDirRel) {
        try {
          const nextNotePaths = {
            ...notePaths,
            [noteId]: {
              ...(notePaths?.[noteId] ?? {}),
              dirRel: path.relative(root, noteDir),
            },
          };
          writeJsonFile(metaPath, { ...rawMeta, notePaths: nextNotePaths });
        } catch {
          // best-effort
        }
      }

      const assetsDir = path.join(noteDir, 'assets');
      ensureDir(assetsDir);

      const outputIsJpeg = mimeType === 'image/jpeg';
      const ext =
        mimeType === 'image/jpeg'
          ? 'jpg'
          : mimeType === 'image/gif'
            ? 'gif'
            : mimeType === 'image/webp'
              ? 'webp'
              : mimeType === 'image/svg+xml'
                ? 'svg'
                : mimeType === 'image/bmp'
                  ? 'bmp'
                  : mimeType === 'image/tiff'
                    ? 'tiff'
                    : 'png';

      // Convert ArrayBuffer/Uint8Array to Node Buffer
      const nodeBuffer = Buffer.from(buffer);

      // For small images (< 200KB), write directly without any processing
      const MAX_DIRECT_WRITE_SIZE = 200 * 1024;
      const MAX_IMAGE_DIMENSION = 2048;

      if (nodeBuffer.length < MAX_DIRECT_WRITE_SIZE) {
        // Small image: write directly without re-encoding for maximum speed
        const fileName = `pasted-${Date.now()}.${ext}`;
        const filePath = path.join(assetsDir, fileName);
        await fs.promises.writeFile(filePath, nodeBuffer);
        const rel = `assets/${fileName}`;
        const fileUrl = toAssetUrl(filePath);
        return { rel, fileUrl };
      }

      // For larger images, check if resizing is needed
      // Yield to event loop first
      await new Promise((resolve) => setImmediate(resolve));

      const img = nativeImage.createFromBuffer(nodeBuffer);
      if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
        // If nativeImage can't decode, try writing raw buffer anyway
        const fileName = `pasted-${Date.now()}.${ext}`;
        const filePath = path.join(assetsDir, fileName);
        await fs.promises.writeFile(filePath, nodeBuffer);
        const rel = `assets/${fileName}`;
        const fileUrl = toAssetUrl(filePath);
        return { rel, fileUrl };
      }

      // Resize if too large
      const size = img.getSize();
      let finalBuffer = nodeBuffer;
      if (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION) {
        const scale = Math.min(
          MAX_IMAGE_DIMENSION / size.width,
          MAX_IMAGE_DIMENSION / size.height
        );
        const newWidth = Math.round(size.width * scale);
        const newHeight = Math.round(size.height * scale);
        const resized = img.resize({ width: newWidth, height: newHeight, quality: 'good' });

        // Yield before encoding
        await new Promise((resolve) => setImmediate(resolve));

        finalBuffer = outputIsJpeg ? resized.toJPEG(85) : resized.toPNG();
      }

      const fileName = `pasted-${Date.now()}.${ext}`;
      const filePath = path.join(assetsDir, fileName);
      await fs.promises.writeFile(filePath, finalBuffer);

      const rel = `assets/${fileName}`;
      const fileUrl = toAssetUrl(filePath);
      return { rel, fileUrl };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save note asset from buffer:', e, {
        noteId,
        mimeType,
      });
      return null;
    }
  },
  saveNoteAssetFromUrl: async ({ noteId, note, url, folders, notebooks }) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = notebooks ?? rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;

      if (!existingDirRel) {
        try {
          const nextNotePaths = {
            ...notePaths,
            [noteId]: {
              ...(notePaths?.[noteId] ?? {}),
              dirRel: path.relative(root, noteDir),
            },
          };
          writeJsonFile(metaPath, { ...rawMeta, notePaths: nextNotePaths });
        } catch {
          // best-effort
        }
      }
      const assetsDir = path.join(noteDir, 'assets');
      ensureDir(assetsDir);

      const urlStr = String(url || '').trim();
      const isFileUrl = /^file:\/\//i.test(urlStr);
      const isAbsolutePath =
        /^\//.test(urlStr) || /^[a-zA-Z]:[\\/]/.test(urlStr);

      const extFromPath = (p) =>
        String(path.extname(p) || '')
          .replace(/^\./, '')
          .toLowerCase();
      const normalizeExt = (ext) => (ext === 'jpeg' ? 'jpg' : ext);
      const isSupportedImageExt = (ext) =>
        ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);

      // Support local file URLs/paths (common when pasting an image file path from the OS).
      if (isFileUrl || isAbsolutePath) {
        const localPath = isFileUrl ? fileURLToPath(urlStr) : urlStr;
        const extRaw = extFromPath(localPath);
        if (!isSupportedImageExt(extRaw)) return null;
        if (!fs.existsSync(localPath)) return null;

        const buffer = await fs.promises.readFile(localPath);
        const fileName = `pasted-${Date.now()}.${normalizeExt(extRaw)}`;
        const filePath = path.join(assetsDir, fileName);
        await fs.promises.writeFile(filePath, buffer);

        const rel = `assets/${fileName}`;
        const fileUrl = toAssetUrl(filePath);
        return { rel, fileUrl };
      }

      const fetch = require('electron-fetch').default;
      const res = await fetch(urlStr);
      if (!res.ok) return null;

      const contentType =
        (res.headers && res.headers.get && res.headers.get('content-type')) ||
        '';
      const mimeType = String(contentType).split(';')[0].trim();

      const ext =
        mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/jpeg'
            ? 'jpg'
            : mimeType === 'image/gif'
              ? 'gif'
              : mimeType === 'image/webp'
                ? 'webp'
                : 'png';

      const fileName = `pasted-${Date.now()}.${ext}`;
      const filePath = path.join(assetsDir, fileName);

      const buffer = await res.buffer();
      await fs.promises.writeFile(filePath, buffer);

      const rel = `assets/${fileName}`;
      const fileUrl = toAssetUrl(filePath);
      return { rel, fileUrl };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save note asset from url:', e);
      return null;
    }
  },
  resolveNoteAssetFileUrl: ({ noteId, note, folders, notebooks, rel }) => {
    try {
      const root = getNotesRoot();
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = notebooks ?? rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;

      if (!existingDirRel) {
        try {
          const nextNotePaths = {
            ...notePaths,
            [noteId]: {
              ...(notePaths?.[noteId] ?? {}),
              dirRel: path.relative(root, noteDir),
            },
          };
          writeJsonFile(metaPath, { ...rawMeta, notePaths: nextNotePaths });
        } catch {
          // best-effort
        }
      }
      const abs = path.join(noteDir, String(rel || ''));
      return toAssetUrl(abs);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to resolve asset url:', e);
      return null;
    }
  },
  readClipboardImageDataUrl: () => {
    try {
      const img = clipboard.readImage();
      if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
        return null;
      }
      // Electron returns PNG data by default here.
      const dataUrl = img.toDataURL();
      return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')
        ? dataUrl
        : null;
    } catch (e) {
      return null;
    }
  },
  send: (channel, data) => {
    // allowed channels
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, callback) => {
    if (validChannels.includes(channel)) {
      const newCallback = (_, data) => callback(data);
      ipcRenderer.on(channel, newCallback);
    }
  },
  removeListener: (channel) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isWindows: process.platform === 'win32',
  // Window control functions for custom title bar (Windows)
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  setTitleBarOverlay: (overlay) =>
    ipcRenderer.send('window:setTitleBarOverlay', overlay),
  onWindowMaximized: (callback) => {
    const handler = (_, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window:maximized', handler);
    return () => ipcRenderer.removeListener('window:maximized', handler);
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);

module.exports = {
  electronAPI: electronAPI,
};
