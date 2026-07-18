---
title: Business Flow Overview
description: How business flows should be documented.
---

# Business flow overview

Each business-flow page should connect the customer or admin action to the implementation path that serves it.

Use this shape:

```text
User action
→ route
→ component or page
→ state/query operation
→ API endpoint
→ domain use case
→ database collections
→ result shown to the user
```

Generated API, database, and component references should be linked once those artifacts exist.
