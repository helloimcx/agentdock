# Pi Agent

Pi Agent adds a built-in coding agent runtime for local ACP sessions.

## Goal

`agent.type = "pi"` should work without installing Claude Code, Codex, opencode,
or another external coding agent CLI. AgentDock bundles the Pi coding agent and
starts it through the existing Local AI Core ACP session runtime.

This does not bundle model credentials. Users still need to provide an API key
or log in through Pi's own authentication flow.

## Architecture

Local AI Core keeps using the existing ACP stdio transport:

- The workspace route starts the bundled `pi-acp` adapter with Node.
- The route sets `PI_ACP_PI_COMMAND` to the bundled
  `@mariozechner/pi-coding-agent` `pi` binary.
- `pi-acp` starts Pi in RPC mode and translates between ACP JSON-RPC and Pi's
  JSONL RPC protocol.
- Existing AgentDock thread storage, streaming, tool-call rendering,
  cancellation, and approval flows remain owned by Local AI Core.

The intended project config shape is:

```toml
[[projects]]
name = "my-workspace"

[projects.agent]
type = "pi"
```

## Credentials

AgentDock can pass credentials to Pi from project provider settings:

- `providers[].env` is forwarded as environment variables.
- Common `providers[].api_key` values are mapped to Pi-supported provider env
  names such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, and `MINIMAX_API_KEY`.
- Explicit project `agent.options.env` takes final precedence.

Pi also supports its own auth file at `~/.pi/agent/auth.json` and interactive
login through `pi /login`.

## V1 Boundaries

- Do not fork `pi-acp`.
- Do not reimplement Pi RPC inside AgentDock.
- Do not add a dedicated Pi login UI yet.
- Do not treat bundled runtime availability as model readiness; missing
  credentials should surface as runtime/session startup feedback.
