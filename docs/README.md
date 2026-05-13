# Documentation Index

This directory is organized by documentation purpose.

## Product

- [Product Baseline](product/product-baseline.md): Phase 0 product sentence, core concepts, and domain model baseline.
- [Glossary](product/glossary.md): canonical product terminology for user-facing concepts.

## Architecture

- [Overview](architecture/overview.md): current Local AI Core-first architecture.
- [Local AI Core Kernel And Plugin Composition](architecture/local-core-kernel.md): kernel bootstrap, plugin registration, capabilities, lifecycle, and runtime composition.
- [Workspace Router Architecture](architecture/workspace-router.md): workspace route resolution, thread messaging, registry sync, and scheduler bridge flow.
- [ACP Protocol Fields And Examples](architecture/acp-protocol.md): AgentDock-supported ACP JSON-RPC fields, bridge events, and example flows.
- [Channel Gateway Architecture](architecture/channel-gateways.md): Lark/Weixin inbound normalization, bridge-event outbound rendering, and shared channel contracts.
- [Knowledge Runtime Architecture](architecture/knowledge-runtime.md): knowledge provider plugin, Local Core APIs, thread attachments, upload, and search flow.
- [Message And Channel Contracts](architecture/message-and-channel-contracts.md): ownership and invariants for streamed message blocks and shared channel content.
- [Scheduled Delivery Architecture](architecture/scheduled-delivery.md): scheduler ownership, route resolution, ACP execution, and channel delivery invariants.
- [Automation Monitor Architecture](architecture/automation-monitor.md): monitor provider plugins, polling/subscription triggers, condition evaluation, ACP execution, and channel delivery invariants.
- [State Ownership](architecture/state-ownership.md): where runtime, workspace, task, device, and approval state belongs.
- [Runtime Installation Boundary](architecture/runtime-installation-boundary.md): reserved shape for future installation support without implementing installers.

## Features

- [Runtime Detection](features/runtime-detection.md): Phase 1 runtime detection behavior and APIs.
- [Pi Agent](features/pi-agent.md): built-in Pi coding agent runtime over Local AI Core ACP.
- [Workspace Task Model](features/workspace-task-model.md): Phase 2 workspace registry and task model.
- [Device And Workspace Registry](features/device-workspace-registry.md): Phase 0 registry ownership and device contract draft.
- [Security, Approval, And Audit](features/security-approval.md): Phase 3 permission model, approvals, command risk, and audit log.

## Operations

- [Release Workflow](operations/release-workflow.md): CI, tags, and release packaging guidance.
- [NPM + Tailscale Deployment](operations/npm-tailscale-deployment.md): quick HTTPS deployment path.

## Planning

- [Development Plan](planning/development-plan.md): phased implementation plan.
- [AgentDock Cloud Development Steps](planning/agentdock-cloud-development-steps.md): checklist for the docker-compose cloud execution plane MVP.
- [Bug Reduction Plan](planning/bug-reduction-plan.md): guardrails for repeated bug patterns, core contracts, tests, and release checks.
- [Agent Command Architecture Optimization Plan](planning/agent-command-architecture-plan.md): follow-up plan for `/agent`, thread command handling, runtime selection, and channel `/new` inheritance cleanup.
- [TODO](planning/todo.md): short running checklist.

## Reports

- [Bugs](reports/BUG.md): known or previously fixed product issues.
- [Insights](reports/INSIGHTS.md): product strategy notes and research.

## Decisions

- [ADR 0001](adr/0001-plugin-based-composition.md): plugin-based Local AI Core composition.
