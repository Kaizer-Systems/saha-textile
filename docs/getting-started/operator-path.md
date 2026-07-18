---
title: Operator Path
description: Onboarding route for deployment and runtime operations.
status: planned
audience: [operator]
last_verified: '2026-07-18'
source_of_truth:
    - project-context/angular-context/execution-roadmap.md
    - project-context/angular-context/mcp-automation-setup.md
    - .github/workflows
---

# Operator path

Use this path for local runtime readiness, deployment, rollback, monitoring, backup, restoration, incident response or third-party operational checks.

## Current honesty boundary

The operations section is intentionally incomplete because production deployment, backup/restore verification and final monitoring are later roadmap phases. Treat this path as an approved runbook structure, not proof that production procedures have been exercised.

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

## Never infer

Do not infer production readiness from a successful build, a running API process or an unverified configuration file. Database connectivity, migrations, backups, external providers, secrets, network policy and recovery behaviour need independent evidence.
