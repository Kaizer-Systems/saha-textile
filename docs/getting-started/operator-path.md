---
title: Operator Path
description: Reading path for deployment and runtime operations.
status: planned
audience: [operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/execution-roadmap.mdx
    - .cursor/rules/mcp-tools.mdc
    - .github/workflows
---

# Operator path

Use this path for runtime readiness, deployment, rollback, monitoring, backup, recovery or third-party service checks.

## Scope

The local stack runs the production images on a developer machine. Hosted environments, automated deployment and backup procedures are planned. The pages below state which procedures are available and which are planned.

## Read in this order

1. [Deployment overview](/deployment/overview)
2. [Operations overview](/operations/overview)
3. [Troubleshooting overview](/troubleshooting/overview)
4. [Failure recovery and debugging](/business-flows/failure-recovery-and-debugging) for business symptoms
5. [Readiness, observability and verification](/backend/readiness-testing-and-observability) for health endpoints
6. [Transactions and generated catalogue](/database/transactions-and-generation) for persistence and recovery
7. [Local development](/getting-started/local-development) for local environment setup

## Requirements for an operational procedure

A procedure is ready for use when:

- A command or automation entry point exists.
- Required environment values and permissions are documented without exposing secrets.
- Expected output is recorded.
- Failure and rollback steps are documented.
- The procedure has been run in the matching environment.

## Reading health correctly

A successful build, a running API process or a parsed configuration file does not show that a deployment is healthy. Database connectivity, migrations, backups, external providers, secrets, network policy and recovery behaviour each need their own check.
