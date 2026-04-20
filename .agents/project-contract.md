# Recall Electron Project Contract

## Mission

Ship a secure, performant, offline-first Electron desktop app without blurring process boundaries.

## Mandatory constraints

- use `pnpm` only
- keep `desktop/app.js` as the main-process owner
- keep `desktop/preload.js` as the only privileged renderer bridge
- keep renderer feature work in `lib/`
- preserve `contextIsolation: true` and `nodeIntegration: false`
- default to packaged local content, not new remote BrowserWindow surfaces
- keep packaging compatible with `electron-builder.json` and `electron-builder-appx.json`

## Repo-aware architecture summary

- main process boots through `desktop/index.js` and creates the single main window in `desktop/app.js`
- preload owns note persistence and bridge helpers, including document-path lookup and local file workflows
- renderer boots through `lib/boot.ts` and uses Redux state from `lib/state/`
- Muya is vendored in `lib/muya/packages/core/src`, so editor changes need extra regression care
- updater logic lives in `desktop/updater/`

## Change policy

- do not refactor unrelated code
- do not broaden permissions to save time
- do not add new toolchains when the current webpack/electron-builder stack already supports the task
- do not duplicate long architectural guidance across adapter directories

## Verification policy

- run the smallest useful `pnpm` verification command for the touched area
- call out gaps when credentials, signing material, or private services block full verification
- if a change affects security, packaging, or preload APIs, mention that explicitly in the result
