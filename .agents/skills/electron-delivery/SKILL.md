---
name: electron-delivery
description: deliver secure Electron features in this repository while respecting main, preload, renderer, and packaging boundaries.
---

# Electron delivery

Read first:

- `AGENTS.md`
- `.agents/project-contract.md`
- `.agents/architecture/electron-architecture.md`

Workflow:

1. Identify whether the task belongs to main, preload, renderer, or packaging.
2. Keep the change inside the owning layer unless a boundary change is required.
3. If the boundary changes, document why.
4. Verify with the smallest relevant `pnpm` command.

Checklist:

- `pnpm` commands only
- Electron security defaults preserved
- no generic bridge widening
- docs updated when workflow changes
