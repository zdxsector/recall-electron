# Shared Agent Framework

This directory is the canonical, tool-agnostic AI framework for `recall-electron`.

Structure:

- `project-contract.md`: repo-wide contract every agent must follow
- `architecture/`: project architecture notes rooted in the current codebase
- `agents/`: canonical role definitions
- `skills/`: reusable workflows referenced by both Claude and Codex adapters

Testing policy:

- desktop UI and end-to-end verification should default to Playwright
- Electron app automation should use Playwright's official `_electron` API surface

Adapter rules:

- `.claude/` mirrors these files for Claude Code project subagents
- `.codex/` mirrors these files for Codex agent configs and prompts
- keep the canonical guidance here; adapters should stay thin and execution-oriented
- update this directory first when project knowledge changes
