---
title: Angular Storybook
slug: /storybook
description: Standalone Docusaurus bridge to the generated Angular Storybook child.
status: scaffolded
audience: [beginner, frontend]
last_verified: '2026-07-25'
source_of_truth:
    - apps/developer-portal-storybook
    - scripts/serve-developer-portal-persistent.mjs
---

# Angular Storybook

The complete portal mounts the single Angular Storybook renderer at [/storybook/](/storybook/).

If that link returns to this bridge, only Docusaurus is running. Start the complete atomic local portal instead:

```bash
corepack pnpm portal:persistent
```

Use the [generated surfaces and runtime guide](/tooling/generated-surfaces-and-runtime) for application segregation, shared-theme behavior, direct Storybook development, and build topology.
