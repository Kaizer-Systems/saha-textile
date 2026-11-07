---
title: Documentation Status Model
description: The five page statuses used in the portal.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - scripts/validate-developer-portal.mjs
---

# Documentation status model

Every portal page declares one status. The status describes how the page relates to the implementation, not the quality of the writing.

| Status          | Meaning                                                                        | What you can assume                                        |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Implemented** | The described behaviour exists and is tested.                                  | You can follow the page, subject to its verification date. |
| **Scaffolded**  | Real structure exists, but behaviour, coverage or integrations are incomplete. | Use the documented parts. Read the Limitations section.    |
| **Planned**     | The direction is approved, but the behaviour is not available.                 | Treat it as design intent.                                 |
| **Deferred**    | The work is postponed until a recorded trigger occurs.                         | Do not build it without revisiting the decision.           |
| **Deprecated**  | The surface exists but has a replacement.                                      | Use the replacement.                                       |

## Status is not progress percentage

Do not use percentages such as "80% implemented". A **Scaffolded** page can contain several complete sections. List what is missing in its Limitations section.

## Changing status

Change a page status only when the system changes:

- **Planned → Scaffolded:** real code, a schema, a workflow or automation exists.
- **Scaffolded → Implemented:** the definition of done is met and tested.
- **Any state → Deferred:** the decision log names a reason and a restart trigger.
- **Any state → Deprecated:** a replacement is named, with an exit path.
- **Deprecated → removed:** references and routes are removed once the exit condition is met.

A pull request that changes a status also updates the verification date and source list.
