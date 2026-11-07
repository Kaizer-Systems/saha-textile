---
title: Documentation Contribution Standard
description: When to update the portal and how to write for it.
status: implemented
audience: [frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - AGENTS.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - scripts/validate-developer-portal.mjs
---

# Documentation contribution standard

Documentation changes ship with the code they describe.

## When to update the portal

Update the portal when:

- User-visible or operator-visible behaviour changes.
- A route, state owner, query or API operation changes.
- A contract, schema, index or lifecycle rule changes.
- A security, authorization, payment or privacy rule changes.
- A deployment, rollback, backup or troubleshooting step changes.
- An architectural decision is accepted or superseded.
- A planned surface is built.

## Required page metadata

Every Markdown or MDX page declares:

- `status`, using the [status model](./status-model).
- `audience`, using one or more portal audience names.
- `last_verified`, as an ISO date.
- `source_of_truth`, as one or more repository paths.

The portal renders these values near the page title. The validator rejects missing or unsupported values, missing source paths, and a verification date older than a source's latest change.

Facts shown by interactive components belong in `docs/_data`, not in React components. To change one, edit `docs/_data/portal-manifest.json`, the matching file in `docs/_data/instruments/`, and the portal-data compiler if the shape changes.

## Writing standard

Write for a competent developer who is new to this repository. Portal pages describe the system. The roadmap, progress notes and decision history belong in Engineering Live Context.

### Voice

1. Use present tense and active voice.
2. Address the reader as "you" in procedures, and use imperative steps.
3. Open each page with what the subject is and who it is for.
4. Keep to one idea per sentence and short paragraphs.
5. Use tables for exact mappings and diagrams for flows across three or more components.
6. Define project terms the first time you use them.

### Page shape

Use the sections that apply, in this order: overview, how it works, reference, procedures, limitations, related pages.

### Unfinished behaviour

State a limitation once, in a **Limitations** section, as a plain fact: "The API does not process payments." Describe intended behaviour in a section labelled **Planned**. Link to the roadmap instead of repeating it.

### Words to avoid

The validator rejects project-tracking language in portal pages. Avoid:

- Milestone labels, such as chunk, phase, pass and wave.
- Decision history, such as "the owner decided", "ratified" and "locked".
- Time markers, such as "currently", "not yet", "no longer", "recently" and dates. Vendor document versions and legal rules are exceptions.
- Internal jargon, such as "seam", "evidence" and "governed". Say what the thing is.

Decision identifiers such as `DEC-PORTAL-PRIVATE-ACCESS` appear only on the decision pages and in Engineering Live Context.

### Safety

Never include secrets, real customer data or unsafe production instructions.

## Pull-request checklist

- [ ] Status, audience, verification date and sources are accurate.
- [ ] Planned behaviour is clearly separated from existing behaviour.
- [ ] Local links build without errors.
- [ ] Commands were run or are labelled as examples.
- [ ] Diagrams match the prose and the dependency direction.
- [ ] The portal validator passes.
- [ ] The production portal build passes.
- [ ] Desktop and phone layouts remain readable after structural changes.
