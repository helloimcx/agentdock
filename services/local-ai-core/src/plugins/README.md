# Local AI Core Plugin Layout

Built-in plugins for `services/local-ai-core` live in this folder.

Conventions:

- Use one folder or file per plugin.
- Keep plugin ids lowercase and dotted, for example `channel.lark` or `agent.opencode`.
- Put shared kernel code in `../kernel/`, not here.
- Keep dynamic loading out of this folder until static registration is stable.
- Prefer grouping built-ins under `builtin/` before adding external plugin sources.
