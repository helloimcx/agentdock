# Documentation Index

This directory is organized by documentation purpose.

## Product

- [Product Baseline](product/product-baseline.md): Phase 0 product sentence, core concepts, and domain model baseline.
- [Glossary](product/glossary.md): canonical product terminology for user-facing concepts.

## Architecture

- [Overview](architecture/overview.md): current Local AI Core-first architecture.
- [State Ownership](architecture/state-ownership.md): where runtime, workspace, task, device, and approval state belongs.
- [Runtime Installation Boundary](architecture/runtime-installation-boundary.md): reserved shape for future installation support without implementing installers.

## Features

- [Runtime Detection](features/runtime-detection.md): Phase 1 runtime detection behavior and APIs.
- [Workspace Task Model](features/workspace-task-model.md): Phase 2 workspace registry and task model.
- [Device And Workspace Registry](features/device-workspace-registry.md): Phase 0 registry ownership and device contract draft.
- [Security, Approval, And Audit](features/security-approval.md): Phase 3 permission model, approvals, command risk, and audit log.

## Operations

- [Release Workflow](operations/release-workflow.md): CI, tags, and release packaging guidance.
- [NPM + Tailscale Deployment](operations/npm-tailscale-deployment.md): quick HTTPS deployment path.

## Planning

- [Development Plan](planning/development-plan.md): phased implementation plan.
- [TODO](planning/todo.md): short running checklist.

## Reports

- [Bugs](reports/BUG.md): known or previously fixed product issues.
- [Insights](reports/INSIGHTS.md): product strategy notes and research.

## Decisions

- [ADR 0001](adr/0001-plugin-based-composition.md): plugin-based Local AI Core composition.
