---
title: Operator Path
description: Onboarding route for deployment and runtime operations.
status: planned
audience: [operator]
last_verified: '2026-08-01'
source_of_truth:
    - docs/engineering-live-context/execution-roadmap.mdx
    - .cursor/rules/mcp-tools.mdc
    - .github/workflows
---

# Operator path

Use this path for local runtime readiness, deployment, rollback, monitoring, backup, restoration, incident response or third-party operational checks.

## Current scope

Production deployment, backup and restore verification, and final monitoring remain later roadmap phases. This section defines the runbook structure and required evidence; it does not claim that production procedures have been exercised.

## Read in this order

1. [Deployment overview](/deployment/overview)
2. [Operations overview](/operations/overview)
3. [Troubleshooting overview](/troubleshooting/overview)
4. [Failure recovery and debugging](/business-flows/failure-recovery-and-debugging) for business-journey symptoms
5. [Backend readiness and observability](/backend/readiness-testing-and-observability) for liveness, readiness and proof
6. [Mongo transactions and generated catalogue](/database/transactions-and-generation) for persistence/recovery boundaries
7. [Local development](/getting-started/local-development) for local environment assumptions

## Evidence required before an operation is called implemented

- A command or automation entry point exists.
- Required environment and permissions are documented without exposing secrets.
- Expected success output is recorded.
- Failure and rollback paths are documented.
- The procedure has been exercised in the appropriate environment.
- The verification date and evidence source appear in the portal.

## Interpretation boundaries

Do not infer production readiness from a successful build, a running API process or an unverified configuration file. Database connectivity, migrations, backups, external providers, secrets, network policy and recovery behaviour need independent evidence.
