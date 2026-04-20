---
name: renderer-feature-delivery
description: implement renderer-side features in React and Redux without violating Electron boundaries.
---

# Renderer feature delivery

Primary areas:

- `lib/boot.ts`
- `lib/state/`
- feature folders in `lib/`

Workflow:

1. Trace the renderer state owner.
2. Reuse existing component and reducer patterns.
3. Add preload calls only if renderer truly needs native access.
4. Verify with the most relevant `pnpm` command.
