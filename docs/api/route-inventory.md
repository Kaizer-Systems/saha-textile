---
title: API Route Inventory
wide: true
description: Every API route with its access rule.
status: scaffolded
audience: [beginner, backend, frontend, operator]
last_verified: '2026-11-14'
source_of_truth:
    - apps/api/src/main.ts
    - apps/api/src/openapi.ts
    - apps/api/src/config/app-config.ts
    - apps/api/src/health
    - apps/api/src/auth
    - apps/api/src/storefront
    - apps/api/src/admin
    - apps/api/src/admin/admin-customers.controller.ts
    - apps/api/src/first-admin.ts
    - apps/api/src/privacy
    - apps/api/src/catalog
    - apps/api/src/cart
    - apps/api/src/orders
    - apps/api/src/currency
    - apps/api/src/promotions
    - apps/api/src/media
    - apps/api/src/blog
    - apps/api/src/events
    - apps/api/src/stores
    - apps/api/src/mailboxes
    - apps/api/src/wishlist
    - packages/adapters-db-mongo/src/models/auth-session.model.ts
    - packages/adapters-db-mongo/src/models/auth-challenge.model.ts
    - packages/adapters-db-mongo/src/models/auth-token.model.ts
    - packages/adapters-db-mongo/src/models/auth-rate-limit.model.ts
    - packages/adapters-db-mongo/src/repositories/auth.repository.ts
    - packages/adapters-db-mongo/test/auth-persistence.test.ts
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
---

# API route inventory

This page lists every route the API exposes. Use it to find a route and its access rule. For request and response detail, use the [Scalar reference](/tools/scalar).

The tables are generated from the controllers in `apps/api/src`. The **Access** column shows who may call a route:

