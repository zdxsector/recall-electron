const path = require('path');
const fs = require('fs');
const os = require('os');

// Minimal stubs so preload.js can be required outside Electron.
const fakeIpcRenderer = {
  sendSync: (ch) => {
    if (ch === 'recall:getPath') return os.tmpdir();
    return null;
  },
  send: () => {},
  on: () => {},
  invoke: () => Promise.resolve(false),
  removeListener: () => {},
  removeAllListeners: () => {},
};

// Patch globals before require()
const { contextBridge: _cb, ...rest } = (() => {
  try {
    return require('electron');
  } catch {
    return {};
  }
})();

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: fakeIpcRenderer,
  clipboard: { readImage: () => ({ isEmpty: () => true, toDataURL: () => '' }) },
  nativeImage: { createFromDataURL: () => ({ isEmpty: () => true }) },
}));

jest.mock('sanitize-filename', () => (s) => String(s || '').replace(/[<>:"/\\|?*]+/g, ''));

// Now require — exposeInMainWorld will capture the API object.
const { electronAPI } = require('../preload');

const NOTES_ROOT_NAME = 'Recall';
const META_DIR_NAME = '.recall';
const META_FILE_NAME = 'store.json';

const mkTmpRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-test-'));
  return path.join(dir, NOTES_ROOT_NAME);
};

const writeStoreMeta = (root, data) => {
  const metaDir = path.join(root, META_DIR_NAME);
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(
    path.join(metaDir, META_FILE_NAME),
    JSON.stringify(data, null, 2),
    'utf8'
  );
};

const readStoreMeta = (root) => {
  const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
};

const listNoteDirs = (root) => {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === META_DIR_NAME || entry === 'assets') continue;
      const full = path.join(dir, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      const children = fs.readdirSync(full).filter((c) => c !== 'assets' && c !== META_DIR_NAME);
      const hasFiles = fs.readdirSync(full).some((c) => {
        const fp = path.join(full, c);
        return fs.statSync(fp).isFile();
      });
      if (hasFiles) {
        result.push(path.relative(root, full));
      }
      walk(full);
    }
  };
  walk(root);
  return result;
};

