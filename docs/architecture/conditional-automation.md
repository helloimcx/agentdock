# Conditional Automation Architecture

Conditional Automation is the Local AI Core-owned model that unifies scheduled checks and provider monitors while keeping each runtime responsibility narrow:

`Activation → Condition → Action → Delivery`

- Activation decides when a check is due (`cron`, `once`, `interval`, or `provider-event`).
- Condition evaluates `always`, a restricted expression, or an approved script.
- Action starts an Agent prompt only after a rising-edge match.
- Delivery reuses the existing local, Lark, and Weixin thread/bridge paths.

The renderer, CLI, channel commands, and agents request operations through the Core API. They do not own scheduling, approval state, script files, evaluation state, action runs, or delivery routes.

## Runtime ownership and state

The Automation trigger engine admits due checks and restart catch-up. The condition engine evaluates and persists an Evaluation. The action executor creates a separate Automation Run, and delivery uses the existing scheduled bridge. An Evaluation succeeding never implies that its Agent Run or channel delivery succeeded.

Successful protocol output may replace `previousState`; failed, timed-out, malformed, or blocked evaluations preserve the last successful state and match value. Only a `false → true` transition triggers an action. A persistent `true` does not retrigger until a successful `false` rearms it.

Evaluation records are retained for 30 days and at most the latest 1000 records per Automation. Latest successful condition state, Automation Runs, approvals, and security audit records are not deleted with Evaluation history.

## Script package, protocol, and approval

An agent submits a staged text bundle. Local AI Core creates an immutable package, hashes the complete package, resolves the shebang interpreter, and records its absolute path and version. A script is an artifact, not a dynamically loaded plugin or Skill.

Script activation uses two-stage approval bound to the same immutable hash and permission snapshot:

1. The user grants a one-use test authorization after reviewing code, capabilities, secrets by logical name, and the test plan.
2. The sandbox records an immutable test report. The user then grants formal enable approval for that exact tested version.

Any package, manifest, permission, secret reference, interpreter, or test-plan change requires a new version and both approvals. Revoked or mismatched versions block their Automations.

Each execution receives exactly one JSON document on stdin with protocol version, evaluation ID, activation time, config, and `previousState`. Stdout must contain exactly one JSON result with a boolean match and optional summary, payload, and next state; diagnostics belong on stderr. Time, stdout, stderr, payload, and state are bounded and sanitized before persistence. Secret values are resolved from declared `env://` references into one child-process environment and are never persisted or emitted.

## Sandbox and network policy

Approved scripts run only through the pinned Anthropic Sandbox Runtime adapter. The package is read-only, each evaluation receives an isolated temporary write directory, and Local AI Core data, the workspace, home directories, and local sockets are denied by default. Sandbox capability loss blocks script-backed Automations; there is no unsandboxed fallback.

The default network policy permits public egress because condition scripts commonly query external APIs. A private-address deny blocks loopback, RFC 1918, link-local, metadata endpoints, and local Unix sockets. Restricted mode additionally applies approved destination patterns. Audit records contain only sanitized destination host, port, allow/deny decision, and timestamp—never URLs with credentials/query strings, headers, bodies, or secrets.

macOS and Linux share the same protocol, approvals, and policy. macOS requires Sandbox Runtime, `sandbox-exec`, and `rg`. Linux requires Sandbox Runtime, Bubblewrap, `socat`, `rg`, usable user and network namespaces, and seccomp. Windows script execution is unsupported and remains Windows fail-closed; non-script `always` and expression Automations can continue.

## Compatibility ownership

The unified Automation API is the only new write model. The legacy Scheduler and Monitor facades remain compatibility adapters: Scheduler maps time activations to `always`, while Monitor maps provider events to expressions. Existing CLI and API consumers keep their surface during migration, but cannot use a legacy facade to bypass script approval.

The older monitor and scheduled-delivery services still own their provider and bridge compatibility mechanics. Shared invariants belong in Automation kernel modules; provider-specific behavior stays in plugins, and renderer code only consumes shared contracts.

## Accepted Sandbox Runtime limitations

Anthropic Sandbox Runtime 0.0.63 is a research-preview dependency behind `SandboxRunner`, not an absolute hostile-code boundary.

- Its network callback validates a DNS result before the runtime proxy performs a second resolution. A DNS rebinding between those steps could select a private address. Strict installations should add a dedicated egress proxy that resolves and pins the destination IP, or move to a runtime version with dial-time enforcement.
- Timeout and overflow cleanup terminate the spawned Unix process group. A deliberately detached process that creates a new session can escape that group. Strict Linux installations should add cgroup-based containment; a future Windows implementation would require Job Objects. This is one reason Windows stays blocked.

These limitations are accepted for the initial release, must remain visible in deployment review, and must not be described as fixed by hostname filtering or process-group termination.
