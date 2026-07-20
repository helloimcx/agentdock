# Automation Script Protocol Reference

This document describes the v1 script protocol used by Automation condition scripts.
Scripts run inside a sandbox and communicate with Local AI Core via stdin/stdout JSON.

## Package Structure

A script package is a **flat** directory containing:

```
manifest.json      # Required — package metadata and limits
check.sh           # Entrypoint (any name, declared in manifest)
fixture-*.json     # Optional test fixtures (prefix naming, no subdirectories)
test-*.sh          # Optional self-tests
```

**Constraints:**
- Maximum 64 files, 1 MiB total
- No subdirectories, no symlinks, no binary files
- All paths must be relative POSIX (no `..`, no absolute paths, no backslashes)
- Entrypoint must start with a valid shebang (`#!/bin/sh`, `#!/usr/bin/env python3`, etc.)

## manifest.json

```json
{
  "protocolVersion": 1,
  "entrypoint": "check.sh",
  "config": {},
  "configSchema": { "type": "object" },
  "capabilities": {
    "network": "none",
    "internalAccess": false,
    "allowedReadDirs": []
  },
  "secretRefs": [],
  "env": [],
  "limits": {
    "timeoutMs": 30000,
    "stdoutBytes": 65536,
    "stderrBytes": 16384,
    "payloadBytes": 8192,
    "stateBytes": 4096
  }
}
```

### Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `protocolVersion` | `1` | Yes | Must be `1` |
| `entrypoint` | string | Yes | Relative POSIX path to the executable entrypoint |
| `config` | object | Yes | Static configuration; also receives provider-event payload for event-based automations |
| `configSchema` | object | Yes | JSON Schema for `config` validation |
| `capabilities.network` | `"none"` \| `"public"` | Yes | Network access level |
| `capabilities.internalAccess` | boolean | Yes | Whether internal network addresses are reachable |
| `capabilities.allowedReadDirs` | string[] | Yes | Absolute directory paths the script may read from |
| `secretRefs` | string[] | Yes | Names of secrets declared in the manifest (resolved at runtime) |
| `env` | string[] | Yes | Environment variable names the script may read |
| `limits.timeoutMs` | integer | Yes | Execution timeout in ms (clamped to 30000–300000) |
| `limits.stdoutBytes` | integer | Yes | Max stdout size before truncation error |
| `limits.stderrBytes` | integer | Yes | Max stderr size before truncation error |
| `limits.payloadBytes` | integer | Yes | Max size of the `payload` response field |
| `limits.stateBytes` | integer | Yes | Max size of the `nextState` response field |

## Stdin Protocol (Input)

Local AI Core writes one JSON object to the script's stdin:

```json
{
  "protocolVersion": 1,
  "evaluationId": "eval-abc123",
  "triggeredAt": "2026-07-20T10:00:00.000Z",
  "config": {
    "url": "https://example.com/health",
    "expected_status": 200
  },
  "previousState": {
    "last_failure": "2026-07-20T09:30:00Z"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `protocolVersion` | `1` | Always `1` |
| `evaluationId` | string | Unique ID for this evaluation (use in logs for traceability) |
| `triggeredAt` | string | ISO 8601 timestamp of when the trigger fired |
| `config` | object | For **cron/interval** automations: the static `config` from your manifest. For **provider-event** automations: the merged event payload (all fields from the event plus `eventSubject`, `eventSourceType`, `occurredAt`, `timestamp`, `summary`, `eventSnapshot`, `previous`) |
| `previousState` | object | The `nextState` from the previous run (empty object on first run) |

## Stdout Protocol (Output)

The script must write exactly one JSON object to stdout and exit with code 0:

```json
{
  "protocolVersion": 1,
  "matched": true,
  "summary": "CPU usage is 92%, above threshold of 90%",
  "payload": { "cpu_percent": 92, "threshold": 90 },
  "nextState": { "last_alert_at": "2026-07-20T10:00:00Z" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `protocolVersion` | `1` | Yes | Must be `1` |
| `matched` | boolean | Yes | `true` if the condition is met (triggers the action) |
| `summary` | string | No | Human-readable explanation (shown in logs/UI) |
| `payload` | object | No | Structured data passed to the action's prompt template |
| `nextState` | object | No | Persistent state carried to the next evaluation |

**Rules:**
- Only the keys listed above are allowed — extra keys cause a `protocol_invalid` error
- `payload` and `nextState` are size-limited by `limits.payloadBytes` and `limits.stateBytes`
- Any output on stderr is captured for diagnostics but does not affect parsing
- Secrets declared in `secretRefs` are automatically redacted from all stored output

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success — stdout is parsed as the protocol response |
| Non-zero | Script failure — recorded as `script_exit` error, action not triggered |

## Error Responses

If the script violates the protocol, Local AI Core records one of these errors:

| Error Code | Cause |
|---|---|
| `protocol_invalid` | stdout is not valid JSON, missing `matched`, wrong `protocolVersion`, or extra keys |
| `protocol_limit` | `payload` or `nextState` exceeds its size limit |
| `script_exit` | Non-zero exit code |
| `script_signal` | Terminated by signal |
| `output_limit` | stdout or stderr exceeded its byte limit |
| `sandbox_unavailable` | Sandbox runtime not available on this platform |
| `interpreter_unavailable` | The approved interpreter is not installed |
| `interpreter_mismatch` | Installed interpreter version differs from the approved version |
| `approval_mismatch` | Script version was modified after approval |
| `secret_unavailable` | A declared secret could not be resolved |

## Rising-Edge Triggering

The Automation system uses **rising-edge** detection: the action fires only when
`matched` transitions from `false` (or no previous state) to `true`. Consecutive
`matched: true` evaluations do not re-trigger until a `matched: false` occurs.
Use `nextState` to track whether you have already alerted on a condition.

## Parsing JSON in Shell Scripts

Many condition scripts are written in shell (`#!/bin/sh`) and need to extract
values from the stdin JSON. Two common approaches:

### Using jq (preferred when available)

If the sandbox environment has `jq` installed, use it for robust parsing:

```sh
input=$(cat)
url=$(printf '%s' "$input" | jq -r '.config.url // empty')
previous_state=$(printf '%s' "$input" | jq -r '.previousState // {}')
```

### Using sed (fallback)

When `jq` is unavailable, you can use sed with the understanding that it has
known limitations:

```sh
url=$(printf '%s' "$input" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
```

**⚠️ Limitations of sed-based parsing:**
- May match keys in nested objects (e.g., `previousState.url` instead of `config.url`)
- Breaks on escaped quotes inside string values
- Fails on multi-line JSON or reordered keys

**Security warning:** If `config` values originate from untrusted provider-events
(e.g., user-controlled webhook payloads), validate or escape them before shell
interpolation to prevent injection. Avoid passing unchecked values directly into
command arguments without quoting.

## Writing Tips

1. **Always emit valid JSON to stdout** — log diagnostics to stderr instead
2. **Use `nextState` for deduplication** — store a timestamp or counter to avoid re-alerting
3. **Keep output small** — payloads are limited to `payloadBytes` (default 8 KiB)
4. **Handle missing state gracefully** — `previousState` is `{}` on first run
5. **Exit non-zero on fetch errors** — don't emit `matched: true` if your data source is unreachable
6. **Test locally first** — pipe a sample stdin JSON and verify the stdout response:

```bash
echo '{"protocolVersion":1,"evaluationId":"test","triggeredAt":"2026-07-20T10:00:00Z","config":{"url":"https://example.com"},"previousState":{}}' | ./check.sh
```