describe('savePersistentState — note folder lifecycle', () => {
  let root;

  beforeEach(() => {
    root = mkTmpRoot();
    // Patch getNotesRoot to use our temp dir
    fakeIpcRenderer.sendSync = (ch) => {
      if (ch === 'recall:getPath') return path.dirname(root);
      return null;
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(root), { recursive: true, force: true });
    } catch {}
  });

  const makeNotePayload = (noteId, content, folderId = 'folder-1') => ({
    accountName: 'test',
    allowAnalytics: null,
    notes: [[noteId, { content, folderId, systemTags: ['markdown'] }]],
    notebooks: [['nb-1', { name: 'Notebook' }]],
    folders: [['folder-1', { name: 'Inbox', notebookId: 'nb-1', parentFolderId: null }]],
    preferences: [],
    cvs: [],
    ghosts: [],
    lastRemoteUpdate: [],
    lastSync: [],
  });

  test('initial save creates exactly one note directory', () => {
    const data = makeNotePayload('note-1', '# My First Note\nSome content');
    electronAPI.savePersistentState(data);

    const meta = readStoreMeta(root);
    expect(meta.notePaths['note-1']).toBeDefined();
    expect(meta.notePaths['note-1'].dirRel).toBe(
      path.join('Notebook', 'Inbox', 'My First Note')
    );

    const mdPath = path.join(root, meta.notePaths['note-1'].mdRel);
    expect(fs.existsSync(mdPath)).toBe(true);
    expect(fs.readFileSync(mdPath, 'utf8')).toBe('# My First Note\nSome content');
  });

  test('re-saving with same title reuses the same directory (no duplicates)', () => {
    const data = makeNotePayload('note-1', '# Stable Title\nBody');
    electronAPI.savePersistentState(data);
    electronAPI.savePersistentState(data);
    electronAPI.savePersistentState(data);

    const allDirs = listNoteDirs(root);
    const noteDirs = allDirs.filter((d) => d.includes('Stable Title'));
    expect(noteDirs.length).toBe(1);
  });

  test('renaming a note title renames the folder, not creating a duplicate', () => {
    // Save with original title
    const data1 = makeNotePayload('note-1', '# Original Title\nBody');
    electronAPI.savePersistentState(data1);

    const meta1 = readStoreMeta(root);
    expect(meta1.notePaths['note-1'].dirRel).toContain('Original Title');

    // Now change the title
    const data2 = makeNotePayload('note-1', '# Renamed Title\nBody');
    electronAPI.savePersistentState(data2);

    const meta2 = readStoreMeta(root);
    expect(meta2.notePaths['note-1'].dirRel).toContain('Renamed Title');

    // The old "Original Title" directory should NOT exist
    const allDirs = listNoteDirs(root);
    const originalDirs = allDirs.filter((d) => d.includes('Original Title'));
    expect(originalDirs).toEqual([]);

    // Only one "Renamed Title" directory should exist (no "(2)" variants)
    const renamedDirs = allDirs.filter((d) => d.includes('Renamed Title'));
    expect(renamedDirs.length).toBe(1);
    expect(renamedDirs[0]).not.toContain('(2)');
  });

  test('renaming removes stale content files from old title', () => {
    const data1 = makeNotePayload('note-1', '# Old Name\nBody');
    electronAPI.savePersistentState(data1);

    const data2 = makeNotePayload('note-1', '# New Name\nBody');
    electronAPI.savePersistentState(data2);

    const meta = readStoreMeta(root);
    const noteDir = path.join(root, meta.notePaths['note-1'].dirRel);

    // New files should exist
    expect(fs.existsSync(path.join(noteDir, 'New Name.md'))).toBe(true);
    expect(fs.existsSync(path.join(noteDir, 'New Name.html'))).toBe(true);

    // Old files should NOT exist
    expect(fs.existsSync(path.join(noteDir, 'Old Name.md'))).toBe(false);
    expect(fs.existsSync(path.join(noteDir, 'Old Name.html'))).toBe(false);
  });

  test('rapid title changes never create more than one directory per note', () => {
    const titles = [
      'Draft',
      'Effective Prompt',
      'Effective Prompts',
      'Claude Effective Prompts',
    ];

    for (const title of titles) {
      const data = makeNotePayload('note-1', `# ${title}\nBody`);
      electronAPI.savePersistentState(data);
    }

    const allDirs = listNoteDirs(root);
    // Only the final title should remain as a directory
    const promptDirs = allDirs.filter(
      (d) =>
        d.includes('Prompt') ||
        d.includes('Draft')
    );
    // Exactly one leaf directory for the note
    expect(promptDirs.length).toBe(1);
    expect(promptDirs[0]).toContain('Claude Effective Prompts');
    expect(promptDirs[0]).not.toContain('(2)');
  });

  test('autosave cycles do not create duplicate directories', () => {
    // Simulate autosave: content changes but title stays the same
    for (let i = 0; i < 10; i++) {
      const data = makeNotePayload(
        'note-1',
        `# My Note\nParagraph ${i}`
      );
      electronAPI.savePersistentState(data);
    }

    const allDirs = listNoteDirs(root);
    const noteDirs = allDirs.filter((d) => d.includes('My Note'));
    expect(noteDirs.length).toBe(1);
    expect(noteDirs[0]).not.toContain('(2)');
  });

  test('two different notes with the same title get separate directories', () => {
    const data = {
      accountName: 'test',
      allowAnalytics: null,
      notes: [
        ['note-1', { content: '# Same Title\nBody A', folderId: 'folder-1', systemTags: ['markdown'] }],
        ['note-2', { content: '# Same Title\nBody B', folderId: 'folder-1', systemTags: ['markdown'] }],
      ],
      notebooks: [['nb-1', { name: 'Notebook' }]],
      folders: [['folder-1', { name: 'Inbox', notebookId: 'nb-1', parentFolderId: null }]],
      preferences: [],
      cvs: [],
      ghosts: [],
      lastRemoteUpdate: [],
      lastSync: [],
    };

    electronAPI.savePersistentState(data);

    const meta = readStoreMeta(root);
    const dir1 = meta.notePaths['note-1'].dirRel;
    const dir2 = meta.notePaths['note-2'].dirRel;
    expect(dir1).not.toBe(dir2);
    expect(fs.existsSync(path.join(root, dir1))).toBe(true);
    expect(fs.existsSync(path.join(root, dir2))).toBe(true);
  });

  test('deleting a note removes its directory', () => {
    const data1 = makeNotePayload('note-1', '# To Delete\nBody');
    electronAPI.savePersistentState(data1);

    const meta1 = readStoreMeta(root);
    const dirRel = meta1.notePaths['note-1'].dirRel;
    expect(fs.existsSync(path.join(root, dirRel))).toBe(true);

    // Delete the note
    const data2 = {
      ...data1,
      notes: [['note-1', { content: '', folderId: 'folder-1', deleted: true, systemTags: ['markdown'] }]],
    };
    electronAPI.savePersistentState(data2);

    expect(fs.existsSync(path.join(root, dirRel))).toBe(false);
    const meta2 = readStoreMeta(root);
    expect(meta2.notePaths['note-1']).toBeUndefined();
  });

  test('orphan empty directories from previous bug are cleaned up on rename', () => {
    // Simulate the state left by the old bug: an orphan empty dir
    const notebookDir = path.join(root, 'Notebook', 'Inbox');
    const orphanDir = path.join(notebookDir, 'Claude Effective Prompts');
    const orphanAssets = path.join(orphanDir, 'assets');
    fs.mkdirSync(orphanAssets, { recursive: true });

    // Previous save stored the note at a different path
    const prevDirRel = path.join('Notebook', 'Inbox', 'Effective Prompt');
    const prevDir = path.join(root, prevDirRel);
    fs.mkdirSync(path.join(prevDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(prevDir, 'Effective Prompt.md'),
      '# Effective Prompt\nOld content',
      'utf8'
    );
    fs.writeFileSync(
      path.join(prevDir, 'Effective Prompt.html'),
      '<h1>Effective Prompt</h1>',
      'utf8'
    );

    // Write store.json with the previous path
    writeStoreMeta(root, {
      accountName: 'test',
      allowAnalytics: null,
      notes: [['note-1', {}]],
      notebooks: [['nb-1', { name: 'Notebook' }]],
      folders: [['folder-1', { name: 'Inbox', notebookId: 'nb-1', parentFolderId: null }]],
      notePaths: {
        'note-1': {
          dirRel: prevDirRel,
          htmlRel: path.join(prevDirRel, 'Effective Prompt.html'),
          mdRel: path.join(prevDirRel, 'Effective Prompt.md'),
        },
      },
      preferences: [],
      cvs: [],
      ghosts: [],
      lastRemoteUpdate: [],
      lastSync: [],
    });

    // Now save with the new title (which matches the orphan dir name)
    const data = makeNotePayload(
      'note-1',
      '# Claude Effective Prompts\nNew content'
    );
    electronAPI.savePersistentState(data);

    const meta = readStoreMeta(root);
    const finalDirRel = meta.notePaths['note-1'].dirRel;

    // Should have landed at the clean path (orphan was removed)
    expect(finalDirRel).toBe(path.join('Notebook', 'Inbox', 'Claude Effective Prompts'));
    expect(finalDirRel).not.toContain('(2)');

    // Old dir should be gone
    expect(fs.existsSync(prevDir)).toBe(false);

    // No duplicate directories
    const allDirs = listNoteDirs(root);
    const promptDirs = allDirs.filter(
      (d) => d.includes('Prompt') || d.includes('prompt')
    );
    expect(promptDirs.length).toBe(1);
  });
});
