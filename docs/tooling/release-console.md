---
title: Release Console
description: The owner's dashboard for projects, repositories, releases and cloud accounts; its lock, its levels, its Keychain connections and its local API.
status: implemented
audience: [operator, frontend, backend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/release-console
    - apps/release-console-api
    - packages/release-console-contracts
    - .release-console.json
    - .github/workflows/ci.yml
---

# Release Console

The Release Console is an owner-only dashboard for projects, their repositories, releases, servers and cloud accounts. It runs only on the owner's Mac and is never deployed or published as an image. It is in English only.

| Part          | Package                              | Where it runs                                 |
| ------------- | ------------------------------------ | --------------------------------------------- |
| Console app   | `apps/release-console`               | Angular, client-only, `http://localhost:4400` |
| Local API     | `apps/release-console-api`           | NestJS on Fastify, `http://127.0.0.1:4410`    |
| Shared shapes | `packages/release-console-contracts` | zod schemas used by both                      |

## Running it

```bash
pnpm console
```

This starts the app and its API together. The `release-console` and `release-console-api` entries in `.claude/launch.json` start them one at a time. The app finds its API at its own port plus 10, so a second copy on port 4401 talks to an API on 4411.

## The lock

The console opens behind a 6-digit PIN that is set on the first run, typed once and then again to confirm.

- The PIN is typed straight into the six boxes. The first box takes the keyboard when the screen opens; each digit moves to the next box, Backspace goes back, the arrow keys move between boxes, and a pasted or autofilled PIN spreads over the boxes. The sixth digit submits.

- The PIN is stored as a salted scrypt hash, never as digits.
- Five wrong tries lock the console for 15 minutes. The lock is kept in the console file, so restarting the API does not lift it.
- Unlocking returns a random session token. The app keeps it in the tab's session storage and sends it as the `x-console-session` header. The API keeps sessions in memory only: they end after 30 idle minutes, on **Lock**, and when the API restarts.
- Every route needs the session except `GET /api/health` and the `/api/lock/*` routes. A `401` sends the app back to the lock screen.
- Console settings has **Lock now** and **Change PIN** (the current PIN is required).

## Levels

The console has three levels. Search (⌘K) is on at every level and finds only what that level can open; it never looks across projects or into another repository.

| Level      | Address                       | Menus                                                                                                                                             |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console    | `/console/…`                  | All projects (grouped by workspace), Add a project, Attention, Audit (every project), Console settings                                            |
| Project    | `/p/:project/…`               | Overview, Repositories, Environments, Attention, Audit, Project settings (Connections, Repositories, Environments, Project menus, Remove project) |
| Repository | `/p/:project/r/:repo/:screen` | Overview, the repository's own menus, Ship, Watch, Run, one group per cloud platform, one group per edge platform, Governance                     |

The top bar holds the **Project** switcher (amber), the **Repository** switcher (cyan, with **Project overview** first) and the environment tabs of the open repository. The console level has no environment tabs.

Attention lists what needs the owner: keys that are expiring (14 days or less), expired or failed; vendor slots with no key; the latest run of a workflow on `main`, `staging` or `dev` that failed; and runs waiting for approval. The console level shows only project names and counts.

## Projects, repositories and vendor slots

A project has one or more repositories. Each repository has:

- **one source-code vendor**: GitHub, GitLab, Bitbucket or Azure Repos;
- **one or more cloud platforms**: DigitalOcean, AWS, Google Cloud or Azure; each environment runs on one of them or on this computer;
- **one or more edge platforms**: Cloudflare, AWS CloudFront with Route 53, or Fastly; each domain belongs to exactly one;
- **its own menus**, listed in its `.release-console.json`.

GitHub, DigitalOcean and Cloudflare have screens. Any other vendor can be chosen; its group shows **Screens later** until its own screens are built the way that vendor works. Each vendor is an adapter behind one shape per slot (source code, cloud, edge) in `apps/release-console-api/src/vendors/`.

### Adding and changing repositories

**Add a project** walks through seven steps: name and workspace, repositories (a vendor each), environments and where each runs, cloud platforms, edge platforms with their domains, the repositories' own menus, and a summary. When a GitHub repository is added, the wizard reads its `.release-console.json` from the default branch through the GitHub CLI sign-in and ticks its own menus; a repository on another vendor gets its menus ticked by hand. The new project opens on its Connections tab.

Project settings › **Repositories** (also reached from a repository's **Repository settings**) changes a repository after the project exists:

- its role, environments (where each runs and its domains), cloud platforms, edge platforms with their domains, and own menus;
- **+ Add repository**: a vendor and `owner/name`; the new repository starts with the first repository's environments, clouds and edges, keys included, and with the own menus of its `.release-console.json` when GitHub has one;
- **Remove repository**: the project keeps at least one repository, and its keys stay.

Slots that stay keep their keys. A cloud or edge platform added later starts without a key. Removing a cloud moves the environments that ran on it back to this computer. Key ids the project does not hold are dropped when a repository is saved.

### Where the data lives

| What                                           | Where                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Projects, key references, PIN hash, lock state | `~/Library/Application Support/Release Console/console.json` (owner-only, `0600`) |
| Audit trail                                    | `audit.jsonl` beside it                                                           |
| Key values                                     | The macOS login Keychain only                                                     |

The console starts with no projects. Every project, Saha Textile included, is added by the owner with **Add a project**, choosing its repositories, environments, cloud and edge platforms and own menus, and is then connected on its Connections tab. Nothing is imported on its own.

A repository's `.release-console.json` at its root lists only its own menus, for example `{ "menus": ["payments", "messages", "clients", "seo"] }`. The wizard and **+ Add repository** read it from the repository's default branch on GitHub and tick those menus. It holds no secrets and never adds a project.

## Connections and the Keychain

Project settings › **Connections** lists every key by category and repository: source code, cloud platforms, and edge, DNS and security. Below them, **Keys** lists each key with its account, rights, expiry, last check and state, with **Check** and **Remove**.

Keys are a token paste or a browser sign-in, never a password. **Add a key** offers each kind with where to make it; **Use it for** lists the matching slots of this project's repositories, all ticked.

- A pasted key goes once to the local API, which writes it to the login Keychain with `security -i` and the command on standard input, so the value never appears in the list of running processes.
- The Keychain item has the service `Release Console` and the account `<Project name> · <key id>`. One key serves every repository of the same project that uses the same account; it never serves another project.
- No answer from the API ever contains a key value, and the console file holds only references.
- Removing a key deletes its Keychain item. Removing a project deletes all of that project's items and no other project's.
- Every key is checked as soon as it is stored. The states are verified, expiring (14 days or less), expired, failed and unchecked.

| Key                                 | Made where                                                                                                                                                    | Checked with                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GitHub CLI sign-in on this computer | `gh auth login` in a terminal; the browser finishes it. **Link and check** links it to the chosen repositories; nothing is pasted or stored.                  | `gh auth token`, then GitHub's `/user` and access to each repository that uses it                                  |
| GitHub fine-grained token           | GitHub › Settings › Developer settings, limited to the repository, read-only                                                                                  | `/user`, repository access, and GitHub's own expiry header                                                         |
| DigitalOcean API · read / change    | DigitalOcean › API › Tokens, with an expiry                                                                                                                   | `/v2/account`; DigitalOcean does not report a token's expiry, so the date typed at paste time is used              |
| DigitalOcean Spaces key             | DigitalOcean › Spaces Object Storage › Access Keys, pasted as `ACCESS_KEY:SECRET`, with its bucket as `region/bucket` (for example `sgp1/saha-textile-media`) | Lists one object of the bucket, signed with AWS Signature Version 4; works for keys limited to that bucket         |
| Cloudflare API · read / change      | The Cloudflare account that holds `sahatextile.com` › Manage account › API Tokens                                                                             | `/user/tokens/verify`; an account token is verified at `/accounts/{id}/tokens/verify`, which also gives its expiry |

The console never makes a token or signs in for the owner. A browser sign-in for other vendors (a GitHub App, DigitalOcean, GitLab, Bitbucket, AWS, Google Cloud, Azure) needs an OAuth application registered on that vendor by the owner; until then those vendors take a pasted token. Cloudflare takes a pasted token only.

## Live screens

| Repository screen                           | Reads                                                                                                                                   | Before a key is pasted                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Overview, Run › Services                    | Docker on this computer (containers whose names start with the repository's id) and, for the shop's own stack, the shop API's readiness | Live for environments on this computer; environments on a cloud show their domains until the agent is linked on their servers |
| Ship › Pull requests (Open PRs tab)         | GitHub, open pull requests                                                                                                              | Not connected until the GitHub CLI sign-in or a GitHub token is linked on Connections                                         |
| Ship › Pipelines (All runs tab)             | GitHub Actions, the latest 30 runs                                                                                                      | Not connected until the GitHub CLI sign-in or a GitHub token is linked on Connections                                         |
| DigitalOcean › Droplets (Droplets tab)      | Every droplet the key sees                                                                                                              | Not connected                                                                                                                 |
| DigitalOcean › Cloud account (Overview tab) | Team, droplet limit, month-to-date usage and balance                                                                                    | Not connected                                                                                                                 |
| Cloudflare › Domains (Registrations tab)    | Every site (zone) the token sees                                                                                                        | Not connected                                                                                                                 |
| Cloudflare › DNS (Records tab)              | Every record in the edge slot's first domain                                                                                            | Not connected                                                                                                                 |

Each vendor read answers in one of three ways: data, **not connected** (with a button to Connections), or an error with the vendor's reason. DigitalOcean screens read with the read key when the slot has one, and with the change key otherwise. Every other screen and tab describes what it will show; items the console cannot do are red and disabled, and items it can do in part are yellow.

## Local API

The API listens on `127.0.0.1` only and accepts browser requests only from the console page (`CONSOLE_ORIGIN`). Request bodies and every answer the app reads are parsed with the shared zod schemas.

| Route                                                                                                | Answer                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                                                                    | `{ status: 'ok', version }`                                                                                           |
| `GET /api/lock/status`, `POST /api/lock/setup`, `…/unlock`, `…/lock`, `…/pin`                        | Lock state, first PIN, unlock, lock now, change PIN                                                                   |
| `GET /api/projects`, `POST /api/projects`, `DELETE /api/projects/:id`                                | Projects and workspaces; add; remove with its Keychain items                                                          |
| `POST /api/projects/:id/keys`, `POST …/keys/:keyId/check`, `DELETE …/keys/:keyId`                    | Store a key and check it; check again; remove                                                                         |
| `PUT /api/projects/:id/slots`                                                                        | Which keys a repository's slot uses                                                                                   |
| `POST /api/projects/:id/repositories`, `PUT …/repositories/:repoId`, `DELETE …/repositories/:repoId` | Add, change or remove a repository                                                                                    |
| `POST /api/repository-file`                                                                          | A GitHub repository's own menus from its `.release-console.json`, before it joins a project                           |
| `GET /api/attention`, `GET /api/projects/:id/attention`                                              | Counts per project; one project's items                                                                               |
| `GET /api/audit?project=`                                                                            | Who did what, newest first                                                                                            |
| `GET /api/projects/:p/repos/:r/github/pulls` and `…/github/runs`                                     | Pull requests and workflow runs                                                                                       |
| `GET …/cloud/:slot/droplets` and `…/cloud/:slot/account`                                             | Droplets and the cloud account                                                                                        |
| `GET …/edge/:slot/zones` and `…/edge/:slot/zones/:zone/dns`                                          | Sites and DNS records                                                                                                 |
| `GET /api/local/services?repo=`, `GET /api/local/readiness?repo=`                                    | The repository's containers on this computer; the shop API's readiness for the shop's own stack, `unknown` for others |

| Setting                   | Default                                         |
| ------------------------- | ----------------------------------------------- |
| `CONSOLE_API_PORT`        | `4410`                                          |
| `CONSOLE_ORIGIN`          | `http://localhost:4400`                         |
| `CONSOLE_DATA_DIR`        | `~/Library/Application Support/Release Console` |
| `CONSOLE_STACK_PREFIX`    | `saha-textile`                                  |
| `CONSOLE_LOCAL_READY_URL` | `http://localhost:4000/health/ready`            |

Tests point `CONSOLE_DATA_DIR` at a temporary folder and use an in-memory Keychain, so they never touch the owner's file or Keychain and never use a real token.

## Checks

The shop's CI skips the console. A separate `console` job runs `pnpm check:console` (lint, types, tests and build) only when a pull request changes the console packages or shared setup files such as the lock file, root `package.json`, `turbo.json` or the CI file.
