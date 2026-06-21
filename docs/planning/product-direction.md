# Product Direction

Updated: 2026-06-20

AgentDock is a local-first, cross-device control plane for AI agents rather than another standalone chat client.

## Product Wedges

- Install, detect, configure, and update local coding-agent runtimes from one interface.
- Dispatch work to a desktop agent from mobile, then inspect progress and approve risky actions remotely.
- Present workspaces, threads, tasks, runtime health, and device presence as one cross-device workspace map.

## Near-Term Priorities

- Runtime installation and health diagnostics.
- Task-oriented agent sessions with progress, diffs, approvals, retries, and interruption.
- Workspace defaults for agent, model, permissions, knowledge, and test/build commands.
- Secure device pairing, notifications, and remote task control before general remote file browsing.

## Mobile Boundary

The initial mobile product is a controller for dispatch, progress, approval, and results. Running a complete Local AI Core and agent runtime on mobile remains a later capability because background execution, filesystem access, battery use, and store policies materially change the design.
