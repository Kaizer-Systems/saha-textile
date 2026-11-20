---
title: Release Console
description: The owner's dashboard for projects, repositories, releases and cloud accounts; its Docker image, its lock, its levels, its Infisical keys, this Mac as an environment and its API.
status: implemented
audience: [operator, frontend, backend]
last_verified: '2026-11-20'
source_of_truth:
    - apps/release-console
    - apps/release-console-api
    - packages/release-console-contracts
    - .release-console.json
    - docker/release-console
    - scripts/release-console
    - .github/workflows/ci.yml
---

# Release Console

The Release Console is an owner-only dashboard for projects, their repositories, releases, servers and cloud accounts. It runs as one Docker container on the owner's Mac, and the same image can run on a server behind Cloudflare Access. It is in English only.

| Part          | Package                              | Where it runs                                                                     |
| ------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| Console app   | `apps/release-console`               | Angular, client-only; served by the console's own API process                     |
| Console API   | `apps/release-console-api`           | NestJS on Fastify, with its own SQLite database                                   |
| Mac helper    | `scripts/release-console/runner.mjs` | Node on the Mac, `127.0.0.1:4419`; reads the Mac and Docker, runs the local stack |
| Shared shapes | `packages/release-console-contracts` | zod schemas used by the app and the API                                           |
| Image         | `docker/release-console/`            | One image, one container (app + API + database), `127.0.0.1:4400`                 |

## Running it

```bash
pnpm console:up
```

From the main folder, this:

1. writes the console's key file from Infisical with the owner's own CLI login (`pnpm console:env`);
2. starts the Mac helper;
3. builds and starts the console container on `127.0.0.1:4400`;
4. waits until it answers.

`pnpm console:down` stops the container and the helper; the database volume is kept. `pnpm console:logs` follows the container's log. The helper refuses to start from a worktree, because it drives the stack and the pipeline in its own checkout. See `docker/release-console/README.md`.

While working on the console itself, `pnpm console` runs the app (Vite, 4400) and the API (4410) without Docker; the app then finds its API at its own port plus 10. The `release-console` and `release-console-api` entries in `.claude/launch.json` start them one at a time.

## The lock

The console opens behind a 6-digit PIN that is set on the first run, typed once and then again to confirm. A password can be added in Console settings; the lock screen then offers **PIN** and **Password**, opening with the one chosen there.

- The PIN is typed straight into the six boxes. The first box takes the keyboard when the screen opens; each digit moves to the next box, Backspace goes back, the arrow keys move between boxes, and a pasted or autofilled PIN spreads over the boxes. The sixth digit submits.
- The password has at least 12 characters. Setting, changing or removing it, and choosing which one the lock screen opens with, each need the PIN.
- Both are stored as salted scrypt hashes in the console's own database, never as typed and never in the Keychain.
- Five wrong tries of either lock the console for 15 minutes. The lock is kept in the database, so restarting the console does not lift it.
- Unlocking returns a random session token. The app keeps it in the tab's session storage and sends it as the `x-console-session` header. The API keeps sessions in memory only: they end after 30 idle minutes, on **Lock**, and when the console restarts.
- Every change that reaches beyond the console (starting a run, starting or stopping the stack, stopping a run) asks for the PIN or the password again. A wrong one counts toward the same lock, and a lock-out ends every session.
- Every route needs the session except `GET /api/health`, the `/api/lock/*` routes and the app's own files. A `401` sends the app back to the lock screen.

## Levels

The console has three levels. Search (⌘K) is on at every level and finds only what that level can open; it never looks across projects or into another repository.

| Level      | Address                       | Menus                                                                                                                                             |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console    | `/console/…`                  | All projects (grouped by workspace), Add a project, Attention, Audit (every project), Console settings                                            |
| Project    | `/p/:project/…`               | Overview, Repositories, Environments, Attention, Audit, Project settings (Connections, Repositories, Environments, Project menus, Remove project) |
| Repository | `/p/:project/r/:repo/:screen` | Overview, the repository's own menus, Ship, Watch, Run, one group per cloud platform, edge platform and secrets manager, Governance               |

The top bar holds the **Project** switcher (amber), the **Repository** switcher (cyan, with **Project overview** first) and the environment tabs of the open repository. The console level has no environment tabs.

Attention lists what needs the owner: keys that are expiring (14 days or less), expired or failed; vendor slots with no key; the latest run of a workflow on `main`, `staging` or `dev` that failed; and runs waiting for approval. The console level shows only project names and counts.

