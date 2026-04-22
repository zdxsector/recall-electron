import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const NOTES_ROOT_NAME = 'Recall';
const META_DIR_NAME = '.recall';
const META_FILE_NAME = 'store.json';

let electronApp: ElectronApplication;
let window: Page;
let notesRoot: string;

const readStoreMeta = () => {
  const metaPath = path.join(notesRoot, META_DIR_NAME, META_FILE_NAME);
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
};

const listNoteDirsUnder = (baseDir: string): string[] => {
  const result: string[] = [];
  if (!fs.existsSync(baseDir)) return result;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d)) {
      if (entry === META_DIR_NAME || entry === 'assets') continue;
      const full = path.join(d, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      const hasContentFiles = fs.readdirSync(full).some(
        (c) => c.endsWith('.md') || c.endsWith('.html')
      );
      if (hasContentFiles) result.push(path.relative(baseDir, full));
      walk(full);
    }
  };
  walk(baseDir);
  return result;
};

test.describe('note persistence — folder lifecycle (E2E via preload bridge)', () => {
  test.beforeAll(async () => {
    const docs = path.join(os.homedir(), 'Documents');
    notesRoot = path.join(docs, NOTES_ROOT_NAME);

    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'desktop', 'index.js')],
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('.recall-app').waitFor({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    if (electronApp) {
      try {
        electronApp.process().kill('SIGKILL');
      } catch {}
    }
  });

  const makePayload = (
    noteId: string,
    content: string,
    folderId = 'e2e-folder-1'
  ) => ({
    accountName: 'e2e-test',
    allowAnalytics: null,
    notes: [[noteId, { content, folderId, systemTags: ['markdown'] }]],
    notebooks: [['e2e-nb-1', { name: 'E2ENotebook' }]],
    folders: [
      [folderId, { name: 'E2EFolder', notebookId: 'e2e-nb-1', parentFolderId: null }],
    ],
    preferences: [],
    cvs: [],
    ghosts: [],
    lastRemoteUpdate: [],
    lastSync: [],
  });

  const callSave = async (payload: any) => {
    await window.evaluate((data) => {
      (window as any).electron.savePersistentState(data);
    }, payload);
  };

  test('initial save creates exactly one note folder', async () => {
    const ts = Date.now();
    const title = `E2E_Init_${ts}`;
    const payload = makePayload(`e2e-init-${ts}`, `# ${title}\nBody`);
    await callSave(payload);

    const dirs = listNoteDirsUnder(notesRoot);
    const matching = dirs.filter((d) => d.includes(title));
    expect(matching.length).toBe(1);
    expect(matching[0]).not.toContain('(2)');
  });

  test('re-saving with same title reuses directory (no duplicates)', async () => {
    const ts = Date.now();
    const noteId = `e2e-resave-${ts}`;
    const title = `E2E_Resave_${ts}`;

    for (let i = 0; i < 5; i++) {
      await callSave(makePayload(noteId, `# ${title}\nRevision ${i}`));
    }

    const dirs = listNoteDirsUnder(notesRoot);
    const matching = dirs.filter((d) => d.includes(title));
    expect(matching.length).toBe(1);
    expect(matching[0]).not.toContain('(2)');
  });

  test('renaming a note renames the folder without leaving orphan dirs', async () => {
    const ts = Date.now();
    const noteId = `e2e-rename-${ts}`;
    const oldTitle = `E2E_OldName_${ts}`;
    const newTitle = `E2E_NewName_${ts}`;

    // Save with old title
    await callSave(makePayload(noteId, `# ${oldTitle}\nBody`));
    let dirs = listNoteDirsUnder(notesRoot);
    expect(dirs.some((d) => d.includes(oldTitle))).toBe(true);

    // Save with new title
    await callSave(makePayload(noteId, `# ${newTitle}\nBody`));
    dirs = listNoteDirsUnder(notesRoot);

    const oldDirs = dirs.filter((d) => d.includes(oldTitle));
    const newDirs = dirs.filter((d) => d.includes(newTitle));
    expect(oldDirs.length).toBe(0);
    expect(newDirs.length).toBe(1);
    expect(newDirs[0]).not.toContain('(2)');

    // Verify no stale files from old name inside the renamed dir
    const meta = readStoreMeta();
    const dirRel = meta?.notePaths?.[noteId]?.dirRel;
    if (dirRel) {
      const noteDir = path.join(notesRoot, dirRel);
      const files = fs.readdirSync(noteDir).filter(
        (f: string) => f.endsWith('.md') || f.endsWith('.html')
      );
      for (const f of files) {
        expect(f).not.toContain(oldTitle.replace('# ', ''));
      }
    }
  });

  test('rapid title changes produce exactly one final directory', async () => {
    const ts = Date.now();
    const noteId = `e2e-rapid-${ts}`;
    const titles = [
      `E2E_Draft_${ts}`,
      `E2E_EffPrompt_${ts}`,
      `E2E_EffPrompts_${ts}`,
      `E2E_ClaudeEffPrompts_${ts}`,
    ];

    for (const title of titles) {
      await callSave(makePayload(noteId, `# ${title}\nBody`));
    }

    const dirs = listNoteDirsUnder(notesRoot);
    const allTestDirs = dirs.filter((d) => d.includes(`_${ts}`));
    expect(allTestDirs.length).toBe(1);
    expect(allTestDirs[0]).toContain(titles[titles.length - 1]);
    expect(allTestDirs[0]).not.toContain('(2)');
  });

  test('autosave cycles with stable title never create duplicates', async () => {
    const ts = Date.now();
    const noteId = `e2e-autosave-${ts}`;
    const title = `E2E_AutoSave_${ts}`;

    for (let i = 0; i < 10; i++) {
      await callSave(makePayload(noteId, `# ${title}\nParagraph ${i}`));
    }

    const dirs = listNoteDirsUnder(notesRoot);
    const matching = dirs.filter((d) => d.includes(title));
    expect(matching.length).toBe(1);
    expect(matching[0]).not.toContain('(2)');
  });

  test('deleting a note removes its directory from disk', async () => {
    const ts = Date.now();
    const noteId = `e2e-delete-${ts}`;
    const title = `E2E_ToDelete_${ts}`;

    await callSave(makePayload(noteId, `# ${title}\nBody`));
    let dirs = listNoteDirsUnder(notesRoot);
    expect(dirs.some((d) => d.includes(title))).toBe(true);

    // Delete: set deleted flag
    const deletePayload = makePayload(noteId, '');
    (deletePayload.notes[0][1] as any).deleted = true;
    await callSave(deletePayload);

    dirs = listNoteDirsUnder(notesRoot);
    expect(dirs.filter((d) => d.includes(title)).length).toBe(0);
  });

  test('orphan empty dirs from previous bug are cleaned up during rename', async () => {
    const ts = Date.now();
    const noteId = `e2e-orphan-${ts}`;
    const oldTitle = `E2E_OrphanOld_${ts}`;
    const newTitle = `E2E_OrphanNew_${ts}`;

    // Save with old title first
    await callSave(makePayload(noteId, `# ${oldTitle}\nBody`));

    // Simulate an orphan: manually create an empty dir at the new title path
    const meta = readStoreMeta();
    const oldDirRel = meta?.notePaths?.[noteId]?.dirRel;
    expect(oldDirRel).toBeTruthy();
    const parentDir = path.dirname(path.join(notesRoot, oldDirRel));
    const orphanDir = path.join(parentDir, newTitle);
    fs.mkdirSync(path.join(orphanDir, 'assets'), { recursive: true });
    expect(fs.existsSync(orphanDir)).toBe(true);

    // Now save with new title — should clean up the orphan and rename cleanly
    await callSave(makePayload(noteId, `# ${newTitle}\nBody`));

    const dirs = listNoteDirsUnder(notesRoot);
    const matching = dirs.filter((d) => d.includes(newTitle));
    expect(matching.length).toBe(1);
    expect(matching[0]).not.toContain('(2)');

    // Old title dir should be gone
    expect(dirs.filter((d) => d.includes(oldTitle)).length).toBe(0);
  });

  test('store.json notePaths for test notes have no (N) suffixes', async () => {
    const meta = readStoreMeta();
    if (!meta?.notePaths) return;

    const e2eEntries = Object.entries(meta.notePaths).filter(
      ([key]: [string, any]) => key.startsWith('e2e-')
    );

    for (const [noteId, paths] of e2eEntries as [string, any][]) {
      if (paths.dirRel) {
        expect(paths.dirRel).not.toMatch(/\(\d+\)/);
      }
    }
  });
});
