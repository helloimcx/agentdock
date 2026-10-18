# Builtin Managed Skills Migration Notice

All core builtin skills have been migrated to the AgentDock Daemon service layer:
`apps/daemon/src/skills/builtin/`

This legacy directory (`apps/desktop/managed-skills/`) is retained for backwards compatibility with external scripts and historical test fixtures. The build pipeline (`scripts/copy-managed-skills.mjs`) automatically mirrors assets from `apps/daemon/src/skills/builtin/` to `dist-electron/apps/daemon/src/skills/builtin`, `dist-electron/apps/desktop/managed-skills`, and legacy shims.