## Projects, repositories and vendor slots

A project has one or more repositories. Each repository has:

- **one source-code vendor**: GitHub, GitLab, Bitbucket or Azure Repos;
- **one or more cloud platforms**: DigitalOcean, AWS, Google Cloud or Azure; each environment runs on one of them or on this computer;
- **one or more edge platforms**: Cloudflare, AWS CloudFront with Route 53, or Fastly; each domain belongs to exactly one;
- **one or more secrets managers**: Infisical Cloud, Infisical (self-hosted), AWS Secrets Manager, Google Secret Manager, Azure Key Vault, Doppler, HashiCorp Vault or OpenBao, GitHub Actions secrets, or files on the server; each environment reads one of them, at a place inside it such as `saha-textile-dev · dev · /api`, or uses files kept by hand. A self-hosted manager needs its server's address;
- **its own menus**, listed in its `.release-console.json`.

GitHub, DigitalOcean and Cloudflare have screens. Any other vendor can be chosen; its group shows **Screens later** until its own screens are built the way that vendor works. Each vendor is an adapter behind one shape per slot (source code, cloud, edge) in `apps/release-console-api/src/vendors/`.

### Adding and changing repositories

**Add a project** walks through eight steps: name and workspace, repositories (a vendor each), environments and where each runs, cloud platforms, edge platforms with their domains, secrets managers and where each environment reads its secrets, the repositories' own menus, and a summary. When a GitHub repository is added, the wizard reads its `.release-console.json` from the default branch through the GitHub CLI sign-in and ticks its own menus; a repository on another vendor gets its menus ticked by hand. The new project opens on its Connections tab.

Each step carries its own icon, and every provider shows its logo beside its name: on its card, on the buttons that pick where an environment runs or reads its secrets, in tables, beside domain and address boxes, and in the summary. Project settings › Repositories shows them the same way. The browser loads the logos from Iconify (`api.iconify.design`) when the screen opens; Infisical and Doppler, which Iconify lacks, show their own site icon through Google's favicon service. No logo is kept in the repository or on the computer, and without a network the provider's name shows on its own.

The rest of the console follows the same rule. Every menu, screen, menu group, page title, tab, panel and search result has an icon; cloud, edge and secrets groups, the repository switcher, Connections and the project tables show the provider's logo; environment tabs show a laptop for this computer, a flask for staging and a globe for production; and this Mac's screens show the product each container runs (Node, Angular, NestJS, MongoDB, Redis, Meilisearch, Nginx or Docker). Icons are drawn in the colour of their text, so they dim, light and change colour with their item. The console fetches every icon once while the lock screen shows, so screens open with their icons in place. The icons live in `apps/release-console/src/app/shared/icons.ts`; a new screen needs an entry there, and a test fails until it has one.

