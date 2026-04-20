# Electron Architecture

## Current repository shape

- `desktop/index.js`: main-process bootstrap
- `desktop/app.js`: BrowserWindow lifecycle, menus, protocol registration, updater ping, native theme integration, IPC handlers
- `desktop/preload.js`: context bridge plus offline note/file persistence helpers
- `lib/boot.ts`: renderer bootstrap, Redux store creation, app mount
- `lib/state/`: Redux reducers, middleware, persistence wiring
- `lib/components/` and feature directories: renderer UI and workflows
- `lib/muya/`: vendored editor source and styles
- `desktop/updater/`: auto-update and manual-update orchestration
- `resources/`: release resources, certificates, icons, entitlements

## Boundaries that matter

### Main process

Owns:

- `BrowserWindow` construction and window state
- native menus and shell/dialog access
- deep-link protocol handling
- updater wiring and process lifecycle
- IPC entrypoints exposed to preload or renderer

Avoid:

- embedding renderer business logic
- generic filesystem RPCs without clear ownership

### Preload

Owns:

- narrowly scoped bridge APIs for renderer use
- local note storage and metadata persistence
- clipboard and local asset helpers
- compatibility shims replacing legacy `remote` usage

Avoid:

- exposing raw `ipcRenderer`, `fs`, or unrestricted path access
- accumulating unrelated application logic that belongs in renderer state or services

### Renderer

Owns:

- UI composition and state transitions
- editor workflows, notebook UX, dialogs, search, and settings
- Redux reducers and middleware
- invoking preload APIs through stable bridge methods

Avoid:

- assuming direct Node access
- depending on main-process globals

## Security posture

The repo already uses:

- `contextIsolation: true`
- `nodeIntegration: false`
- navigation blocking
- controlled `setWindowOpenHandler`

Gaps to watch when changing the app:

- sender validation on IPC
- overexposed preload methods
- `shell.openExternal` input trust
- any new remote or embedded web content

## Packaging posture

- electron-builder config is split across standard and AppX JSON files
- macOS uses hardened runtime and entitlements
- Windows builds both NSIS and AppX variants
- Linux targets AppImage, deb, rpm, and tar.gz

Any build or release agent must keep those targets in mind.
