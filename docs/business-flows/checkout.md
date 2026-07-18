---
title: Checkout
description: Checkout flow documentation starter.
---

# Checkout

Checkout is not fully implemented yet. This page records the intended documentation shape so implementation PRs can fill it in incrementally.

```mermaid
sequenceDiagram
    actor Customer
    participant Storefront
    participant API
    participant Domain
    participant PaymentGateway
    participant MongoDB

    Customer->>Storefront: Confirm order
    Storefront->>API: Submit cart and checkout details
    API->>Domain: Validate cart, stock, pricing, and session
    Domain->>PaymentGateway: Create payment intent or hosted checkout
    Domain->>MongoDB: Persist pending order and payment records
    API-->>Storefront: Return next checkout step
```

## To complete during implementation

| Area                  | Link target                            |
| --------------------- | -------------------------------------- |
| Storefront route      | Locale-aware checkout route            |
| State/query operation | Cart and checkout query keys           |
| API endpoint          | OpenAPI operation                      |
| Collections           | Orders, payments, carts, inventory     |
| Recovery behavior     | Payment failure, abandoned cart, retry |
