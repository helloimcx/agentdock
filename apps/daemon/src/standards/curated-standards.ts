import type { StandardPackMetadata } from '@cc/superai-contracts/standards';
import { parseStandardPack } from './standards-rule-parser.js';

const RAW_GENERAL_PACK = `---
id: general
name: General Engineering & Architecture Invariants
language: general
version: 1.0.0
description: Core architecture boundaries, YAGNI, defensive programming, and supply-chain hygiene
tags: [architecture, general, safety]
---

### Unidirectional Module Dependencies
Keep strict inward dependencies. Low-level modules (contracts, core-sdk, shared types) must never import high-level modules (UI pages, plugins, desktop shell).

### YAGNI & Minimal Complexity
Prefer simplification over premature abstraction. Do not create wrappers, framework layers, or generic helpers until a concrete second call site appears.

### Defensive Input Validation
<important if="handling_untrusted_input || touching_external_api">
Validate and sanitize all external inputs at the boundary. Fail fast and return typed errors rather than bubbling raw stack traces.
</important>

### Safe Error Propagation
Never silently swallow errors or leave empty catch blocks. Log actionable diagnostics with safe redaction of sensitive tokens.
`;

const RAW_DESIGN_SYSTEM_PACK = `---
id: design-system
name: AgentDock Design System & UI/UX Guidelines
language: design-system
version: 1.0.0
description: VoltAgent awesome-design-md conventions, AgentDock #42ff9c brand tokens, dark/light themes, and Radix accessibility
tags: [design, frontend, ui, tailwind]
---

### Brand Design Tokens & Accent Color
Use Tailwind class-based styling with AgentDock primary accent green (#42ff9c) and clean dark-mode backgrounds. Avoid ad-hoc hardcoded hex values outside theme tokens.

### Component Layering & Primitives
Build reusable UI upon Radix UI primitives (Dialog, Select, Dropdown). Keep presentational components dumb and isolate state transitions in stores or custom hooks.

### Interactive State Feedback
<important if="modifying_ui_components || touch_user_interactions">
Every async user action must have explicit loading, disabled, and error feedback states. Destructive actions require confirmation dialogs.
</important>

### Accessibility (a11y) & Multi-Surface Consistency
Ensure interactive elements have aria-label, visible focus rings, and WCAG AA contrast. When updating styles, consider desktop, web, and mobile layouts together.
`;

const RAW_TYPESCRIPT_PACK = `---
id: typescript
name: Strict TypeScript Standards
language: typescript
version: 1.0.0
description: Strict null checks, zero-any policy, and shared contracts boundary
tags: [typescript, node, strict]
---

### Strict Typing & Zero-Any
Never use \`any\`. Prefer \`unknown\` with type guards or discriminated union narrowing. Keep tsconfig strict mode passing with zero type assertions where possible.

### Shared Contract Boundaries
Cross-process and cross-package data models must reside in packages/contracts. Never duplicate internal DTOs across frontend and backend.

### Async Error Handling
Always await asynchronous calls or return the Promise explicitly. Handle Promise rejections with typed error boundaries.
`;

const RAW_GOLANG_PACK = `---
id: golang
name: Modern Go Guidelines
language: golang
version: 1.0.0
description: JetBrains Go modern guidelines, idiomatic error wrapping, and concurrency safety
tags: [golang, modern, backend]
---

### Idiomatic Error Wrapping
Check errors explicitly immediately after return. Wrap errors with \`fmt.Errorf("...: %w", err)\` to preserve the causal error chain.

### Goroutine & Context Lifecycle
<important if="touching_concurrency || background_workers">
Every goroutine must have an explicit cancellation mechanism via context.Context. Never spawn unmonitored orphan goroutines.
</important>

### Interface Minimization
Accept interfaces, return structs. Keep interfaces small (1-2 methods) and define them where they are consumed, not where they are implemented.
`;

const RAW_PYTHON_PACK = `---
id: python
name: Modern Python Guidelines
language: python
version: 1.0.0
description: Type hints, PEP 8 idiomatic patterns, and pytest fixtures
tags: [python, backend, data]
---

### Type Annotations & Typeguard
Use type hints across all function signatures and public APIs. Run mypy/pyright to guarantee static type correctness.

### Explicit Resource Management
Always use context managers (\`with\` statements) for file handles, sockets, database transactions, and locks to prevent resource leaks.

### Idiomatic Testing Patterns
Write focused pytest unit tests using fixtures and parameterization. Avoid brittle global state between test runs.
`;

export const CURATED_STANDARD_PACKS: StandardPackMetadata[] = [
  parseStandardPack(RAW_GENERAL_PACK),
  parseStandardPack(RAW_DESIGN_SYSTEM_PACK),
  parseStandardPack(RAW_TYPESCRIPT_PACK),
  parseStandardPack(RAW_GOLANG_PACK),
  parseStandardPack(RAW_PYTHON_PACK),
];
