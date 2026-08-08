---
title: Documentation Status Model
description: The five lifecycle states used throughout the developer portal.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-09'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - scripts/validate-developer-portal.mjs
---

# Documentation status model

Every portal page declares exactly one lifecycle status. The status describes the relationship between the page and the implementation—not the quality of the writing.

| Status          | Meaning                                                                             | What the reader may assume                                                       |
| --------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Implemented** | The described behaviour or governance rule exists and has current evidence.         | The page can be followed, subject to its verification date and environment.      |
| **Scaffolded**  | Real structure exists, but behaviour, coverage or integrations remain incomplete.   | Use the documented parts; verify gaps before depending on them.                  |
| **Planned**     | The direction is approved but implementation has not started or is not operational. | Treat it as intended design, never as available behaviour.                       |
| **Deferred**    | The work is deliberately postponed until a recorded trigger exists.                 | Do not implement it early without revisiting the decision and trigger.           |
| **Deprecated**  | A surface still exists but is superseded and should not receive new investment.     | Use the replacement path; remove the old surface when its exit condition is met. |

## Status is not progress percentage

Do not invent percentages such as “80% implemented.” A page can be **Scaffolded** while containing several completed subsections. Record that detail in an implementation table with evidence and gaps.

## Changing status

Change a page status only when the underlying evidence changes:

- **Planned → Scaffolded:** a real code, schema, workflow or automation surface lands.
- **Scaffolded → Implemented:** the documented definition of done is verified.
- **Any active state → Deferred:** the canonical decision record names a reason and restart trigger.
- **Any active state → Deprecated:** a replacement is named and an exit path is recorded.
- **Deprecated → removed:** references and routes are removed after the exit condition is satisfied.

The pull request changing status must update the verification date and source list.
