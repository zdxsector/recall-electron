---
name: ipc-security-review
description: review or design preload and IPC changes for least privilege, sender trust, and Electron security best practices.
---

# IPC security review

Focus files:

- `desktop/preload.js`
- `desktop/app.js`

Review for:

- narrow bridge APIs
- payload validation
- sender validation where applicable
- avoidance of raw Electron and Node exposure
- trusted handling of URLs, paths, and shell operations

Required output:

- current risk
- proposed fix or approval
- regression surface
