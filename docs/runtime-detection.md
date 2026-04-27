# Runtime Detection

Runtime detection is the first shippable product slice. It answers whether
supported local agent CLIs are installed on the current machine.

## Current Scope

Detection reports:

- `installed`
- `not_installed`
- `error`
- `unknown`
- binary path, when resolved
- version, when available
- last detection timestamp
- structured issues
- manual recommended actions

Detection does not:

- install runtimes
- modify shell profile files
- collect credentials
- check provider login
- check model availability
- run project-affecting commands

## Implementation

Shared contracts live in `packages/contracts/src/local-core.ts`.

Local AI Core runtime detection lives in:

- `services/local-ai-core/src/runtime/agent-runtime-detector.ts`
- `services/local-ai-core/src/runtime/runtime-detection-service.ts`
- `services/local-ai-core/src/runtime/runtime-detection-store.ts`

The service owns startup detection, manual refresh, persisted latest results,
and runtime detection events.

Persisted state is stored under the Local AI Core user data runtime directory as
`runtime-detection.json`.

## API

Runtime detection is exposed through:

- `GET /api/local/v1/runtimes`
- `GET /api/local/v1/runtimes/:runtimeId`
- `POST /api/local/v1/runtimes/refresh`
- `POST /api/local/v1/runtimes/:runtimeId/refresh`

The legacy route remains available:

- `GET /api/local/v1/runtime/agent-runtimes`

## Events

Local AI Core emits:

- `runtime.detect.started`
- `runtime.detect.completed`
- `runtime.detect.failed`
- `runtime.status.changed`

The renderer listens to these events to update runtime status without running
local detection commands directly.

## Validation

Use:

```sh
pnpm build:electron
node --test dist-electron/electron/agent-runtime-detector.test.js dist-electron/electron/runtime-detection-service.test.js
pnpm build:renderer
pnpm test
```

## Follow-Ups

- Add direct Claude Code CLI detection through `claude`.
- Convert the detector list into a runtime detection adapter registry when the
  plugin SDK is hardened.
