# Recall for Electron
<img width="1293" height="789" alt="image" src="https://github.com/user-attachments/assets/2e79a848-8eeb-49fa-8952-7e5d7770c5fd" />


Successor of [simplenote](https://github.com/Automattic/simplenote-electron) for **OFFLINE** version.

# What's the diff in here?
- This is using custom muya editor for live preview while editing
- Fully offline version
- Notebook-note folder feature
- Optimized performance

## Running

**Read this first!!** Local development is currently not supported if you don't have an existing account on the test server or access to the production credentials. This is because the move to an email-first signup flow has made it impossible to create accounts in the test database. We hope to be able to support an open-source development workflow again in the future.

1. Clone the repo: `git clone https://github.com/Automattic/recall-electron.git`
2. `cd recall-electron`
3. `pnpm install --no-frozen-lockfile --config.legacy-peer-deps=true`
4. `pnpm dev`
5. The dev server will start on [http://localhost:4000](http://localhost:4000), and the Electron app will launch automatically.
6. For all logging from Electron to be printed to the terminal (e.g. `console.log` statements within `app.js`), you might need to set `env ELECTRON_ENABLE_LOGGING=1`.

_Note: Recall API features such as sharing and publishing will not work with development builds. Due to a limitation of `make`, installation paths used for build cannot have spaces._

## Building

Build a production webpack bundle:

```bash
pnpm build:prod
```

Package for a specific platform:

```bash
pnpm package:mac     # macOS — DMG + ZIP (universal)
pnpm package:win     # Windows — NSIS installer (x86 + x64)
pnpm package:linux   # Linux — AppImage, .deb, .rpm, .tar.gz
```

Each `package:*` command runs `build:prod` automatically before packaging with [electron-builder](https://www.electron.build/).

Artifacts are written to `./release/`.

## Testing

```bash
pnpm test          # unit tests (Jest)
pnpm test:e2e      # Playwright Electron E2E smoke tests
```

## Releasing to Production

### 1. Pre-release checklist

- [ ] All changes are merged to `main`
- [ ] Version bumped in `package.json` (e.g. `pnpm pkg set version="X.Y.Z"`)
- [ ] All tests pass: `pnpm test && pnpm test:e2e`
- [ ] Changelog or release notes drafted

### 2. Platform requirements

#### macOS (code signing + notarization)

1. Install Apple Developer signing certificates in your Keychain
2. Place the App Store Connect API key at:
   ```
   ~/.configure/recall-electron/secrets/app_store_connect_api_key.p8
   ```
3. Set environment variables (or create `~/.a8c-apps/recall-electron.env`):
   ```
   APP_STORE_CONNECT_API_KEY_KEY_ID=<your-key-id>
   APP_STORE_CONNECT_API_KEY_ISSUER_ID=<your-issuer-id>
   ```
4. The `after_sign_hook.js` handles notarization automatically via `@electron/notarize`

#### Windows

- Install `makensis`, `wine`, and `mono`:
  ```bash
  brew install mono wine makensis
  ```
- A valid code-signing certificate is required at the packaging stage

#### Linux

- Install `rpm` for building `.rpm` packages:
  ```bash
  brew install rpm        # macOS
  sudo apt install rpm    # Linux
  ```
- On Linux, also install `icnsutils` for icon conversion:
  ```bash
  sudo apt install --no-install-recommends -y icnsutils
  ```

### 3. Build and package

```bash
git checkout main
git pull origin main
pnpm install --no-frozen-lockfile --config.legacy-peer-deps=true
pnpm test && pnpm test:e2e

# Package for your target platform
pnpm package:mac
pnpm package:win
pnpm package:linux
```

### 4. Release artifacts

After packaging, the `./release/` directory contains:

| Platform | Artifact |
|----------|----------|
| macOS    | `Recall-macOS-{version}.dmg`, `Recall-macOS-{version}.zip` |
| Windows  | `Recall-win-{version}-{arch}.exe` |
| Linux    | `Recall-linux-{version}-{arch}.AppImage`, `.deb`, `.rpm`, `.tar.gz` |

### 5. Web app deploy (optional)

To deploy the web-hosted version:

```bash
pnpm deploy production    # also: staging, develop
```

This builds a production bundle and pushes to the `webapp` branch.

### 6. Post-release

- [ ] Tag the release: `git tag -a vX.Y.Z -m "vX.Y.Z"` and `git push --tags`
- [ ] Create a GitHub Release with the packaged artifacts
- [ ] Verify auto-update works for existing installations

## Dependencies

- [React](https://react.dev/) for UI
- [Electron](https://electronjs.org/) for the desktop shell
- [electron-builder](https://www.electron.build/) for packaging and distribution
- [Playwright](https://playwright.dev/) for E2E testing