Project settings › **Repositories** (also reached from a repository's **Repository settings**) changes a repository after the project exists:

- its role, environments (where each runs, its domains, and which secrets manager it reads and where), cloud platforms, edge platforms with their domains, secrets managers, and own menus;
- **+ Add repository**: a vendor and `owner/name`; the new repository starts with the first repository's environments, clouds and edges, keys included, and with the own menus of its `.release-console.json` when GitHub has one;
- **Remove repository**: the project keeps at least one repository, and its keys stay.

Slots that stay keep their keys. A cloud, edge platform or secrets manager added later starts without a key. Removing a cloud moves the environments that ran on it back to this computer; removing a secrets manager moves the environments that read it back to files kept by hand. An environment can only run on a cloud, and read a secrets manager, that its repository has. Key ids the project does not hold are dropped when a repository is saved.

### Where the data lives

| What                                                                                         | Where                                                                                                                            |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Projects, key links, PIN and password hashes, lock state, audit trail, stats and run history | `console.db` (SQLite) in the console's data folder: the Docker volume `saha_textile_release_console_data`, or `CONSOLE_DATA_DIR` |
| Key values                                                                                   | Infisical only (`saha-textile-dev · dev · /release-console`), read by the console from its key file                              |

The database file is readable by its owner only. A console that ran before the database existed has its `console.json` and `audit.jsonl` imported once on first start; the old files are renamed `*.imported`.

The console starts with no projects. Every project, Saha Textile included, is added by the owner with **Add a project**, choosing its repositories, environments, cloud and edge platforms and own menus, and is then connected on its Connections tab. Nothing is imported on its own.

A repository's `.release-console.json` at its root lists only its own menus, for example `{ "menus": ["payments", "messages", "clients", "seo"] }`. The wizard and **+ Add repository** read it from the repository's default branch on GitHub and tick those menus. It holds no secrets and never adds a project.

## Connections and Infisical

Project settings › **Connections** lists every key by category and repository: source code, cloud platforms, edge, DNS and security, and secrets managers (with the environments that read each one). Below them:

- **Key file** shows the Infisical folder, when the key file was written, and the names it holds, lacks or leaves blank by choice. It shows names only, never values.
- **Keys** lists each key with its Infisical names, account, rights, expiry, last check and state, with **Check** and **Unlink**.
- **Link a key** offers each kind with where to make it and its Infisical name. **Use it for** lists the matching slots of this project's repositories, all ticked.

Keys never pass through the console. The owner saves each key in Infisical; `pnpm console:env` writes the console's key file from there with the owner's own CLI login, so no machine identity is used; the console reads the file again whenever it changes.

- When Infisical cannot be read, `pnpm console:env` keeps the last key file and says so.
- No answer from the API ever contains a key value, and the console's database holds only links.
- Unlinking a key or removing a project drops links only; the keys stay in Infisical.
- Every key is checked as soon as it is linked. The states are verified, expiring (14 days or less), expired, failed and unchecked.

| Infisical name                                           | Key                                 | Made where                                                                                                                                                                                       | Checked with                                                                                                       |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `CONSOLE_GITHUB_TOKEN`                                   | GitHub fine-grained token           | GitHub › Settings › Developer settings: owner Kaizer-Systems, this repository only; Actions read and write, Contents, Pull requests, Deployments, Environments, Commit statuses and Secrets read | `/user`, repository access, and GitHub's own expiry header                                                         |
| none                                                     | GitHub CLI sign-in on this computer | `gh auth login`; works only when the console runs outside Docker                                                                                                                                 | `gh auth token`, then the same as above                                                                            |
| `CONSOLE_DO_READ_TOKEN`, `CONSOLE_DO_WRITE_TOKEN`        | DigitalOcean API · read / change    | DigitalOcean › API › Tokens, with an expiry; the change token is optional                                                                                                                        | `/v2/account`; DigitalOcean does not report a token's expiry, so the date typed when linking is used               |
| `CONSOLE_SPACES_ACCESS_KEY`, `CONSOLE_SPACES_SECRET_KEY` | DigitalOcean Spaces key             | DigitalOcean › Spaces Object Storage › Access Keys: Limited Access, the shop bucket, Read; linked with its bucket as `region/bucket` (for example `sgp1/saha-textile-media`)                     | Lists one object of the bucket, signed with AWS Signature Version 4                                                |
| `CONSOLE_CF_READ_TOKEN`, `CONSOLE_CF_WRITE_TOKEN`        | Cloudflare API · read / change      | The Cloudflare account that holds `sahatextile.com` › Manage account › Account API tokens; the read token uses **Read all resources**; the change token is optional                              | `/user/tokens/verify`; an account token is verified at `/accounts/{id}/tokens/verify`, which also gives its expiry |

The console never makes a token or signs in for the owner. A browser sign-in for other vendors (a GitHub App, DigitalOcean, GitLab, Bitbucket, AWS, Google Cloud, Azure) needs an OAuth application registered on that vendor by the owner. Cloudflare takes a pasted token only.

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

### This Mac as an environment

For an environment that runs on this computer, the console reads the Mac and Docker through the Mac helper. The helper runs its read-only tools without blocking and shares one reading of the Mac, Docker or the shop's health between requests that arrive within two seconds, so it answers at once even while `docker stats` is still running. These screens stand where a server's figures will stand once the server agent exists.

| Repository screen              | Shows                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship › Live deploy (Local tab) | `pnpm pipeline:local` from the console: a full run, from a stage, or one stage only, started and stopped with the PIN or password. The brief's lane (each stage's state and time), ring and Systems panel follow the run's events live; the output shows events only or every line. Stack controls write the stack's files, start the stack, and stop or start the stack's own services. Recent runs are listed. One run at a time. |
| Run › Server (Metrics tab)     | CPU, memory (in use, compressed, wired), swap, load, the start-up disk and network rates, Docker's virtual machine, and history charts for 15 minutes, an hour, a day or a week                                                                                                                                                                                                                                                     |
| Run › Infrastructure           | Every Saha Textile container with its state, CPU, memory against its limit, network and disk rates and processes; a click shows its last hour                                                                                                                                                                                                                                                                                       |
| Run › Live logs                | One container's log, followed every 3 seconds, errors only, or one request (from a request id); the apps' JSON lines and the edge's request lines are read into time, level, source and message                                                                                                                                                                                                                                     |
| Watch › Health                 | One tile per part: Docker, each container, the shop API under `pnpm dev` and under the stack                                                                                                                                                                                                                                                                                                                                        |
| Watch › Alerts                 | Rules: the local rules (start-up disk over 85%, a stack container stopped or unhealthy for 30 s, the Mac helper silent for a minute, the latest local run failed, a key expiring or failing, server errors over 5% for 5 minutes) with their state. Firing now: each firing alert with the steps to fix it, and the alerts that ended in the last 7 days                                                                            |
| Watch › APM                    | Services: p95 and server-error charts, and per service requests a minute, p50, p95, p99, errors and Apdex, with the slowest routes. One endpoint: a route's calls, percentiles, errors and time histogram. Read from the local stack edge's JSON request log                                                                                                                                                                        |
| Run › Secrets                  | The open environment's own Infisical project only (Local: saha-textile-dev · dev; Staging: saha-textile-staging · staging; Production: saha-textile-production · prod), each name per folder as set, empty, missing or not read; never a value. Missing + stale lists only the names that need a value                                                                                                                              |

