---
title: TypeScript Reference
slug: /typedoc
description: Standalone Docusaurus bridge to the generated TypeDoc child.
status: scaffolded
audience: [beginner, frontend, backend]
last_verified: '2026-07-25'
source_of_truth:
    - apps/developer-portal-typedoc
    - scripts/serve-developer-portal-persistent.mjs
---

# TypeScript reference

The complete portal mounts the generated TypeDoc surface at [/typedoc/](/typedoc/).

If that link returns to this bridge, only Docusaurus is running. Start the complete atomic local portal instead:

```bash
corepack pnpm portal:persistent
```

Use the [generated surfaces and runtime guide](/tooling/generated-surfaces-and-runtime) for the intentionally narrow exported-symbol scope, shared-theme behavior, direct TypeDoc generation, and build topology.
