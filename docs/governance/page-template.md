---
title: Documentation Page Template
description: Copyable template for new hand-written portal pages.
status: implemented
audience: [frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/governance/contribution-standard.md
    - scripts/validate-developer-portal.mjs
---

# Documentation page template

Use this template for a new hand-written page. Remove sections that do not apply, and keep the required metadata.

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

State what the subject is and who the page is for.

## Before you begin

- Required knowledge
- Required local services
- Required permissions
- Safety or data-handling constraints

## How it works

Explain the flow from entry point to result. Add a Mermaid diagram when three or more components participate.

## Reference

| Concern     | Repository source   |
| ----------- | ------------------- |
| Entry point | `path/to/file.ts`   |
| Contract    | `path/to/schema.ts` |

## Procedure

1. Use exact, safe steps.
2. Show expected output.
3. Explain how to recover from failure.

## Limitations

State each limitation once, as a plain fact.

## Related pages

Link to the pages a reader needs next.
```

## Template rules

- Mark a page **Implemented** only when the described behaviour exists and is tested.
- Do not describe a placeholder endpoint, collection or workflow as available.
- Do not paste field or operation tables that a generated reference already provides.
- Sanitise every example and keep credentials out of both prose and screenshots.
- Keep `source_of_truth` as precise as the page allows. A declared directory means every change below it triggers a review.