The Mac helper never starts the checks stage while a `pnpm dev` server of this checkout is running, because that stage rebuilds the apps under it, and stopping the stack never stops the search server that `pnpm dev` also uses. For an environment on a cloud, these screens say that no server is linked yet.

The console keeps the figures in its database: 5-second points for 2 hours, then minute averages for 7 days.

The console checks the alert rules on every 5-second reading while it runs. An alert fires once its finding has held long enough, ends when the finding clears, and stays listed for 7 days. A project with an environment on this computer lists the firing alerts in its Attention. Email and phone delivery come with the server agent, which keeps checking while the Mac is off.

APM reads the stack edge's request log once a minute through the Mac helper and keeps minute summaries per service and route for 7 days: requests, client and server errors, and a latency histogram from which p50, p95, p99 and Apdex (0.5 s target) are worked out. Routes drop query strings, IDs and anything containing `@`; the request lines themselves are never kept. The times are each request's total at the edge; where the time went inside a request comes with tracing.

The Secrets screen reads Infisical with the owner's own login, one tier at a time: the environment tab at the top decides which Infisical project and environment is read, and only while that tab is open (owner, 20 Nov). The Mac helper runs `scripts/release-console/secret-names.mjs` in its own process, because the Infisical command line blocks; it lists names through `scripts/secrets/listing.mjs`, which drops every value inside, and compares them with the names `docker/infisical/variable-names.json` expects. The answer is kept for a minute. Infisical's command line gives no change dates, so none are shown.

Wherever something fails, the screen shows the steps to fix it: the Mac helper silent, Docker down, the stack not answering, a database login refused, certificates missing, a port taken, a run already going, the checks stage refused under dev servers, a failed run (matched from its last lines), Infisical signed out, a full disk, a key to replace, and errors rising. The steps live in `apps/release-console/src/app/screens/trouble.ts`; a test checks that every `pnpm` command they name exists.

Each vendor read answers in one of three ways: data, **not connected** (with a button to Connections), or an error with the vendor's reason. DigitalOcean screens read with the read key when the slot has one, and with the change key otherwise. Every other screen and tab describes what it will show; items the console cannot do are red and disabled, and items it can do in part are yellow.

## Console API

Inside its image the API also serves the app, on one address. On the Mac it is published on `127.0.0.1` only, and it accepts browser requests only from the console page (`CONSOLE_ORIGIN`). Request bodies and every answer the app reads are parsed with the shared zod schemas.

