# Glossary

Use these names consistently in UI, contracts, and planning docs.

## Agent Runtime

A local agent CLI or engine that can execute agent work. Examples include opencode, Claude Code, Codex, Aider, and Gemini CLI.

Prefer "agent runtime" in product text. Use "runtime" in compact UI labels when context is clear. Avoid "agent engine" unless describing lower-level implementation.

## Workspace

A local project directory registered with Local AI Core. A workspace has a stable id, display name, local path, health summary, optional Git metadata, default runtime, and task history.

## Task

A durable unit of agent work. A task can move through `created`, `queued`, `running`, `waiting_for_user`, `completed`, `failed`, or `cancelled`, and can include logs, timeline entries, artifacts, approvals, and file change metadata.

## Device

A trusted endpoint that can observe or control work. Desktop devices can host Local AI Core. Mobile devices start as companion control surfaces for status, approvals, and task control.

## Local AI Core

The local service that owns durable runtime, workspace, task, device, plugin, and approval state. Electron starts it for the desktop app, and the renderer talks to it through shared API contracts.

## Plugin

A statically registered extension point for Local AI Core capabilities. Early plugin scope includes runtime detection, channels, knowledge providers, and schedulers. Dynamic third-party loading remains out of scope until security design is ready.

## Approval

A user decision that authorizes or rejects a higher-risk agent action, such as writing files, executing commands, using network access, accessing secrets, or modifying Git state.

## Audit Event

A durable record of a meaningful system or agent action. Audit events will cover runtime detection, task lifecycle, commands, approvals, rejections, and permission changes.
