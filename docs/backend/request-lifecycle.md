---
title: Request Lifecycle and Boundary Tracing
description: How a request enters the API, crosses application and domain boundaries, reaches an adapter, and returns safely.
status: scaffolded
audience: [beginner, backend, frontend]
last_verified: '2026-07-25'
wide: true
search_keywords: 'flight simulator photon post orders idempotency transaction ghost stages trace'
source_of_truth:
    - apps/api/src/main.ts
    - apps/api/src/app.module.ts
    - apps/api/src
    - apps/api/src/orders/orders.controller.ts
    - packages/core-domain/src
    - packages/core-domain/src/pricing
    - packages/adapters-db-mongo/src
    - apps/api/src/orders/orders.service.ts
    - packages/adapters-db-mongo/src/repositories/order.repository.ts
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/request-flight.json
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
---

import { FlightSimulator } from '@site/src/components/FlightSimulator';

# Request lifecycle and boundary tracing

A request is not “handled by the controller.” The controller is one checkpoint in a longer chain. A safe backend makes each checkpoint visible, testable, and replaceable.

<FlightSimulator />

## Current request path

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Fastify as Fastify/Nest bootstrap
    participant Pipe as ZodValidationPipe
    participant Guard as Optional guards
    participant Controller
    participant Service
    participant Port
    participant Mongo as Mongo repository/model

    Client->>Fastify: HTTP request
    Fastify->>Guard: Authenticate/authorize when decorated
    Guard-->>Fastify: Claims or exception
    Fastify->>Pipe: Parse selected request bodies
    Pipe-->>Controller: Typed value or 400
    Controller->>Service: Application call
    Service->>Port: Repository capability
    Port->>Mongo: Mongoose query/write
    Mongo-->>Service: Contract-shaped mapped value
    Service-->>Client: Nest serializes return value
```

This path exists, but it is inconsistent:

- not every route uses guards;
- body validation schemas usually live inside controllers rather than shared contract families;
- query/path parameters are often parsed manually;
- there is no global safe error envelope or explicit response serializer;
- authorization is sometimes a role check and sometimes absent;
- multi-record writes have no transaction context.

## Target request path

```mermaid
flowchart TD
    A["Untrusted request"] --> B["Request ID + client IP resolution"]
    B --> C["CORS / rate limit / security headers"]
    C --> D["Authentication + audience"]
    D --> E["CSRF for unsafe cookie requests"]
    E --> F["Zod request contract"]
    F --> G["Resource authorization"]
    G --> H["Application use case"]
    H --> I["Pure domain rules"]
    I --> J["Ports and optional unit of work"]
    J --> K["Adapters"]
    K --> L["Database or provider"]
    L --> M["Public-safe response contract"]
    M --> N["Sanitized response + audit/metrics"]

    F -->|invalid| X["Stable 4xx error envelope"]
    G -->|denied| X
    H -->|business conflict| X
    K -->|dependency failure| Y["Sanitized retriable/non-retriable error"]
```

## Trace template

Use this worksheet when debugging or documenting an endpoint.

| Question           | Record                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| Method and route   | Example: `POST /checkout/place-order`                                         |
| Actor and audience | Customer cookie session, admin cookie session, provider webhook, internal job |
| Authentication     | Required, optional, or forbidden                                              |
| Authorization      | Ownership, role, permission, consent, provider signature                      |
| CSRF               | Required for cookie-authenticated unsafe methods                              |
| Rate-limit bucket  | Global plus route-specific key and threshold                                  |
| Request contract   | Shared zod schema and version                                                 |
| Use case           | One application service method with explicit input/context                    |
| Domain invariants  | Stock, price, transition, identity, consent, idempotency                      |
| Ports              | Repository/provider capabilities used                                         |
| Transaction        | Records that must commit or roll back together                                |
| Response contract  | Actor-safe DTO; forbidden internal fields                                     |
| Errors             | Validation, authorization, conflict, dependency, unexpected                   |
| Side effects       | Audit, notification, search outbox, analytics, provider call                  |
| Proof              | Unit, integration, authorization, transaction, OpenAPI, runtime probe         |

## Example: current order creation

Current execution:

1. Bearer guard validates an access JWT.
2. `CreateOrderSchema` validates `cartId`, optional currency/gateway/coupon.
3. Controller attaches `user.sub`, but the service does not verify cart ownership.
4. Service loads the cart and each product.
5. Service computes a partial INR/conversion/coupon total.
6. Service saves the order.
7. Service deletes the cart in a separate write.

What is missing before this can be a production place-order flow:

- owned cart resolution;
- server quote/version and expiry;
- idempotency key;
- purchase eligibility and stock reservation;
- tax and shipping decisions;
- provider/gateway policy;
- separate payment attempt;
- immutable complete snapshots;
- one transaction across required records;
- rollback and replay tests.

## Error taxonomy

| Class             | Example                    | Client behavior                    | Log behavior                              |
| ----------------- | -------------------------- | ---------------------------------- | ----------------------------------------- |
| Validation        | Malformed quantity         | Correct highlighted input          | Request id and safe issue paths           |
| Authentication    | Missing/expired session    | Start or resume auth               | No token contents                         |
| Authorization     | Another user's order       | Generic forbidden/not found policy | Actor id, resource type/id hash, decision |
| Business conflict | Stock changed              | Refresh affected line/quote        | Invariant code and current version        |
| Idempotent replay | Order already placed       | Return/reconcile original outcome  | Original operation id                     |
| Dependency        | Search/payment unavailable | Degrade or retry by policy         | Adapter, latency, safe provider code      |
| Unexpected        | Programming/data error     | Stable generic 500                 | Redacted stack and correlation id         |

Never send stack traces, database documents, provider payloads, secrets, tokens, OTPs, raw IPs, or full address/customer data to the client.

## Read versus write checklist

### Read

- Scope the query by visibility and actor ownership, not after fetching when avoidable.
- Enforce pagination limits and deterministic sorting.
- Select only response-safe fields.
- Treat cache keys and `Vary` dimensions as part of correctness.
- Prevent non-public records from entering public search/cache layers.

### Write

- Authenticate, authorize the resource, and validate CSRF before mutation.
- Validate entity version when concurrent edits matter.
- Recalculate business truth server-side.
- Use idempotency for retryable high-value actions.
- Open a transaction when several durable facts must agree.
- Emit audit/outbox records inside the same consistency boundary when required.
- Return a versioned response DTO rather than a persistence document.

## Webhook variation

A provider callback is not a trusted internal call. Replace browser session checks with:

1. raw-body/signature verification;
2. replay/idempotency check;
3. known payment/shipment correlation;
4. legal state transition;
5. transactional write;
6. durable acknowledgement;
7. safe asynchronous follow-up.

The provider's “success” field alone never authorizes an order/payment transition.
