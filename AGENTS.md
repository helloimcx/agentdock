# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React renderer: page views in `src/pages/`, shared UI in `src/components/`, Zustand state in `src/store/`, API clients in `src/api/`, and i18n resources in `src/i18n/`. Electron-specific code lives in `electron/`, with shared desktop types in `shared/`. Static assets belong in `public/`. Build outputs are generated in `dist/renderer/` and `dist-electron/`; do not edit them directly.

## Build, Test, and Development Commands
Use `pnpm` for all local work.

- `pnpm dev`: starts the Vite renderer and Electron app through `scripts/dev.mjs`.
- `pnpm build`: builds the renderer, writes the Electron package metadata, and compiles the Electron TypeScript entrypoints.
- `pnpm build:renderer`: builds only the web renderer into `dist/renderer/`.
- `pnpm build:electron`: rebuilds only the Electron side into `dist-electron/`.
- `pnpm start:prod`: launches the packaged app from the current build output.
- `pnpm e2e:smoke`: runs the bundled smoke test against a fresh production build.

## Coding Style & Naming Conventions
The codebase uses TypeScript with `strict` mode enabled and the `@` alias for `src/` imports. Follow the existing style: 2-space indentation, semicolons in renderer code, and clear ESM imports. Use `PascalCase` for React components and page folders (`src/pages/Projects/ProjectList.tsx`), `camelCase` for functions and helpers, and lowercase filenames for stores and API modules (`src/store/auth.ts`, `src/api/client.ts`). Keep shared desktop contracts in `shared/` so renderer and Electron stay aligned.

## Architecture Boundaries
Keep the directory structure intentional, with clear ownership and single-purpose modules. Page components should orchestrate UI and data flow, shared components should stay presentation-focused, stores should own state transitions, API modules should isolate transport concerns, and Electron or Local AI Core logic should not leak into renderer code except through shared contracts. Prefer small, cohesive files over broad utility modules, and move reusable behavior to the nearest appropriate shared layer only after a real second use appears.

## Plugin Development
Plugin contracts and runtime types belong in `packages/plugin-sdk/`; keep cross-process data shapes in shared contracts instead of duplicating them in plugins. Built-in Local AI Core plugins live under `services/local-ai-core/src/plugins/builtin/`, with one focused file or folder per plugin and lowercase dotted ids such as `channel.lark` or `scheduler.cron`. Register plugins through the local core registry and declare dependencies in the manifest rather than relying on implicit load order. Put reusable kernel behavior in `services/local-ai-core/src/kernel/`, not inside individual plugins, and avoid adding dynamic plugin loading until the static registration path is stable.

## Agent Workflow
Before writing any code, describe the intended approach and wait for approval. If requirements are ambiguous, ask clarifying questions before writing any code. If a user request for code is not aligned with best practices, briefly explain the concern and suggest a better approach. When fixing a bug, start by writing a test that reproduces it, then fix the bug until the test passes. After writing code, list relevant edge cases and suggest test cases to cover them. Every time the user corrects the agent, reflect on what went wrong and provide a plan to avoid repeating the same mistake.

## Testing Guidelines
There is no unit-test runner configured in this snapshot. The current verification path is `pnpm e2e:smoke`, which exercises the built Electron app end to end. When adding tests, place them near the feature they cover or under a dedicated test directory, and name them after the target module, for example `ProjectList.test.tsx`.

## Commit & Pull Request Guidelines
This workspace snapshot does not include `.git`, so local history could not be inspected. Use short, imperative commit subjects such as `Add bridge runtime retry` or `Fix smoke test startup timing`. Keep pull requests focused, describe user-visible changes, list validation commands you ran, and include screenshots for UI updates.

## Configuration Notes
Development scripts honor Electron runtime overrides such as `AI_WORKSTATION_USER_DATA_DIR` and `AI_WORKSTATION_SMOKE_OUTPUT`. Avoid committing machine-specific paths, secrets, or generated output.
