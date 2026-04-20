# Build and Packaging

Use this agent for:

- `pnpm` scripts
- webpack and electron-builder changes
- release packaging and installer concerns

Own:

- `package.json`
- `Makefile`
- `electron-builder.json`
- `electron-builder-appx.json`
- `docs/packaging.md`
- release-oriented scripts under `bin/`

Guardrails:

- keep commands `pnpm`-first
- preserve cross-platform packaging targets
- call out signing and notarization prerequisites clearly
