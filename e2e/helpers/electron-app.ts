import type { ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const NOTES_ROOT_NAME = 'Recall';
const META_DIR_NAME = '.recall';
const META_FILE_NAME = 'store.json';

type LaunchOptions = {
  env?: Record<string, string>;
  seedLockedNotes?: boolean;
  seedNotes?: boolean;
  settleMs?: number;
};

export type IsolatedElectronApp = {
  electronApp: ElectronApplication;
  window: Page;
  tempRoot: string;
  documentsPath: string;
  notesRoot: string;
};

const writeJsonFile = (filePath: string, data: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const mockEncryptedContent = (content: string) =>
  `mock:${Buffer.from(content, 'utf8').toString('base64')}`;

const seedPersistentNotes = (
  notesRoot: string,
  { seedLockedNotes = false }: { seedLockedNotes?: boolean } = {}
) => {
  const noteDirRel = path.join('E2ENotebook', 'E2ESeed', 'Find Bar Seed');
  const mdRel = path.join(noteDirRel, 'Find Bar Seed.md');
  const htmlRel = path.join(noteDirRel, 'Find Bar Seed.html');
  const content = [
    '# Alpha',
    '',
    ...Array.from({ length: 120 }, () => 'e'),
  ].join('\n\n');

  fs.mkdirSync(path.join(notesRoot, noteDirRel, 'assets'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(notesRoot, mdRel), content, 'utf8');
  fs.writeFileSync(
    path.join(notesRoot, htmlRel),
    `<h1>Alpha</h1>${Array.from({ length: 120 }, () => '<p>e</p>').join('')}`,
    'utf8'
  );

  const notes: any[] = [
    [
      'e2e-seed-note',
      {
        creationDate: 1_700_000_000,
        modificationDate: 1_700_000_000,
        deleted: false,
        publishURL: '',
        shareURL: '',
        systemTags: ['markdown'],
        tags: [],
        folderId: 'e2e-seed-folder',
      },
    ],
  ];
  const notePaths: Record<
    string,
    { dirRel: string; mdRel: string; htmlRel: string }
  > = {
    'e2e-seed-note': {
      dirRel: noteDirRel,
      mdRel,
      htmlRel,
    },
  };

  if (seedLockedNotes) {
    const lockedNotes = [
      {
        id: 'e2e-locked-note',
        title: 'Locked QA Secret',
        content: '# Locked QA Secret\n\nMock unlocked secret body',
        created: 1_700_000_100,
      },
      {
        id: 'e2e-second-locked-note',
        title: 'Second Locked QA',
        content: '# Second Locked QA\n\nSecond mock unlocked secret body',
        created: 1_700_000_200,
      },
    ];

    for (const lockedNote of lockedNotes) {
      const dirRel = path.join('E2ENotebook', 'E2ESeed', lockedNote.title);
      const lockedMdRel = path.join(dirRel, `${lockedNote.title}.md`);
      const lockedHtmlRel = path.join(dirRel, `${lockedNote.title}.html`);
      const placeholder = `# ${lockedNote.title}\n\nLocked`;
      fs.mkdirSync(path.join(notesRoot, dirRel, 'assets'), {
        recursive: true,
      });
      fs.writeFileSync(path.join(notesRoot, lockedMdRel), placeholder, 'utf8');
      fs.writeFileSync(
        path.join(notesRoot, lockedHtmlRel),
        `<h1>${lockedNote.title}</h1><p>Locked</p>`,
        'utf8'
      );
      notes.push([
        lockedNote.id,
        {
          creationDate: lockedNote.created,
          modificationDate: lockedNote.created,
          deleted: false,
          publishURL: '',
          shareURL: '',
          systemTags: ['markdown'],
          tags: [],
          folderId: 'e2e-seed-folder',
          locked: {
            encryptedContent: mockEncryptedContent(lockedNote.content),
            previewTitle: lockedNote.title,
            lockedAt: lockedNote.created,
            updatedAt: lockedNote.created,
            encryptionVersion: 1,
          },
        },
      ]);
      notePaths[lockedNote.id] = {
        dirRel,
        mdRel: lockedMdRel,
        htmlRel: lockedHtmlRel,
      };
    }
  }

  writeJsonFile(path.join(notesRoot, META_DIR_NAME, META_FILE_NAME), {
    accountName: null,
    allowAnalytics: null,
    notes,
    notebooks: [['e2e-seed-notebook', { name: 'E2ENotebook', index: 0 }]],
    folders: [
      [
        'e2e-seed-folder',
        {
          name: 'E2ESeed',
          notebookId: 'e2e-seed-notebook',
          parentFolderId: null,
          index: 0,
        },
      ],
    ],
    preferences: [],
    cvs: [],
    ghosts: [],
    lastRemoteUpdate: [],
    lastSync: [],
    notePaths,
  });
};

export const launchIsolatedElectronApp = async ({
  env = {},
  seedLockedNotes = false,
  seedNotes = true,
  settleMs = 0,
}: LaunchOptions = {}): Promise<IsolatedElectronApp> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-e2e-'));
  const documentsPath = path.join(tempRoot, 'Documents');
  const notesRoot = path.join(documentsPath, NOTES_ROOT_NAME);
  const userDataPath = path.join(tempRoot, 'UserData');

  fs.mkdirSync(documentsPath, { recursive: true });
  fs.mkdirSync(userDataPath, { recursive: true });
  if (seedNotes) {
    seedPersistentNotes(notesRoot, { seedLockedNotes });
  }

  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'desktop', 'index.js')],
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      RECALL_E2E_DOCUMENTS_PATH: documentsPath,
      RECALL_E2E_USER_DATA_PATH: userDataPath,
      ...env,
    },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.locator('.recall-app').waitFor({ timeout: 15_000 });
  if (settleMs > 0) {
    await window.waitForTimeout(settleMs);
  }

  return {
    electronApp,
    window,
    tempRoot,
    documentsPath,
    notesRoot,
  };
};

export const closeIsolatedElectronApp = async (
  appContext: IsolatedElectronApp | undefined
) => {
  if (!appContext) {
    return;
  }

  try {
    await appContext.electronApp.close();
  } catch {
    try {
      appContext.electronApp.process().kill('SIGKILL');
    } catch {
      // already closed
    }
  }

  fs.rmSync(appContext.tempRoot, { recursive: true, force: true });
};
