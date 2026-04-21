'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  session,
  nativeTheme,
  screen,
  protocol,
} = require('electron');

// Register custom scheme before app is ready (must be called at module load time).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'recall-asset',
    privileges: {
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true,
      standard: false,
    },
  },
]);

const path = require('path');
const windowStateKeeper = require('electron-window-state');

const config = require('./config');
const createMenuTemplate = require('./menus');
const platform = require('./detect/platform');
const updater = require('./updater');
const { isDev } = require('./env');
const contextMenu = require('./context-menu');

require('module').globalPaths.push(path.resolve(path.join(__dirname)));

module.exports = function main() {
  // Keep a global reference of the window object, if you don't, the window will
  // be closed automatically when the JavaScript object is GCed.
  let mainWindow = null;
  let isAuthenticated;
  let shouldQuit = false;

  // Checks to see if the application was asked to quit instead of just close the window
  // we then use this variable to check if we should quit the app.
  // Important for MacOS so it will quit when pressing CMD+Q
  app.on('before-quit', () => {
    shouldQuit = true;
  });

  // Fixes rendering bug on Linux when sandbox === true (Electron 11.0)
  if (process.platform === 'linux') {
    app.disableHardwareAcceleration();
  }

  // ---------------------------------------------------------------------------
  // IPC helpers for renderer/preload (replaces removed `remote` module).
  // ---------------------------------------------------------------------------
  ipcMain.on('recall:getPath', (event, name) => {
    try {
      // Restrict to the one path we need for note persistence.
      if (name !== 'documents') {
        event.returnValue = null;
        return;
      }
      event.returnValue = app.getPath('documents');
    } catch {
      event.returnValue = null;
    }
  });

  ipcMain.on('recall:showMessageBoxSync', (event, options) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      event.returnValue = dialog.showMessageBoxSync(win, options || {});
    } catch {
      event.returnValue = 0;
    }
  });

  app.on('will-finish-launching', function () {
    setTimeout(updater.ping.bind(updater), config.updater.delay);
    app.on('open-url', function (event, url) {
      event.preventDefault();
      if (url.startsWith('recall://auth')) {
        mainWindow.webContents.send('wpLogin', url);
      } else if (url.startsWith('recall://login')) {
        mainWindow.webContents.send('tokenLogin', url);
      }
    });
  });

  const url =
    isDev && process.env.DEV_SERVER
      ? 'http://localhost:4000' // TODO: find a solution to use host and port based on make config.
      : 'file://' + path.join(__dirname, '..', 'dist', 'index.html');

  const activateWindow = function () {
    // Only allow a single window
    // to be open at any given time
    if (mainWindow) {
      return;
    }

    const mainWindowState = windowStateKeeper({
      defaultWidth: 1024,
      defaultHeight: 768,
    });

    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    // Check if system prefers dark mode for initial window colors
    const prefersDark = nativeTheme.shouldUseDarkColors;

    mainWindow = new BrowserWindow({
      backgroundColor: prefersDark ? '#1c1c1e' : '#fff',
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      minWidth: 370,
      minHeight: 520,
      show: false,
      // macOS: frameless window with traffic lights positioned inside the sidebar
      ...(isMac && {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 20, y: 18 },
      }),
      // Windows: custom title bar with native overlay controls
      ...(isWindows && {
        titleBarStyle: 'hidden',
        titleBarOverlay: {
          color: '#00000000',
          symbolColor: prefersDark ? '#ffffff' : '#1c1c1e',
          height: 40,
        },
      }),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: path.join(__dirname, './preload.js'),
      },
    });

    // and load the index of the app.
    if (typeof mainWindow.loadURL === 'function') {
      mainWindow.loadURL(url);
    } else {
      mainWindow.loadUrl(url);
    }

    contextMenu(mainWindow);

    if (
      'test' !== process.env.NODE_ENV &&
      (isDev || process.argv.includes('--devtools'))
    ) {
      mainWindow.openDevTools({
        mode: 'detach',
      });
    }

    // Configure and set the application menu
    const menuTemplate = createMenuTemplate();
    const appMenu = Menu.buildFromTemplate(menuTemplate, mainWindow);
    Menu.setApplicationMenu(appMenu);

    ipcMain.on('appStateUpdate', function (event, args) {
      const settings = args['settings'] || {};
      isAuthenticated = settings && 'accountName' in settings;
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(createMenuTemplate(args), mainWindow)
      );
      if ('theme' in settings) {
        nativeTheme.themeSource = settings.theme;
        // Update titleBarOverlay symbol color when theme changes (Windows only)
        // Background is transparent, so only symbol color needs updating
        if (
          isWindows &&
          mainWindow &&
          typeof mainWindow.setTitleBarOverlay === 'function'
        ) {
          try {
            // Determine isDark based on theme setting directly, since
            // nativeTheme.shouldUseDarkColors may not update immediately
            let isDark;
            if (settings.theme === 'light') {
              isDark = false;
            } else if (settings.theme === 'dark') {
              isDark = true;
            } else {
              // 'system' - follow system preference
              isDark = nativeTheme.shouldUseDarkColors;
            }
            mainWindow.setTitleBarOverlay({
              symbolColor: isDark ? '#ffffff' : '#1c1c1e',
            });
          } catch {
            // ignore
          }
        }
      }
    });

    ipcMain.on('clearCookies', function () {
      // Removes any cookies stored in the app. We're particularly interested in
      // removing the WordPress.com cookies that may have been set during sign in.
      (async () => {
        try {
          const cookies = await session.defaultSession.cookies.get({});
          await Promise.all(
            cookies.map((cookie) => {
              // Reconstruct the url to pass to cookies.remove
              const protocol = cookie.secure ? 'https://' : 'http://';
              const host =
                cookie.domain && cookie.domain.charAt(0) === '.'
                  ? `www${cookie.domain}`
                  : cookie.domain;
              const cookieUrl = `${protocol}${host}${cookie.path || '/'}`;
              return session.defaultSession.cookies.remove(cookieUrl, cookie.name);
            })
          );
        } catch {
          // ignore
        }

        try {
          mainWindow && mainWindow.reload();
        } catch {
          // ignore
        }
      })();
    });

    ipcMain.on('setAutoHideMenuBar', function (event, autoHideMenuBar) {
      mainWindow.setAutoHideMenuBar(autoHideMenuBar || false);
      mainWindow.setMenuBarVisibility(!autoHideMenuBar);
    });

    // Backwards-compatible no-op for old renderer builds that call this.
    // When using a fully custom frameless title bar, Windows titleBarOverlay is not used.
    ipcMain.on('window:setTitleBarOverlay', function (event, overlay) {
      try {
        if (
          process.platform !== 'win32' ||
          !mainWindow ||
          typeof mainWindow.setTitleBarOverlay !== 'function'
        ) {
          return;
        }

        const next = {};
        if (overlay && typeof overlay === 'object') {
          if (typeof overlay.color === 'string' && overlay.color.trim()) {
            next.color = overlay.color.trim();
          }
          if (
            typeof overlay.symbolColor === 'string' &&
            overlay.symbolColor.trim()
          ) {
            next.symbolColor = overlay.symbolColor.trim();
          }
          if (Number.isFinite(overlay.height)) {
            // Clamp to a sensible range.
            next.height = Math.max(24, Math.min(80, Math.round(overlay.height)));
          }
        }

        if (Object.keys(next).length > 0) {
          mainWindow.setTitleBarOverlay(next);
        }
      } catch {
        // ignore
      }
    });

    // Window control handlers for custom title bar (Windows)
    // Use the sender's BrowserWindow instead of the captured `mainWindow` reference.
    // This avoids "click does nothing" issues if the reference is stale or if multiple windows exist.
    ipcMain.on('window:minimize', (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        win && win.minimize();
      } catch {
        // ignore
      }
    });

    ipcMain.on('window:maximize', (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      } catch {
        // ignore
      }
    });

    ipcMain.on('window:close', (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        win && win.close();
      } catch {
        // ignore
      }
    });

    ipcMain.handle('window:isMaximized', (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win ? win.isMaximized() : false;
      } catch {
        return false;
      }
    });

    // Notify renderer when window maximize state changes
    if (mainWindow) {
      mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window:maximized', true);
      });
      mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window:maximized', false);
      });
    }

    // Update titleBarOverlay symbol color when system theme changes (Windows only)
    // Background is transparent, so only symbol color needs updating
    if (isWindows) {
      nativeTheme.on('updated', () => {
        if (mainWindow && typeof mainWindow.setTitleBarOverlay === 'function') {
          try {
            const isDark = nativeTheme.shouldUseDarkColors;
            mainWindow.setTitleBarOverlay({
              symbolColor: isDark ? '#ffffff' : '#1c1c1e',
            });
          } catch {
            // ignore
          }
        }
      });
    }

    ipcMain.on('wpLogin', function (event, wpLoginUrl) {
      shell.openExternal(wpLoginUrl);
    });

    ipcMain.on('importNotes', function (event, filePath) {
      const importNotes = require('./evernote-import');
      importNotes(filePath, mainWindow);
    });

    ipcMain.on('reload', function () {
      mainWindow.reload();
    });

    mainWindowState.manage(mainWindow);

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    // Disables navigation for app window drag and drop
    mainWindow.webContents.on('will-navigate', (event) =>
      event.preventDefault()
    );

    // Fullscreen should be disabled on launch
    if (platform.isOSX()) {
      mainWindow.on('close', () => {
        mainWindow.setFullScreen(false);
      });
    } else {
      mainWindow.setFullScreen(false);
    }

    // When we receive a close event prevent the window from closing and
    // tell the app to check for unsynchronized notes.
    mainWindow.on('close', (event) => {
      if (isAuthenticated) {
        event.preventDefault();
        mainWindow.webContents.send('appCommand', { action: 'closeWindow' });
      }
    });

    // Once the app has dealt with unsynchronized notes close the window.
    // If we are on OSX do not close the app. All other OS's close the app.
    ipcMain.on('reallyCloseWindow', () => {
      // On OSX we potentially have an ipc listerner that does not have a mainWindow.
      mainWindow && mainWindow.destroy();
      if (!platform.isOSX() || shouldQuit) {
        app.exit(0);
      }
      shouldQuit = false;
    });

    // Emitted when the window is closed.
    mainWindow.on('closed', function () {
      // Dereference the window object, usually you would store windows
      // in an array if your app supports multi windows, this is the time
      // when you should delete the corresponding element.
      mainWindow = null;
    });

    // wait until window is presentable
    mainWindow.once('ready-to-show', mainWindow.show);
  };

  const gotTheLock = app.requestSingleInstanceLock();

  app.on('second-instance', (e, argv) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    if (process.platform === 'darwin') {
      // macOS communicates deep-linking via the `open-url` event (see above)
      // but we might still end up with this message so ignore it if we do
      return;
    }
    // Protocol handler for platforms other than macOS
    // argv: An array of the second instance’s (command line / deep linked) arguments
    // The last index of argv is the full deeplink url (recall://SOME_URL)
    if (argv[argv.length - 1].startsWith('recall://auth')) {
      mainWindow.webContents.send('wpLogin', argv[argv.length - 1]);
    } else if (argv[argv.length - 1].startsWith('recall://login')) {
      mainWindow.webContents.send('tokenLogin', argv[argv.length - 1]);
    }
  });

  if (!gotTheLock) {
    return app.quit();
  }

  if (!app.isDefaultProtocolClient('recall')) {
    // Define custom protocol handler. This allows for deeplinking into the app from recall://
    app.setAsDefaultProtocolClient('recall');
  }

  // Quit when all windows are closed.
  app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('browser-window-created', function (event, window) {
    window.webContents.on('did-finish-load', () => {
      // Disable drag and drop operations on the window
      window.webContents.executeJavaScript(
        "document.addEventListener('dragover', event => event.preventDefault());"
      );
      window.webContents.executeJavaScript(
        "document.addEventListener('drop', event => event.preventDefault());"
      );
    });
  });

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  app.on('ready', activateWindow);
  app.on('ready', () => app.setAppUserModelId('com.automattic.recall'));
  app.on('ready', () => {
    const fs = require('fs');
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
    };
    protocol.handle('recall-asset', async (request) => {
      const filePath = decodeURIComponent(
        request.url.slice('recall-asset://'.length)
      );
      try {
        const data = await fs.promises.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        return new Response(data, {
          headers: { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
  });
  app.on('activate', activateWindow);
};
