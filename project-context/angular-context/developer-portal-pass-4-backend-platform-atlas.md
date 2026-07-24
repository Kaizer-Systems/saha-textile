# Developer Portal Pass 4 — Backend Platform Atlas

**Status:** Implemented and verified on 2026-07-18

**Scope:** API, contracts, core-domain, adapter, security, persistence, OpenAPI and backend-verification documentation

**Portal runtime:** Docusaurus 3.10.2
**Depends on:** Pass 1 governance, Pass 2 frontend atlas and Pass 3 commerce journeys

## Purpose

Pass 4 teaches maintainers how trust and data cross the backend. It distinguishes real scaffolds from production guarantees and makes security, atomicity, generated-reference and proof obligations visible before a route is connected to live commerce.

## Implemented portal surfaces

- Interactive request-path atlas with catalogue, commerce, identity, operations and platform filters.
- Current-risk filters for critical, high and observe states.
- Three accessible lenses per path: current execution, locked target and how to prove it.
- Six-stage boundary pipeline per request path with repository evidence disclosures.
- Backend platform overview and beginner mental model.
- Current versus target request lifecycle, tracing worksheet and error taxonomy.
- Request/domain/persistence/response contract separation and zod/serialization rules.
- Core-domain, pricing and port inventory with swappability guidance.
- NestJS composition root, DI bindings, Mongo mapping and provider-adapter guidance.
- Cookie-session, CSRF, audience, permission, object-authorization, password/PIN/OTP guidance.
- Liveness/readiness, structured observability, test layers, transaction proof and backend definition of done.
- Complete present-controller route inventory with explicit missing guarantees.
- OpenAPI completeness and locked/deferred Scalar integration/security trigger.
- Current Mongo model/index/repository/mapper/seed/test map.
- Transaction/unit-of-work, migration, database-catalogue generation and backup/restore proof guidance.

## Code-versus-target reconciliation

### Critical current gaps

- Public `GET /catalog/products` does not force published status and accepts a caller-controlled status filter.
- `GET /catalog/products/:idOrSlug` also lacks a public-visibility response policy.
- Cart create/read/mutate routes do not authenticate/authorize user ownership or prove an opaque guest identity.
- `GET /orders/:id` authenticates a bearer token but does not compare order ownership.
- Order creation does not verify cart ownership, accept an idempotency key, reserve stock, create a payment attempt or run a transaction.
- Order save and cart deletion are separate writes, so partial failure can leave inconsistent state.
- Browser auth returns access and refresh JWTs in JSON and reads bearer auth only.
- Refresh tokens have no server-side family, atomic rotation, revocation or reuse detection.
- Password validation currently allows eight characters rather than the locked minimum 12 plus denylist.
- Predictable development JWT secrets are defaults without a production fail-closed guard.

### High current gaps

- The only health route reports process success while Mongo connection failure is deliberately non-fatal; readiness is not implemented.
- Admin order status uses roles only, with no admin audience, granular permission, CSRF, transition policy, entity version or audit record.
- Storefront search uses Mongo regular expressions; `SearchPort` has no Meilisearch binding and carries a superseded comment.
- Current Mongo config and API env guidance assemble/reference hosted-cluster/SRV configuration, conflicting with the locked Docker MongoDB 8.3 replica-set model.
- Nested Mongo product/cart/order/user structures frequently use Mongoose `Mixed` and adapter type assertions without runtime parsing.
- API OpenAPI operation metadata is incomplete because controller-local zod schemas and response shapes are not fully represented.
- API tests can pass with no tests; Mongo integration tests skip unless explicitly enabled and do not prove transactions.

### Architectural reconciliation gate

The repository constitution says `packages/core-domain` depends on nothing external, while current core port files import domain shapes from `packages/contracts`. Before expanding backend Phase B, explicitly decide whether core owns entities and contracts map them, or whether the constitution permits a dependency-free contracts shared kernel. Pass 4 records the conflict and does not choose silently.

## Documentation rules locked by Pass 4

- A present controller/port/model is not evidence of a secure end-to-end capability.
- Every documented request path separates authentication, authorization, validation, use case, domain invariant, port, adapter, transaction, response safety and proof.
- Public visibility is server-enforced; clients never opt into private catalogue states.
- Authentication never substitutes for object-level authorization.
- Storefront and admin audiences/routes remain distinguishable, and UI role visibility is not authorization.
- Persistence documents, domain values, request DTOs and actor-specific responses are separate shapes.
- External SDK/provider types remain inside adapters.
- Multi-record commerce/auth/inventory writes require an explicit transaction boundary and rollback tests.
- Liveness and readiness remain separate.
- OpenAPI is generated machine truth; Scalar is the only long-term human/API-client surface and remains deferred until completeness/security triggers pass.
- The generated database catalogue remains deferred until stable explicit models/indexes/mappings can produce deterministic, safe output.
- Pass 4 is documentation-only and does not authorize API/database/provider implementation.

## Interaction and accessibility contract

- Capability-area and current-risk filters use pressed-button semantics.
- Request selection uses native buttons with current-item state.
- Evidence lenses use tab semantics with Arrow Left/Right, Home and End keyboard support.
- The selected request exposes a six-stage ordered pipeline and native evidence disclosure.
- Desktop uses two rails, tablet converts the selector to a grid and mobile uses vertical pipeline steps.
- Focus visibility and reduced-motion behavior are explicit.

## Verification contract

1. Format all new/updated portal source and documentation.
2. Run metadata and prohibited-terminology validation.
3. Run portal TypeScript checking.
4. Run the optimized Docusaurus build.
5. Run whitespace/diff checks.
6. Verify all new routes through the persistent local preview.
7. Verify filter, selection, evidence-lens, keyboard and disclosure behavior when browser automation is available.
8. Check desktop/tablet/mobile overflow/readability manually in Chrome.

## Deferred from Pass 4

- API, database, auth, search or provider code changes.
- Docusaurus hot-reload memory repair.
- Scalar package/integration.
- Generated OpenAPI publication under the portal.
- Generated database catalogue and generator.
- Live Storybook/TypeDoc/Pagefind integration.
- Production runtime/deployment/backup/restore implementation.
