# Builtin Managed Skills Migration Notice

All core builtin skills have been migrated to the Local AI Core service layer:
`services/local-ai-core/src/skills/builtin/`

This legacy directory (`electron/managed-skills/`) is retained for backwards compatibility with external scripts and historical test fixtures. The build pipeline (`scripts/copy-managed-skills.mjs`) automatically mirrors assets from `services/local-ai-core/src/skills/builtin/` to both `dist-electron/services/local-ai-core/src/skills/builtin` and `dist-electron/electron/managed-skills`.
