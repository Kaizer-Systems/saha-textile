---
title: Troubleshooting Overview
description: Common local problems and how to fix them.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/execution-roadmap.mdx
    - docs/getting-started/local-development.md
---

# Troubleshooting overview

This page lists common local problems and how to fix them. For failures in business journeys, see [Failure recovery and debugging](/business-flows/failure-recovery-and-debugging).

## Start here

1. Read the error, and note the `x-request-id` from the response.
2. Check `/health/live` and `/health/ready`.
3. Check the API log for that request id.

## Local environment

| Symptom                                     | Likely cause                                 | Fix                                                                     |
| ------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `/health/ready` returns 503                 | MongoDB is not running                       | Run `pnpm mongo:up`, then `pnpm mongo:status`                           |
| The API refuses to start and lists settings | A strict deployment with unsafe settings     | Fix each listed variable, or set `DEPLOY_ENV=local` for the local stack |
| Port `27017` is taken                       | A native `mongod` is running                 | Set `MONGO_HOST_PORT` and match `MONGODB_PORT`                          |
| Transactions fail                           | MongoDB is not a replica set                 | Use the Docker profile                                                  |
| Search answers 503                          | Meilisearch is unset or down                 | Set `MEILISEARCH_HOST` and run `search:rebuild`                         |
| Uploads stay queued                         | The worker or Redis is not running           | Run `pnpm redis:up` and `worker:dev`                                    |
| Uploads are refused with a storage error    | Spaces is not configured                     | Set `SPACES_KEY`, `SPACES_SECRET` and `SPACES_BUCKET`                   |
| Server rendering fails on TLS               | Node does not trust the local certificate    | Start with `NODE_OPTIONS=--use-system-ca`                               |
| The browser calls `localhost` in the stack  | `/config.json` did not parse                 | Check that Nginx serves the file                                        |
| No code arrives locally                     | The console provider logs instead of sending | Set `OTP_LOCAL_FIXED_CODE`                                              |

## Sessions

| Symptom                                 | Likely cause                           | Fix                                                                          |
| --------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `403` with `reason: csrf_rejected`      | Stale or missing CSRF token            | The client fetches a token and retries once. Check the `x-csrf-token` header |
| `403` without a reason                  | Missing permission                     | Do not retry. Check the role and `GET /auth/admin/me`                        |
| `401` with `permissions_changed`        | A role changed                         | Sign in again                                                                |
| Sign-in fails with the correct password | The rate limit was reached             | Wait for the window to pass                                                  |
| PIN refused                             | PIN locked, or suspended after a reset | Sign in with the password                                                    |

## Portal

| Symptom                               | Likely cause                           | Fix                                                                        |
| ------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| "was verified … before newer sources" | A declared source changed              | Review the page, then update `last_verified`                               |
| "Schema Nebula must expose"           | A model was added or removed           | Update `docs/_data/instruments/schema-nebula.json` and the compiler counts |
| Storybook port error                  | The environment blocks local listening | Run outside the sandbox                                                    |