- **Public** needs no session.
- **Storefront session** needs a signed-in customer.
- **Staff or admin session** needs a signed-in operator.
- A code such as `product.index` needs an admin session holding that [permission](/backend/security-and-identity#role-versus-permission).

Unsafe methods that carry a session cookie also need the CSRF header. See [CSRF rule](/backend/security-and-identity#csrf-rule).

## Runtime routes

| Method | Route           | Access | Purpose                                                    |
| ------ | --------------- | ------ | ---------------------------------------------------------- |
| `GET`  | `/health/live`  | Public | Liveness probe — process is running (no dependency checks) |
| `GET`  | `/health/ready` | Public | Readiness probe — required dependencies are usable         |
| `GET`  | `/health`       | Public | Alias of `/health/live`                                    |

The API also serves its OpenAPI document at `GET /openapi.json`.

## CSRF token

| Method | Route        | Access | Purpose                                                 |
| ------ | ------------ | ------ | ------------------------------------------------------- |
| `GET`  | `/auth/csrf` | Public | Issue a double-submit CSRF token (also set as a cookie) |

The response is `no-store`. It returns a 32-byte token in the body and sets the same value in an httpOnly cookie. The browser application keeps the token in memory and sends it in the `x-csrf-token` header. For a live session the route keeps a valid token, and rotates it only if the cookie is missing or does not match.

## Storefront authentication routes

These routes use the storefront cookie audience. A customer account exists only after both email and phone are verified through the signup routes.

| Method   | Route                                      | Access                  | Purpose                                                                      |
| -------- | ------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------- |
| `GET`    | `/auth/storefront/signup`                  | Public                  | The signup in flight for this browser, or null                               |
| `DELETE` | `/auth/storefront/signup`                  | Public                  | Abandon the signup in flight for this browser                                |
| `POST`   | `/auth/storefront/signup/start`            | Public                  | Begin a signup; no account exists until email and phone are verified         |
| `POST`   | `/auth/storefront/signup/field`            | Public                  | Set an email or phone, clearing its proof                                    |
| `POST`   | `/auth/storefront/signup/otp/request`      | Public                  | Send a code to a pending email or phone                                      |
| `POST`   | `/auth/storefront/signup/otp/verify`       | Public                  | Verify a code; discloses an existing account only once control is proven     |
| `POST`   | `/auth/storefront/signup/sign-in-existing` | Public                  | Sign in to the existing account a signup code just proved                    |
| `POST`   | `/auth/storefront/signup/finalise`         | Public                  | Create the account from the proven values                                    |
| `POST`   | `/auth/storefront/oauth/state`             | Public                  | Mint the single-use state a provider round-trip is bound to                  |
| `POST`   | `/auth/storefront/oauth/google`            | Public                  | Verify a Google ID token; sign in or begin a signup                          |
| `POST`   | `/auth/storefront/oauth/facebook`          | Public                  | Verify a Meta access token; sign in or begin a signup                        |
| `GET`    | `/auth/storefront/login-methods`           | Storefront session      | Every way this customer can sign in                                          |
| `POST`   | `/auth/storefront/step-up/request`         | Storefront session      | Send a step-up code to a chosen channel                                      |
| `POST`   | `/auth/storefront/oauth/connect`           | Storefront session      | Link a social account after fresh proof                                      |
| `POST`   | `/auth/storefront/oauth/disconnect`        | Storefront session      | Unlink a social account, never the last way in                               |
| `POST`   | `/auth/storefront/login/password`          | Public                  | Password login (sets httpOnly session cookies)                               |
| `POST`   | `/auth/storefront/login/email-otp/request` | Public                  | Request an email OTP (always answers generically)                            |
| `POST`   | `/auth/storefront/login/email-otp/verify`  | Public                  | Verify an email OTP and start a session                                      |
| `POST`   | `/auth/storefront/refresh`                 | Public                  | Rotate the session (reuse of an old token revokes the family)                |
| `POST`   | `/auth/storefront/logout`                  | Public                  | Revoke the current session and clear cookies                                 |
| `POST`   | `/auth/storefront/password/forgot`         | Public                  | Start a password reset (always answers generically)                          |
| `POST`   | `/auth/storefront/password/reset`          | Public                  | Complete a password reset; revokes every existing session                    |
| `POST`   | `/auth/storefront/password/set`            | Storefront session      | Set or change the password for the current account; signs other devices out  |
| `POST`   | `/auth/storefront/activate`                | Public                  | Set the first password from an admin-minted activation token                 |
| `GET`    | `/auth/storefront/me`                      | Public (identity probe) | Current storefront identity (200 with user null when the visitor is a guest) |
| `GET`    | `/auth/storefront/sessions`                | Storefront session      | List the caller’s own live sessions                                          |
| `DELETE` | `/auth/storefront/sessions/:id`            | Storefront session      | Revoke one of the caller’s own sessions                                      |
| `POST`   | `/auth/storefront/sessions/revoke-others`  | Storefront session      | Revoke every session except this one                                         |
| `POST`   | `/auth/storefront/email/verify`            | Public                  | Complete email verification with a token                                     |
| `POST`   | `/auth/storefront/email/verify/resend`     | Storefront session      | Re-send the verification email for the current account                       |

`GET /auth/storefront/me` returns 200 with `{ user: null }` for a guest with no session cookies. An expired access cookie with a live refresh cookie returns 401 `session_expired`, so the browser can rotate the session.

## Storefront account routes

These routes take the customer id from the session. A caller cannot name another customer's account.

| Method   | Route                                      | Access             | Purpose                                                            |
| -------- | ------------------------------------------ | ------------------ | ------------------------------------------------------------------ |
| `GET`    | `/storefront/account/addresses`            | Storefront session | The signed-in customer's saved addresses                           |
| `POST`   | `/storefront/account/addresses`            | Storefront session | Save a new address on the current account                          |
| `PATCH`  | `/storefront/account/addresses/:addressId` | Storefront session | Patch one of the current account’s addresses                       |
| `DELETE` | `/storefront/account/addresses/:addressId` | Storefront session | Remove one of the current account’s addresses                      |
| `GET`    | `/storefront/account/contact`              | Storefront session | The email or phone change in flight on the current account, if any |
| `POST`   | `/storefront/account/contact/email`        | Storefront session | Start changing the account email; sends a code to the new address  |
| `POST`   | `/storefront/account/contact/phone`        | Storefront session | Start changing the account phone; sends a code to the new number   |
| `POST`   | `/storefront/account/contact/resend`       | Storefront session | Send the verification code again                                   |
| `POST`   | `/storefront/account/contact/confirm`      | Storefront session | Confirm the pending email or phone change; signs other devices out |
| `DELETE` | `/storefront/account/contact`              | Storefront session | Abandon the pending change                                         |
| `PATCH`  | `/storefront/account/profile`              | Storefront session | Change the current account's display name                          |

## Admin authentication routes

| Method   | Route                                | Access                 | Purpose                                                                              |
| -------- | ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------ |
| `GET`    | `/auth/admin/csrf`                   | Public                 | Issue the admin session's double-submit CSRF token                                   |
| `POST`   | `/auth/admin/login`                  | Public                 | Admin password login by email or username                                            |
| `POST`   | `/auth/admin/login/pin`              | Public                 | Admin PIN login (5 failures lock PIN use for 15 minutes)                             |
| `POST`   | `/auth/admin/pin`                    | Staff or admin session | Set or change the admin PIN (requires password proof; weak PINs are refused)         |
| `GET`    | `/auth/admin/security`               | Staff or admin session | Credential state for Security Settings                                               |
| `POST`   | `/auth/admin/pin/remove`             | Staff or admin session | Remove the admin PIN (requires password proof)                                       |
| `POST`   | `/auth/admin/password/change`        | Staff or admin session | Change the password; every session is revoked (audited)                              |
| `POST`   | `/auth/admin/password/forgot`        | Public                 | Start admin password recovery (always answers generically)                           |
| `POST`   | `/auth/admin/password/reset`         | Public                 | Complete admin recovery; revokes sessions and suspends PIN use                       |
| `POST`   | `/auth/admin/refresh`                | Public                 | Rotate the admin session                                                             |
| `POST`   | `/auth/admin/logout`                 | Public                 | Revoke the admin session                                                             |
| `GET`    | `/auth/admin/me`                     | Staff or admin session | Current admin profile — sanitized, never credential material                         |
| `PATCH`  | `/auth/admin/profile`                | Staff or admin session | Update the signed-in operator’s display name and phone                               |
| `GET`    | `/auth/admin/sessions`               | Staff or admin session | List the caller’s own live sessions                                                  |
| `DELETE` | `/auth/admin/sessions/:id`           | Staff or admin session | Revoke one of the caller’s own sessions                                              |
| `POST`   | `/auth/admin/sessions/revoke-others` | Staff or admin session | Revoke every session except this one                                                 |
| `POST`   | `/auth/admin/invites`                | `admin_user.create`    | Invite a staff/admin account (admin_user.create; audited)                            |
| `GET`    | `/auth/admin/invites`                | `admin_user.create`    | List outstanding invites (admin_user.create; same ACL as invite create)              |
| `DELETE` | `/auth/admin/invites/:id`            | `admin_user.create`    | Revoke an outstanding invite (admin_user.create; audited)                            |
| `POST`   | `/auth/admin/invites/accept`         | Public                 | Accept an admin invitation and set credentials (optional PIN; weak PINs are refused) |
| `POST`   | `/auth/admin/resume`                 | Staff or admin session | Quick-resume an idle admin session with PIN or password                              |

Access and refresh credentials travel only in cookies. `SessionGuard` protects every route by default, and a route opts out with `@Public()`.

## Admin authorization routes

Every route below requires an admin session and the named permission. Effective permissions combine the account's embedded grants with active role assignments, capped by the account's role tier.

| Method   | Route                                | Access                   | Purpose                                                                  |
| -------- | ------------------------------------ | ------------------------ | ------------------------------------------------------------------------ |
| `GET`    | `/admin/users`                       | `admin_user.index`       | Paginated operator directory                                             |
| `GET`    | `/admin/users/:userId/authority`     | `admin_user.index`       | Roles held and the resolved permission set                               |
| `POST`   | `/admin/users/:userId/roles`         | `admin_user_role.assign` | Grant a role; refused above the actor’s own authority (audited)          |
| `DELETE` | `/admin/users/:userId/roles/:roleId` | `admin_user_role.revoke` | Revoke a role; refused for the last administrator (audited)              |
| `PATCH`  | `/admin/users/:userId/status`        | `admin_user.update`      | Enable or disable an account; disabling revokes every session (audited)  |
| `GET`    | `/admin/audit-logs`                  | `audit.index`            | Read the admin audit trail (newest first, filterable, bounded page size) |
| `GET`    | `/admin/dashboard/revenue`           | `dashboard.revenue`      | Revenue for one period (Total Revenue tile)                              |
| `GET`    | `/admin/dashboard/revenue/monthly`   | `dashboard.revenue`      | Revenue by month for the last 12 months                                  |
| `GET`    | `/admin/dashboard/orders`            | `dashboard.orders`       | Paid order count for one period (Total Orders tile)                      |
| `GET`    | `/admin/dashboard/orders/recent`     | `dashboard.orders`       | The 5 newest orders in any status                                        |
| `GET`    | `/admin/dashboard/customers`         | `dashboard.customers`    | Customer count, leaving out deleted accounts                             |
| `GET`    | `/admin/dashboard/top-products`      | `dashboard.top_products` | The 4 best sellers for one period                                        |
| `GET`    | `/admin/dashboard/stock`             | `dashboard.stock`        | The 8 live variants with the lowest stock, optionally by category        |
| `GET`    | `/admin/dashboard/reviews`           | `dashboard.reviews`      | The 4 newest reviews in any moderation state                             |
| `GET`    | `/admin/permissions`                 | `permission.index`       | The full permission registry                                             |
| `GET`    | `/admin/roles`                       | `role.index`             | List every role definition                                               |
| `GET`    | `/admin/roles/:id`                   | `role.index`             | Get one role definition                                                  |
| `POST`   | `/admin/roles`                       | `role.create`            | Create a role (audited)                                                  |
| `PATCH`  | `/admin/roles/:id`                   | `role.update`            | Edit a role; live holders are re-authorized (audited)                    |
| `DELETE` | `/admin/roles/:id`                   | `role.destroy`           | Delete a role; live holders are re-authorized (audited)                  |

The first administrator is created by an operator command, not over HTTP:

```bash
pnpm --filter @saha-textile/api bootstrap:first-admin -- --email owner@example.com
```

The command generates a password, prints it once, stores only its Argon2 hash and writes a critical audit event. It refuses to run if administrative authority already exists.

## Admin notification routes

| Method  | Route                            | Access          | Purpose                                                           |
| ------- | -------------------------------- | --------------- | ----------------------------------------------------------------- |
| `GET`   | `/admin/notifications/provider`  | `setting.index` | Non-secret MSG91/console provider status (Authkey never returned) |
| `GET`   | `/admin/notifications/channels`  | `setting.index` | List channel × category kill-switches and plan limits             |
| `PATCH` | `/admin/notifications/channels`  | `setting.edit`  | Update a channel × category kill-switch / plan limit (audited)    |
| `GET`   | `/admin/notifications/usage`     | `setting.index` | Usage vs plan per channel × category                              |
| `GET`   | `/admin/notifications/templates` | `setting.index` | List notification templates (provider ids only; no secrets)       |
| `PUT`   | `/admin/notifications/templates` | `setting.edit`  | Upsert template metadata and MSG91 Flow/WhatsApp ids (audited)    |

These routes manage non-secret settings. The MSG91 key stays in the API environment.

## Admin communications routes

| Method | Route                   | Access          | Purpose                                                                                    |
| ------ | ----------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `GET`  | `/admin/communications` | `setting.index` | Every approved message with its email, SMS and WhatsApp switches                           |
| `PUT`  | `/admin/communications` | `setting.edit`  | Switch one message on or off for one channel (password for a cell with a warning; audited) |

See [Communications](../admin/communications.md) for the rules.

## Admin customer routes

| Method   | Route                                               | Access             | Purpose                                                                                               |
| -------- | --------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `GET`    | `/admin/customers`                                  | `customer.index`   | Paginated live customer directory (optional search/status; never deleted customers)                   |
| `GET`    | `/admin/customers/deleted`                          | `customer.restore` | Paginated soft-deleted customers (recycle bin)                                                        |
| `POST`   | `/admin/customers`                                  | `customer.create`  | Create a customer without password; mint activation on selected channels                              |
| `GET`    | `/admin/customers/:customerId`                      | `customer.index`   | Customer detail                                                                                       |
| `GET`    | `/admin/customers/:customerId/orders`               | `customer.index`   | List orders for a specific customer                                                                   |
| `PATCH`  | `/admin/customers/:customerId`                      | `customer.update`  | Patch customer profile fields                                                                         |
| `DELETE` | `/admin/customers/:customerId`                      | `customer.destroy` | Soft-delete a customer: ends sessions, revokes links and codes, releases Google/Facebook (audited)    |
| `POST`   | `/admin/customers/:customerId/restore`              | `customer.restore` | Restore a soft-deleted customer to its previous status; refused if the email/phone is taken (audited) |
| `POST`   | `/admin/customers/:customerId/activation/resend`    | `customer.update`  | Remint activation token and send on selected channels                                                 |
| `POST`   | `/admin/customers/:customerId/addresses`            | `customer.update`  | Add a saved address                                                                                   |
| `PATCH`  | `/admin/customers/:customerId/addresses/:addressId` | `customer.update`  | Patch a saved address                                                                                 |
| `DELETE` | `/admin/customers/:customerId/addresses/:addressId` | `customer.update`  | Remove a saved address                                                                                |

A soft delete is one transaction. It sets the status to `deleted`, records the previous status, increases the token version, releases the customer's Google and Facebook links, and writes an audit record kept for seven years. After the commit it ends sessions and cancels outstanding links, codes and contact changes.

A restore returns the customer to the previous status. It does not re-attach provider links, and it is refused with `customer_identifier_taken` if another live customer holds the email or phone. Deleted customers appear only in the `/admin/customers/deleted` list.

## Admin catalogue routes

| Method   | Route                                           | Access                        | Purpose                                                                            |
| -------- | ----------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `GET`    | `/admin/catalog/addon-templates`                | `product.index`               | List add-on templates                                                              |
| `POST`   | `/admin/catalog/addon-templates`                | `product.edit`                | Save an add-on template option                                                     |
| `DELETE` | `/admin/catalog/addon-templates/:code`          | `product.edit`                | Remove an add-on template option                                                   |
| `GET`    | `/admin/catalog/categories`                     | `category.index`              | Every category with its address and product count                                  |
| `POST`   | `/admin/catalog/categories`                     | `category.create`             | Add a category                                                                     |
| `POST`   | `/admin/catalog/categories/:id`                 | `category.edit`               | Save a category; a move or rename writes its redirects                             |
| `DELETE` | `/admin/catalog/categories/:id`                 | `category.destroy`            | Delete an empty category                                                           |
| `GET`    | `/admin/catalog/attributes`                     | `attribute.index`             | Every attribute and its values                                                     |
| `POST`   | `/admin/catalog/attributes`                     | `attribute.edit`              | Add or save an attribute                                                           |
| `DELETE` | `/admin/catalog/attributes/:code`               | `attribute.destroy`           | Delete an attribute no product uses                                                |
| `GET`    | `/admin/catalog/products`                       | `product.index`               | List products for the admin, every status                                          |
| `GET`    | `/admin/catalog/products/replacement-targets`   | `product.edit`                | Live products and collections a discontinued product may point to                  |
| `POST`   | `/admin/catalog/products`                       | `product.create`              | Add a product; it starts disabled                                                  |
| `POST`   | `/admin/catalog/products/:idOrSlug/go-live`     | `product.edit`                | Put a product on sale, or list what stops it; the form and the list both call this |
| `GET`    | `/admin/catalog/products/:idOrSlug/bundle`      | `product.index`               | Read a bundle product's groups                                                     |
| `POST`   | `/admin/catalog/products/:idOrSlug/bundle`      | `product.edit`                | Save a bundle product's groups                                                     |
| `GET`    | `/admin/catalog/products/:idOrSlug`             | `product.index`               | Read one product and its variants for the admin form                               |
| `POST`   | `/admin/catalog/products/:idOrSlug/discontinue` | `product.edit`                | Discontinue a product and write its redirect                                       |
| `POST`   | `/admin/catalog/products/:idOrSlug`             | `product.edit`                | Save the product form fields                                                       |
| `GET`    | `/admin/catalog/redirects`                      | `product.index`               | List redirect rows                                                                 |
| `POST`   | `/admin/catalog/redirects`                      | `product.edit`                | Save a redirect, collapsing any chain                                              |
| `DELETE` | `/admin/catalog/redirects`                      | `product.edit`                | Remove one redirect row                                                            |
| `GET`    | `/admin/catalog/faq`                            | `faq.index`                   | List FAQ entries                                                                   |
| `DELETE` | `/admin/catalog/faq/:id`                        | `faq.destroy`                 | Remove an FAQ entry                                                                |
| `POST`   | `/admin/catalog/faq`                            | `faq.edit`                    | Save an FAQ entry                                                                  |
| `GET`    | `/admin/catalog/questions`                      | `question_and_answer.index`   | List shopper questions                                                             |
| `POST`   | `/admin/catalog/questions/:id/answer`           | `question_and_answer.edit`    | Answer a question and email the shopper                                            |
| `POST`   | `/admin/catalog/questions/:id/reject`           | `question_and_answer.edit`    | Reject a question so it never shows                                                |
| `DELETE` | `/admin/catalog/questions/:id`                  | `question_and_answer.destroy` | Delete a question                                                                  |
| `GET`    | `/admin/search-terms`                           | `search_term.index`           | List search words, any status                                                      |
| `GET`    | `/admin/search-terms/:id`                       | `search_term.index`           | One search word with its tagged products                                           |
| `POST`   | `/admin/search-terms`                           | `search_term.create`          | Add a search word                                                                  |
| `POST`   | `/admin/search-terms/:id`                       | `search_term.edit`            | Save a search word; Live needs every language and a tag                            |
| `POST`   | `/admin/search-terms/status`                    | `search_term.edit`            | Bulk Go Live or Take off shop                                                      |
| `DELETE` | `/admin/search-terms/:id`                       | `search_term.destroy`         | Delete a search word                                                               |
| `GET`    | `/admin/storefront-settings/search`             | `theme_option.index`          | Which categories show first in search                                              |
| `PUT`    | `/admin/storefront-settings/search`             | `theme_option.edit`           | Save Search; the shop re-indexes in the background                                 |
| `GET`    | `/admin/storefront-settings/share`              | `theme_option.index`          | The share menu's apps and Story words; the X handle comes from the Brand Kit       |
| `PUT`    | `/admin/storefront-settings/share`              | `theme_option.edit`           | Save Sharing; the X handle is written to the Brand Kit's X profile                 |

Admin catalogue reads answer `no-store`.

## Admin media and content routes

| Method   | Route                                 | Access               | Purpose                                                                      |
| -------- | ------------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `GET`    | `/admin/content-blocks`               | `theme_option.index` | Banners by owner and position                                                |
| `PUT`    | `/admin/content-blocks`               | `theme_option.edit`  | Create or replace the banner at its position and slot                        |
| `DELETE` | `/admin/content-blocks/:key`          | `theme_option.edit`  | Remove a banner                                                              |
| `GET`    | `/admin/settings/brand`               | `setting.index`      | The Brand Kit settings                                                       |
| `PUT`    | `/admin/settings/brand`               | `setting.edit`       | Save logo sets, link preview picture, profiles, store links and colours      |
| `POST`   | `/admin/settings/brand/app-link`      | `setting.edit`       | Check that a Google Play or App Store address belongs to a real app          |
| `GET`    | `/admin/settings/home-hero`           | `theme_option.index` | The selected home hero layout                                                |
| `PUT`    | `/admin/settings/home-hero`           | `theme_option.edit`  | Select the home hero layout                                                  |
| `POST`   | `/admin/youtube/validate`             | `product.edit`       | Normalise a pasted YouTube link and confirm the video                        |
| `GET`    | `/admin/youtube/settings`             | `setting.index`      | YouTube rail settings                                                        |
| `PUT`    | `/admin/youtube/settings`             | `setting.edit`       | Edit the rail: handle, display count, placements                             |
| `GET`    | `/admin/media`                        | `attachment.index`   | Media library page with previews, usage counts and stale roles               |
| `GET`    | `/admin/media/roles`                  | `attachment.index`   | The image size ladder                                                        |
| `PUT`    | `/admin/media/roles/:key`             | `setting.edit`       | Edit a role; changed widths mark old derivatives stale                       |
| `POST`   | `/admin/media/presign`                | `attachment.create`  | Start an upload: policy check, then a presigned PUT for the private original |
| `POST`   | `/admin/media/:assetId/finalize`      | `attachment.create`  | The upload finished; queue processing                                        |
| `GET`    | `/admin/media/:assetId/status`        | `attachment.index`   | Processing state of an upload                                                |
| `GET`    | `/admin/media/:assetId`               | `attachment.index`   | One library item                                                             |
| `PATCH`  | `/admin/media/:assetId`               | `attachment.edit`    | Edit slug, alt, title and caption; a new slug queues a reprocess             |
| `POST`   | `/admin/media/:assetId/reprocess`     | `attachment.edit`    | Regenerate every role from the retained original                             |
| `DELETE` | `/admin/media/:assetId`               | `attachment.destroy` | Soft-delete an unused image; GC removes files after 30 days                  |
| `GET`    | `/admin/reviews`                      | `review.index`       | Reviews with photo previews (signed while private)                           |
| `POST`   | `/admin/reviews/:reviewId/moderation` | `review.edit`        | Approve or reject a review and its photos                                    |

## Admin blog routes

| Method   | Route                           | Access             | Purpose                                                |
| -------- | ------------------------------- | ------------------ | ------------------------------------------------------ |
| `GET`    | `/admin/blog/posts`             | `blog.index`       | Every post, any status                                 |
| `GET`    | `/admin/blog/posts/:id`         | `blog.index`       | One post with every language, for the form             |
| `POST`   | `/admin/blog/posts`             | `blog.create`      | Add a post; it starts as a draft                       |
| `POST`   | `/admin/blog/posts/:id/go-live` | `blog.edit`        | Publish a post, or list what stops it                  |
| `POST`   | `/admin/blog/posts/:id/status`  | `blog.edit`        | The list's switch: Go Live, or take the post down      |
| `POST`   | `/admin/blog/posts/:id`         | `blog.edit`        | Save the post form                                     |
| `DELETE` | `/admin/blog/posts/:id`         | `blog.destroy`     | Delete a post; a published one leaves its address gone |
| `GET`    | `/admin/blog/categories`        | `category.index`   | Every blog category                                    |
| `POST`   | `/admin/blog/categories`        | `category.create`  | Add a blog category                                    |
| `POST`   | `/admin/blog/categories/:id`    | `category.edit`    | Save a blog category                                   |
| `DELETE` | `/admin/blog/categories/:id`    | `category.destroy` | Delete a blog category and take it off every post      |
| `GET`    | `/admin/blog/tags`              | `tag.index`        | Every blog tag                                         |
| `POST`   | `/admin/blog/tags`              | `tag.create`       | Add a blog tag                                         |
| `POST`   | `/admin/blog/tags/:id`          | `tag.edit`         | Save a blog tag                                        |
| `DELETE` | `/admin/blog/tags/:id`          | `tag.destroy`      | Delete a blog tag and take it off every post           |

## Admin event routes

| Method   | Route                                         | Access          | Purpose                                                   |
| -------- | --------------------------------------------- | --------------- | --------------------------------------------------------- |
| `GET`    | `/admin/events`                               | `event.index`   | Every launch and sale event, any state                    |
| `GET`    | `/admin/events/category-products/:categoryId` | `event.index`   | A category's products and SKU prices                      |
| `GET`    | `/admin/events/:id`                           | `event.index`   | One event for the form                                    |
| `GET`    | `/admin/events/:id/review`                    | `event.index`   | Items, final prices, what stops Publish, and the reach    |
| `POST`   | `/admin/events`                               | `event.create`  | Add a launch or a sale; it starts as a draft              |
| `POST`   | `/admin/events/:id/publish`                   | `event.publish` | Arm the event and send its message, or list what stops it |
| `POST`   | `/admin/events/:id/unpublish`                 | `event.publish` | Back to draft before the start                            |
| `POST`   | `/admin/events/:id/cancel`                    | `event.cancel`  | Cancel for good; a running sale's prices go back at once  |
| `POST`   | `/admin/events/:id/end-now`                   | `event.cancel`  | End a running sale now and keep its record                |
| `POST`   | `/admin/events/:id/test-message`              | `event.edit`    | Send the event message to the signed-in admin             |
| `POST`   | `/admin/events/:id/preview`                   | `event.index`   | A 30-minute link that opens the event popup on the shop   |
| `POST`   | `/admin/events/:id`                           | `event.edit`    | Save the event form                                       |
| `DELETE` | `/admin/events/:id`                           | `event.destroy` | Delete a draft                                            |

## Admin store routes

| Method   | Route                               | Access          | Purpose                                              |
| -------- | ----------------------------------- | --------------- | ---------------------------------------------------- |
| `GET`    | `/admin/store-locations`            | `setting.index` | Every store in display order, active or not          |
| `GET`    | `/admin/store-locations/:id`        | `setting.index` | One store with every language, for the form          |
| `POST`   | `/admin/store-locations`            | `setting.edit`  | Add a store; it goes last in the order               |
| `POST`   | `/admin/store-locations/order`      | `setting.edit`  | Save the order dragged in the list                   |
| `POST`   | `/admin/store-locations/:id/active` | `setting.edit`  | Show or hide the store on Contact Us                 |
| `POST`   | `/admin/store-locations/:id`        | `setting.edit`  | Save the store form                                  |
| `DELETE` | `/admin/store-locations/:id`        | `setting.edit`  | Delete a store; its photos stay in the media library |

## Admin mailbox and inbox routes

| Method | Route                                                                   | Access           | Purpose                                                             |
| ------ | ----------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `GET`  | `/admin/mailboxes`                                                      | `mailbox.manage` | Connected mailboxes, their reader counts and the Contact Us mailbox |
| `POST` | `/admin/mailboxes/connect`                                              | `mailbox.manage` | Google's sign-in address for connecting a mailbox                   |
| `GET`  | `/admin/mailboxes/oauth/callback`                                       | Public           | Google's answer; returns to the admin's Mailboxes tab               |
| `PUT`  | `/admin/mailboxes/contact-target`                                       | `mailbox.manage` | Choose where Contact Us messages go                                 |
| `GET`  | `/admin/mailboxes/:id/access`                                           | `mailbox.manage` | Who may read or send from one mailbox                               |
| `PUT`  | `/admin/mailboxes/:id/access`                                           | `mailbox.manage` | Replace one mailbox's access list                                   |
| `POST` | `/admin/mailboxes/:id/refresh`                                          | `mailbox.manage` | Re-read the mailbox's send-as addresses from Gmail                  |
| `POST` | `/admin/mailboxes/:id/disconnect`                                       | `mailbox.manage` | Withdraw access at Google and forget the token                      |
| `GET`  | `/admin/inbox`                                                          | `mailbox.use`    | The mailboxes the operator may open, with unread counts             |
| `GET`  | `/admin/inbox/:mailboxId/threads`                                       | `mailbox.use`    | One folder of a mailbox, a page at a time                           |
| `GET`  | `/admin/inbox/:mailboxId/threads/:threadId`                             | `mailbox.use`    | A whole conversation, cleaned for display                           |
| `GET`  | `/admin/inbox/:mailboxId/messages/:messageId/attachments/:attachmentId` | `mailbox.use`    | One attachment, always as a download                                |
| `POST` | `/admin/inbox/:mailboxId/send`                                          | `mailbox.use`    | Reply, forward or write, from the mailbox or one of its aliases     |
| `POST` | `/admin/inbox/:mailboxId/threads/:threadId/modify`                      | `mailbox.use`    | Mark read or unread, archive, move to Inbox, trash or restore       |

The Gmail token stays on the server. `mailbox.use` opens only the mailboxes whose access list names the operator.

## Public catalogue routes

| Method | Route                                      | Access             | Purpose                                                                        |
| ------ | ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------ |
| `GET`  | `/catalog/search`                          | Public             | Typeahead and search results, one page at a time                               |
| `POST` | `/catalog/search/clicks`                   | Public             | Count a product opened from search results                                     |
| `GET`  | `/catalog/search/trending`                 | Public             | Products most opened from search lately, or bestsellers                        |
| `GET`  | `/catalog/categories`                      | Public             | Get the full category taxonomy tree                                            |
| `GET`  | `/catalog/categories/:slug`                | Public             | Get a single category by slug                                                  |
| `GET`  | `/catalog/categories/menu`                 | Public             | The shop menu, in the language asked for                                       |
| `GET`  | `/catalog/faq`                             | Public             | Live FAQ entries for one page                                                  |
| `GET`  | `/catalog/questions`                       | Public             | Answered questions for one product                                             |
| `POST` | `/catalog/questions`                       | Public             | Ask a product question                                                         |
| `GET`  | `/catalog/products`                        | Public             | List live products with filtering and pagination                               |
| `GET`  | `/catalog/products/legacy-redirects`       | Public             | Redirect rows for the storefront resolver                                      |
| `GET`  | `/catalog/products/:idOrSlug/relations`    | Public             | Saved related, upsell, cross-sell, and bought-together cards                   |
| `GET`  | `/catalog/products/:idOrSlug/trending`     | Public             | Trending in the product's categories, topped up with bestsellers               |
| `GET`  | `/catalog/products/:idOrSlug/gallery`      | Public             | Gallery frames for quick view and the product page                             |
| `GET`  | `/catalog/products/:idOrSlug/view`         | Public             | Card and product-page read model for one live product                          |
| `GET`  | `/catalog/products/:idOrSlug`              | Public             | Get a single product by id or slug                                             |
| `POST` | `/catalog/products/:idOrSlug/stock-alerts` | Storefront session | Ask to be told when a variant can be bought                                    |
| `GET`  | `/catalog/home`                            | Public             | Homepage rails                                                                 |
| `GET`  | `/catalog/placements`                      | Public             | Category listing by placement path                                             |
| `GET`  | `/catalog/cards`                           | Public             | Live cards for a personal slug list                                            |
| `GET`  | `/catalog/recent-purchases`                | Public             | Real sales from the last day, without buyer data                               |
| `GET`  | `/catalog/seo-route`                       | Public             | Head data for one public address                                               |
| `GET`  | `/catalog/sitemap`                         | Public             | Indexable addresses for the sitemap                                            |
| `GET`  | `/catalog/live-paths`                      | Public             | Live product slugs and category paths                                          |
| `GET`  | `/catalog/share-settings`                  | Public             | The share menu's shop-wide choices                                             |
| `GET`  | `/catalog/code/:code`                      | Public             | The product slug behind a short `/p/<code>` address                            |
| `GET`  | `/catalog/reviews`                         | Public             | A product's approved reviews and rating summary                                |
| `GET`  | `/catalog/blog/posts`                      | Public             | Live posts, sticky first then newest, one page at a time                       |
| `GET`  | `/catalog/blog/posts/:slug`                | Public             | One live post by its address                                                   |
| `GET`  | `/catalog/blog/categories`                 | Public             | Blog categories that hold a live post                                          |
| `GET`  | `/catalog/blog/tags`                       | Public             | Blog tags that hold a live post                                                |
| `GET`  | `/catalog/events`                          | Public             | Published launch and sale events, with the server clock                        |
| `GET`  | `/catalog/events/preview`                  | Public             | One event's popup through the admin's 30-minute preview link, published or not |
| `GET`  | `/catalog/store-locations`                 | Public             | Active stores in display order, in one language                                |

Listing, product and home reads are cacheable for 60 seconds with `stale-while-revalidate=300`, and carry an ETag. `GET /catalog/cards`, `GET /catalog/search` and the legacy redirect list are `no-store`. `GET /catalog/search/trending` is cacheable for five minutes.

### Public visibility rule

The server enforces public visibility, not the caller. Public repository calls default to the `public` audience, resolve the status filter to `live`, and return 404 for hidden products. The public routes accept no `status` parameter.

## Storefront media and review routes

| Method  | Route                                          | Access             | Purpose                                                                    |
| ------- | ---------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| `GET`   | `/media/upload-rules`                          | Public             | Size, type and count limits for uploads                                    |
| `GET`   | `/storefront/banners`                          | Public             | A page's live banners, resolved for the locale                             |
| `GET`   | `/storefront/brand`                            | Public             | Logo sets, icons, link preview picture, profiles, store links and colours  |
| `GET`   | `/storefront/youtube/rail`                     | Public             | Cached latest channel videos for a placement                               |
| `POST`  | `/storefront/reviews/photos/presign`           | Storefront session | Start a review photo upload (verified buyers only)                         |
| `POST`  | `/storefront/reviews/photos/:assetId/finalize` | Storefront session | The photo upload finished; queue processing                                |
| `GET`   | `/storefront/reviews/photos/:assetId/status`   | Storefront session | Processing state of a review photo                                         |
| `GET`   | `/storefront/reviews/mine`                     | Storefront session | Whether you can review a product, are waiting for delivery, or your review |
| `POST`  | `/storefront/reviews`                          | Storefront session | Submit a review with up to five photos; held for moderation                |
| `PATCH` | `/storefront/reviews/:reviewId`                | Storefront session | Edit your review; it waits for approval again                              |

Uploads go directly to Spaces through a presigned PUT. The API does not proxy image bytes. Review photos stay private until a moderator approves them.

## Storefront wishlist and contact routes

| Method   | Route                             | Access             | Purpose                                             |
| -------- | --------------------------------- | ------------------ | --------------------------------------------------- |
| `GET`    | `/storefront/wishlist`            | Storefront session | Your saved product ids, and cards for those on sale |
| `POST`   | `/storefront/wishlist`            | Storefront session | Save a product; saving it again changes nothing     |
| `POST`   | `/storefront/wishlist/merge`      | Storefront session | Move the guest list into the account on sign-in     |
| `DELETE` | `/storefront/wishlist/:productId` | Storefront session | Remove a saved product                              |
| `POST`   | `/storefront/contact-messages`    | Public             | Send a Contact Us message to the shop's mailbox     |

The wishlist has no customer id in any route; the session names the owner. Wishlist writes and Contact Us messages are rate-limited.

## Currency and promotion routes

| Method | Route                  | Access | Purpose                                                  |
| ------ | ---------------------- | ------ | -------------------------------------------------------- |
| `GET`  | `/currency`            | Public | List enabled currencies                                  |
| `GET`  | `/currency/convert`    | Public | Convert a canonical INR amount into a target currency    |
| `GET`  | `/promotions/active`   | Public | List active promotions                                   |
| `POST` | `/promotions/validate` | Public | Validate a coupon code and return the matching promotion |

These routes support price display. They do not produce a checkout total.

## Cart routes

| Method   | Route                         | Access | Purpose                                            |
| -------- | ----------------------------- | ------ | -------------------------------------------------- |
| `GET`    | `/cart/current`               | Public | The shopper's cart, priced from the live catalogue |
| `POST`   | `/cart/current/lines`         | Public | Add a line, starting a cart when there is none     |
| `PATCH`  | `/cart/current/lines/:lineId` | Public | Change a line quantity or its choices              |
| `DELETE` | `/cart/current/lines/:lineId` | Public | Remove a line                                      |
| `GET`    | `/cart/:id`                   | Public | Read a cart by id, for its owner or support staff  |

Cart routes are reachable without an account. Ownership is still enforced: a signed-in customer owns a cart through the session, and a guest owns one through the hashed `st_guest` cookie. A mismatch returns 404.

The browser sends choices, never prices. Every read re-prices each line from the live product, and a write is refused when the choice is unavailable or the stock is short. Cart writes are rate-limited.

## Order routes

| Method  | Route                | Access         | Purpose                                        |
| ------- | -------------------- | -------------- | ---------------------------------------------- |
| `POST`  | `/orders`            | Public         | Create an order from a cart                    |
| `GET`   | `/orders`            | Public         | List the authenticated user’s orders           |
| `GET`   | `/orders/:id`        | Public         | Get one of the caller’s own orders             |
| `PATCH` | `/orders/:id/status` | `order.update` | Update an order’s status (admin audience only) |

Order creation validates cart ownership, then saves the order and removes the cart in one transaction. Reads return 404 for an order the caller does not own, unless the caller is an admin holding `order.index`.

## Privacy routes

| Method | Route              | Access  | Purpose                                                  |
| ------ | ------------------ | ------- | -------------------------------------------------------- |
| `GET`  | `/privacy/consent` | Public  | Current effective consent for the caller (user or guest) |
| `POST` | `/privacy/consent` | Public  | Record a consent decision (append-only)                  |
| `POST` | `/privacy/export`  | Session | Request a personal-data export (acknowledged)            |
| `POST` | `/privacy/erase`   | Session | Request account erasure (acknowledged for review)        |

Consent changes are append-only: each change adds a `consentEvents` row. Export and erasure requests return an acknowledgement.

## Global request controls

`apps/api/src/bootstrap.ts` applies these to every request:

- Helmet security headers.
- A rate limit keyed by client IP. Cacheable public reads are exempt; search and all writes count.
- CORS with exact allowed origins and credentials.
- A correlation id in the `x-request-id` header.
- Log redaction for credentials and sensitive body fields.
- One error shape, `ApiErrorResponse`, for every failure.
- Response compression with Brotli or gzip above 1 KB.

## Limitations

- No route takes a payment, books a shipment or processes a refund or return.
- `POST /orders` has no idempotency key, stock reservation or quote. A retried request can create a second order.
- Export and erasure requests are acknowledged but not executed.
- Health readiness answers 503 when MongoDB or Redis is down. Search is reported but not required, because the shop lists from MongoDB without it.

## Adding a route

Before you add a route, record:

1. The owning module and the actor.
2. The method, path and request contract.
3. The authentication, audience and CSRF rules.
4. The ownership or permission rule.
5. The use case and ports.
6. Transaction, idempotency and version needs.
7. The response and error contracts.
8. Side effects, audit records and outbox messages.
9. The rate limit, privacy and logging rules.
10. The tests and the OpenAPI update.

Keep public and privileged operations in separate controllers.
