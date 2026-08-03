---
title: OpenAPI and Scalar Reference
wide: true
description: OpenAPI source-of-truth rules, current Scalar scaffold, completeness gates, Test Request security, and build topology.
status: scaffolded
audience: [beginner, backend, frontend, operator]
last_verified: '2026-08-02'
source_of_truth:
    - apps/api/src/openapi.ts
    - apps/api/src/generate-openapi.ts
    - apps/api/src
    - apps/developer-portal-scalar
    - packages/adapters-db-mongo/src/repositories/auth.repository.ts
    - packages/adapters-db-mongo/test/auth-persistence.test.ts
    - packages/contracts/src
    - docs/engineering-live-context/project-progress.mdx
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
---

# OpenAPI and Scalar reference

The API-reference standard is ratified:

- OpenAPI is the machine-readable API source of truth.
- Scalar is the single human reference and approved interactive client.
- Do not maintain parallel long-term API-reference or separate console surfaces.

## Current state

NestJS creates one OpenAPI document through `apps/api/src/openapi.ts`. The API exposes it at `/openapi.json`, and the portal build now generates the same document without a MongoDB connection, publishes it at `/api/openapi.json`, and renders it through Scalar at `/api/reference/`.

The surface is deliberately labelled **scaffolded**. The document regenerated on 2026-08-01 contains **37 paths and 40 operations**. It now includes the split storefront/admin cookie-auth families and privacy routes as well as `/health/live`, `/health/ready`, `/auth/csrf`, and the backwards-compatible `/health` alias. The public `GET /catalog/products` operation has `page`, `pageSize`, `categoryId`, `tag`, and `search` query parameters—**not `status`**. Scalar makes the current evidence navigable; it does not repair or conceal its omissions.

Scalar’s **Test Request** control is enabled. Authentication is not persisted by Scalar, no external request proxy is configured, and the generated document declares only the approved local API server (`http://127.0.0.1:4000`). Normal API security controls remain in force: Test Request does not bypass authentication, CSRF, CORS, role or ownership authorization, or rate limits.

Session establishment and refresh write a readable, session-bound CSRF cookie alongside the httpOnly access and refresh cookies. For an unsafe request carrying that session:

1. retain the readable CSRF cookie written by register, login, OTP verification, or refresh;
2. copy that cookie value into the `x-csrf-token` request header; and
3. send the unsafe request with the access/refresh and CSRF cookies.

Missing, mismatched, or cross-session values fail with `403`. The CSRF token does not create a session, grant a role, prove object ownership, or increase the caller’s rate-limit allowance.

`GET /auth/csrf` works both before and during a session. For an active session, Policy B preserves a still-valid bound token; if the readable cookie is missing or desynchronized, the session service atomically rotates `csrfSecretHash` before issuing the replacement. Anonymous callers receive an unbound pre-session token. The route grants no identity or authorization by itself.

## Current Chunk D boundary

Chunk D is **partial**, not absent and not complete. Cookie sessions now use the tested Mongo repositories; access and opaque rotating refresh tokens live only in httpOnly cookies, refresh reuse revokes the family, CSRF is checked against the current session, and storefront/admin audiences are isolated. Storefront register/password login/OTP/refresh/logout/password reset/me, admin password/PIN login/PIN setup/refresh/logout/me, consent/privacy seams, and order ownership are implemented.

The remaining boundary is explicit:

- **D2 is done:** issue/refresh/revoke through httpOnly cookies, reuse-triggered family revocation, session-bound CSRF, and storefront/admin audience guards;
- **D3 is partial:** the storefront auth family and anti-enumeration responses are real, but email-verification completion and OAuth verification remain absent;
- **D4 is partial:** PIN login/setup/lockout, RBAC and permission-version invalidation are real, while invite acceptance and idle quick-resume remain absent; and
- **D5 is partial:** consent/privacy seams, order BOLA, cart Principal/`st_guest` ownership, and order-create cart adoption are real; guest→user merge, pending intents, and checkout idempotency remain Chunk G.

Scalar must distinguish these active controls from the residual gaps. A route appearing in OpenAPI is not proof that its request/response/security semantics are fully documented.

## Generated evidence snapshot

| Measurement                              | Generated result                                        | Meaning                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Paths / operations                       | 37 / 40                                                 | Storefront/admin auth and privacy routes are now published; three paths expose two methods.                                   |
| Declared servers                         | One: `http://127.0.0.1:4000`                            | Test Request has no production target or proxy.                                                                               |
| Operation tags                           | 40 / 40 operations                                      | Operations are grouped for navigation.                                                                                        |
| Explicit operation security              | 0 / 40 operations                                       | Runtime auth is cookie-session based, but no operation declares security; the only component scheme is stale bearer metadata. |
| Request bodies / component schemas       | 0 / 0                                                   | Controller-local zod bodies are not represented as reusable OpenAPI request contracts.                                        |
| Responses with content schemas           | 0 / 40 operations                                       | Runtime response values—including `ApiErrorResponse`—are not yet represented as generated response schemas.                   |
| Explicit non-success operation responses | 1 / 40 operations (`GET /health/ready` documents `503`) | Operation-specific error documentation is still almost entirely absent.                                                       |