| Route                                                                                                | Answer                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                                                                    | `{ status: 'ok', version }`                                                                                                                                    |
| `GET /api/lock/status`, `POST /api/lock/setup`, `…/unlock`, `…/lock`, `…/pin`                        | Lock state, first PIN, unlock with the PIN or password, lock now, change PIN                                                                                   |
| `POST /api/lock/password`, `…/password/remove`, `…/preferred`                                        | Set or change the password, remove it, choose which the lock screen opens with; each needs the PIN                                                             |
| `GET /api/projects`, `POST /api/projects`, `DELETE /api/projects/:id`                                | Projects and workspaces; add; remove with its key links                                                                                                        |
| `POST /api/projects/:id/keys`, `POST …/keys/:keyId/check`, `DELETE …/keys/:keyId`                    | Link a key by its Infisical names and check it; check again; unlink                                                                                            |
| `GET /api/key-source`                                                                                | The key file's names present, missing and optional; never a value                                                                                              |
| `PUT /api/projects/:id/slots`                                                                        | Which keys a repository's slot uses                                                                                                                            |
| `POST /api/projects/:id/repositories`, `PUT …/repositories/:repoId`, `DELETE …/repositories/:repoId` | Add, change or remove a repository                                                                                                                             |
| `POST /api/repository-file`                                                                          | A GitHub repository's own menus from its `.release-console.json`, before it joins a project                                                                    |
| `GET /api/attention`, `GET /api/projects/:id/attention`                                              | Counts per project; one project's items                                                                                                                        |
| `GET /api/audit?project=`                                                                            | Who did what, newest first                                                                                                                                     |
| `GET /api/projects/:p/repos/:r/github/pulls` and `…/github/runs`                                     | Pull requests and workflow runs                                                                                                                                |
| `GET …/cloud/:slot/droplets` and `…/cloud/:slot/account`                                             | Droplets and the cloud account                                                                                                                                 |
| `GET …/edge/:slot/zones` and `…/edge/:slot/zones/:zone/dns`                                          | Sites and DNS records                                                                                                                                          |
| `GET /api/local/services?repo=`, `GET /api/local/readiness?repo=`                                    | The repository's containers on this computer; the shop API's readiness for the shop's own stack, `unknown` for others                                          |
| `GET /api/local/helper`, `…/mac`, `…/docker`, `…/shop-health`                                        | Whether the Mac helper answers (and which dev servers run); the Mac's and Docker's figures; the shop API's readiness                                           |
| `GET /api/local/logs?container=&tail=&since=`, `GET /api/local/history?source=&names=&minutes=`      | A Saha Textile container's log; a figure's history                                                                                                             |
| `GET /api/local/jobs`, `GET …/jobs/:id?after=`, `POST …/run/:action`, `POST …/jobs/:id/stop`         | Jobs run by the Mac helper; start one (`pipeline` with `from` or `only`, or a stack action) or stop one, with the PIN                                          |
| `GET /api/local/alerts`                                                                              | The local alert rules with their state, what fires now and what ended in the last 7 days                                                                       |
| `GET /api/local/requests?minutes=`                                                                   | Per service and route from the edge's request log: requests a minute, p50/p95/p99, error rates, Apdex, and a per-minute series                                 |
| `GET /api/local/secrets?tier=&fresh=`                                                                | Names in one tier's Infisical project and environment (`dev`, `staging` or `production`), per folder, set, empty or missing, never values; `fresh` reads again |

| Setting                     | Default                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `CONSOLE_API_PORT`          | `4410`                                                                             |
| `CONSOLE_ORIGIN`            | `http://localhost:4400`                                                            |
| `CONSOLE_HOST`              | `127.0.0.1` (`0.0.0.0` inside the image)                                           |
| `CONSOLE_DATA_DIR`          | `~/Library/Application Support/Release Console` (`/data` in the image)             |
| `CONSOLE_APP_DIR`           | unset; `/app/public` in the image                                                  |
| `CONSOLE_KEYS_FILE`         | `docker/release-console/env/console.env` (`/run/secrets/console.env` in the image) |
| `CONSOLE_RUNNER_URL`        | `http://127.0.0.1:4419` (`http://host.docker.internal:4419` in the image)          |
| `CONSOLE_RUNNER_TOKEN_FILE` | `docker/release-console/env/runner-token`                                          |
| `CONSOLE_COLLECT`           | on; `off` stops the 5-second figures                                               |
| `CONSOLE_STACK_PREFIX`      | `saha-textile`                                                                     |
| `CONSOLE_LOCAL_READY_URL`   | `http://localhost:4000/health/ready`                                               |

Tests point `CONSOLE_DATA_DIR` and `CONSOLE_KEYS_FILE` at temporary files, so they never touch the owner's data and never use a real token.

## Checks

The shop's CI skips the console. A separate `console` job runs `pnpm check:console` (lint, types, tests and build) only when a pull request changes the console packages or shared setup files such as the lock file, root `package.json`, `turbo.json` or the CI file.

The console's browser tests run with `pnpm e2e:console` from the repository root. They start the console's API and app on ports 4412 and 4402 with an empty data folder, stats collection off and no Mac helper, and check the lock (a PIN typed into the boxes, a wrong PIN refused, Lock), the Add-a-project wizard, key states on Connections, Live deploy without the helper, and the alert rules, on a desktop and a phone screen.
