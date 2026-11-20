---
title: Email Templates for MSG91
description: The 24 HTML email templates registered with MSG91, the rules each must pass, and how the registrable source is built.
status: scaffolded
audience: [backend, operator]
last_verified: '2026-11-20'
source_of_truth:
    - packages/email-templates/src/templates.mjs
    - packages/email-templates/src/layout.mjs
    - packages/email-templates/src/check.mjs
    - packages/email-templates/src/build.mjs
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Email templates for MSG91

`packages/email-templates` holds the shop's 24 email templates: 22 from the message-templates document, plus `order_payment_link` and `payment_receipt` for admin orders. Each is registered with MSG91 as `<name>_v1`, so a change made in development never reaches customers until a new version is registered.

## Rules every template passes

`checkTemplate` runs on every template and subject, in the package's tests and in its build:

- Handlebars only as MSG91 supports it: `{{name}}`, `{{#if}}` / `{{else}}`, `{{#unless}}`, `{{#each}}` and `{{@root.x}}`. MSG91 has no comparison helpers, so the server sends simple yes/no values.
- No scripts, forms, iframes or background images; every image is a PNG or JPG at an absolute address, with alt text.
- Transactional emails carry no promotion and no unsubscribe link; marketing emails (the newsletter and shop event announcements) carry one and go only to people who agreed.
- A 25-line order confirmation stays well under Gmail's ~102 KB clipping limit.

## Building the registrable source

```bash
pnpm --filter @saha-textile/email-templates build
```

The build writes `dist/<name>_v1.html` (git-ignored) with the per-environment marks kept: `[[shop_origin]]`, `[[admin_origin]]`, `[[legal_name]]` and `[[shop_address]]`. `fillTokens` fills them for one environment just before a template is registered, so no address is typed into MSG91 by hand. The one designed piece is the shared layout in `layout.mjs`: the shop's full logo, the Pay button's red and the top bar's blue, and a footer that says why the email was sent.
