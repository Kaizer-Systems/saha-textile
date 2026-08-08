---
title: Documentation Page Template
description: Copyable template for new hand-written portal pages.
status: implemented
audience: [frontend, backend, operator]
last_verified: '2026-08-09'
source_of_truth:
    - docs/governance/contribution-standard.md
    - scripts/validate-developer-portal.mjs
---

# Documentation page template

Use this template for a new human-authored page. Remove irrelevant optional sections, but keep the required metadata and evidence boundaries.

```md
---
title: Clear Task-Oriented Title
description: One sentence explaining what the reader can do with this page.
status: scaffolded
audience: [frontend]
last_verified: 'YYYY-MM-DD'
source_of_truth:
    - path/to/primary-source.ts
    - docs/engineering-live-context/relevant-decision.md
---

# Clear task-oriented title

State the outcome, the current implementation boundary and the intended reader.

## Before you begin

- Required knowledge
- Required local services
- Required permissions
- Safety or data-handling constraints

## How it works

Explain the flow from entry point to result. Add a Mermaid diagram when three or more components participate.

## Implementation map

| Concern             | Repository source   | Status      |
| ------------------- | ------------------- | ----------- |
| Entry point         | `path/to/file.ts`   | Implemented |
| Contract            | `path/to/schema.ts` | Scaffolded  |
| Generated reference | `/target/route`     | Deferred    |

## Procedure

1. Use exact, safe steps.
2. Show expected output.
3. Explain how to recover from failure.

## Verification

Record the command, runtime probe, test or source comparison used to verify the page.

## Known gaps

List missing behaviour and the trigger that permits it to be implemented.
```

## Template rules

- Do not mark the page **Implemented** merely because the documentation exists.
- Do not describe a placeholder endpoint, collection or workflow as available.
- Do not paste generated field or operation references that should come from automation.
- Sanitise every example and keep credentials out of both prose and screenshots.
- Keep `source_of_truth` as precise as the page allows. A declared directory intentionally makes every change below it a freshness trigger.