Two generation runs produced byte-identical output without opening a MongoDB connection. That proves the current source generator is deterministic in this environment; it is not yet the required CI generation and drift gate.

:::warning Known OpenAPI defect

The document globally declares only a bearer scheme even though current browser authentication is cookie-only, and no operation attaches any security requirement. It therefore cannot teach Scalar which routes require a storefront/admin cookie audience, roles, ownership, or CSRF.

:::

## Promotion-gate status

The stable portal publication path and source-only generation without production secrets are real. The runtime platform also now returns one safe `ApiErrorResponse` envelope for every failure and correlates it with the `x-request-id` response header. However, that runtime error behavior is not encoded into operation response components or examples in the generated document.

Scalar therefore remains **scaffolded**. Promotion is still blocked by:

- complete request and response schemas;
- cookie-session, CSRF, storefront/admin audience, role and ownership semantics in the document;
- completion and documentation of email verification, OAuth verification, admin invite acceptance and quick-resume;
- documentation of cart guest/user ownership, order-create adoption, and the remaining guest→user merge;
- route-specific rate-limit semantics in the document;
- operation-specific error and idempotency examples;
- transactional, audit, outbox, notification, and provider side-effect documentation;
- CI generation plus required-path/tag/security and breaking-drift tests; and
- an approved non-production interaction target and policy;
- correction of the stale bearer scheme.

## Target portal routes

```text
/api/reference/     Scalar reference + approved interactive requests
/api/openapi.json   Machine-readable OpenAPI contract
```

The API may continue generating its internal `/openapi.json`; the portal build publishes or securely proxies the verified artifact at the stable portal route.

## Operation completeness

Every operation must document:

- purpose and owning audience;
- authentication and token/cookie audience;
- CSRF requirements;
- roles, permissions, ownership, or provider-signature policy;
- path/query/header/body schemas;
- response schemas by status;
- validation and business error codes;
- rate-limit behavior;
- idempotency/version requirements;
- pagination/filter/sort semantics;
- collections or external systems affected;
- audit/outbox/notification/provider side effects;
- examples that contain no secrets or real PII.

## Source pipeline

```mermaid
flowchart LR
    Contracts["Shared zod request/response contracts"] --> Controllers["Nest operation metadata"]
    Controllers --> Generator["Nest OpenAPI generation"]
    Generator --> Test["Schema and route smoke tests"]
    Test --> Artifact["Versioned OpenAPI artifact"]
    Artifact --> Scalar["Protected Scalar reference"]
    Artifact --> Clients["Typed clients / contract checks later"]
```

Do not manually maintain a second OpenAPI file that can drift from controllers/contracts.

## Contract-completeness promotion gate

The scaffold must not be promoted to an implemented/complete contract until all of these are true:

1. the API emits OpenAPI during CI without requiring production secrets;
2. core route families have explicit request/response schemas;
3. auth, CSRF, audience, permission, error and idempotency semantics are represented;
4. smoke tests assert required paths/tags/security schemes;
5. the artifact has a stable portal publication path;
6. approved development/staging server URLs and CORS/CSRF behavior are defined;
7. production interaction is disabled or protected with the complete private portal;
8. no secrets/default credentials are embedded in examples or configuration.

## Interactive-request security

The API client must obey the same controls as a real frontend:

- approved development/staging origins only;
- normal cookie behavior for the current browser client class;
- CSRF on unsafe cookie requests;
- server-side authorization and rate limits;
- no production secret storage;
- no auth bypass, privileged default token, or “try it” production mutation surface;
- sanitised saved examples and history.

Private portal authentication does not replace API authorization.

## Environment selector policy

The current scaffold shows its local-development server from the document itself. Before adding another environment, show an explicit badge/selector with an approved safe base URL. Prefer read-only or development fixtures by default. Dangerous operations require the same application permissions and should be visibly identified; the portal must not invent a separate superuser channel.

## Contract drift gates

- Generate the document in CI.
- Fail if required route/tag/security schemes disappear unexpectedly.
- Diff breaking changes deliberately.
- Run example/schema validation.
- Link operation changes to frontend/backend work.
- Update human guidance for business semantics the schema cannot express alone.

## Current limitations to fix before contract promotion

- controller-local zod body schemas do not automatically become complete OpenAPI component schemas;
- many response types are inferred from implementation rather than declared DTOs;
- query/path validation is incomplete;
- the shared runtime error envelope exists, but operation-specific errors, ownership, permissions, CSRF, rate limits, idempotency and side effects are still sparsely represented in OpenAPI;
- public versus admin tag/route segregation is incomplete;
- the current bearer component scheme is stale and no operation declares the real cookie-session requirements.

## Umbrella placement

Scalar is one generated surface under Docusaurus. The portal provides onboarding, architecture, workflows, failure recovery, database mappings, and operational context around it. Scalar owns operation-level API reading/execution; it does not replace those narrative responsibilities.
