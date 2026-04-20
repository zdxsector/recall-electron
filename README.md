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

- **`make package-osx`**
- **`make package-win32`**
- **`make package-linux`**

## Testing

Unit tests are run with `pnpm test`.

## Dependencies

- [ReactJS](https://reactjs.org/) for UI.
- [Electron](https://electronjs.org/) for wrapping the JavaScript application.
- `rpm` must be installed in order to build Linux packages (`brew install rpm` on OSX).
