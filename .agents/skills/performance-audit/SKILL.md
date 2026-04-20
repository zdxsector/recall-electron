---
name: performance-audit
description: evaluate startup, editor, renderer, and packaging performance in Recall Electron with repo-specific constraints.
---

# Performance audit

Hotspots:

- `desktop/app.js` startup path
- `desktop/preload.js` synchronous bridge work
- `lib/boot.ts` mount path
- `lib/components/muya-editor/`
- `lib/muya/`

Method:

1. State the suspected bottleneck.
2. Identify whether it is main, preload, renderer, or editor-internal.
3. Prefer measured or clearly traceable fixes.
4. Call out tradeoffs in memory, responsiveness, and complexity.
