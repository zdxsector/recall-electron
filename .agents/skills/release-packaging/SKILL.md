---
name: release-packaging
description: manage pnpm scripts, webpack builds, electron-builder packaging, and release prerequisites for Recall Electron.
---

# Release packaging

Read first:

- `README.md`
- `docs/packaging.md`
- `electron-builder.json`
- `electron-builder-appx.json`

Checklist:

- keep scripts `pnpm`-first
- preserve macOS, Windows, and Linux targets
- call out signing, notarization, certificates, and private config requirements
- note when verification cannot be completed locally
