# Cursor-Context → Repo Placement Guide (one-time scaffolding)

> **For the agent:** When you scaffold the `saha-textile` pnpm/Turborepo monorepo, distribute the files in `saha-textile/cursor-context/` to their canonical locations per the table below. Config files move to their real homes; the knowledge/planning docs go to `project-context/`; `AGENTS.md` goes to the **repo root**. This guide is a one-time aid — keep it in `project-context/` or discard it after scaffolding.

## ⚠️ Use the adapted versions

Two files in `cursor-context/` began as client copies and were adapted to this stack (Next.js 16 / React 19 / Tailwind v4 + shadcn / NestJS / pnpm monorepo): **`settings.json`** and **`.prettierrc`**. Use the adapted versions. What changed is at the bottom.

## Placement table

| In `cursor-context/`                             | Move/copy to                     | Action                                                                                                                                             |
| ------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                      | `./AGENTS.md` (repo root)        | move — auto-loaded by Cursor/agents every session                                                                                                  |
| `mcp.json`                                       | `.cursor/mcp.json`               | move (create `.cursor/`)                                                                                                                           |
| `mcp-tools.mdc`                                  | `.cursor/rules/mcp-tools.mdc`    | move (create `.cursor/rules/`)                                                                                                                     |
| `settings.json` _(adapted)_                      | `.vscode/settings.json`          | move (create `.vscode/`) — read by **both** Cursor & VS Code                                                                                       |
| `extensions.json`                                | `.vscode/extensions.json`        | move — recommends extensions when the repo is opened                                                                                               |
| `.prettierrc` _(adapted)_                        | `./.prettierrc` (repo root)      | move                                                                                                                                               |
| `.editorconfig`                                  | `./.editorconfig` (repo root)    | move                                                                                                                                               |
| `.gitignore`                                     | `./.gitignore` (repo root)       | **merge** into the scaffold's generated `.gitignore` — do not blindly overwrite. Ensure `.env.mcp` is ignored and `.env.mcp.example` stays tracked |
| `.env.mcp.example`                               | `./.env.mcp.example` (repo root) | move                                                                                                                                               |
| `saha-textile-technical-knowledgebase.md`        | `project-context/`               | move                                                                                                                                               |
| `execution-roadmap.md`                           | `project-context/`               | move                                                                                                                                               |
| `private-developer-portal-documentation-plan.md` | `project-context/`               | move                                                                                                                                               |
| `mcp-automation-setup.md`                        | `project-context/`               | move                                                                                                                                               |

After moving, rename the now-mostly-empty `cursor-context/` folder to **`project-context/`** (or keep the name). It holds the four knowledge/planning docs. **Commit it** — it's the project's knowledge base. Reference these docs in Cursor with `@project-context/...` whenever you need full context; they're too large to load as always-on rules.

## ⚠️ Filename consistency (must match exactly)

`AGENTS.md` and `execution-roadmap.md` reference the knowledge base as **`saha-textile-technical-knowledgebase.md`** (hyphens). If your file currently uses underscores (`saha_textile_technical_knowledgebase.md`), either **rename it to hyphens** or **update the references** in `AGENTS.md` and `execution-roadmap.md` to match. The names must be identical or the agent's `@`-references and "read this file" steps will fail.

## Before you scaffold — GitHub / branch prerequisites

Your two branch rulesets are active on `main` / `dev` / `qa` / `staging`. Before (or as part of) Phase 0 in `execution-roadmap.md`:

- **Repo → Settings → General → Pull Requests: enable "Allow squash merging."** Required for the linear-history rule to be satisfiable, and squash is the **only working merge method on `main`/`staging`** (merge-commits are blocked by linear history; rebase-merge is blocked because it produces unsigned commits).
- **Set up local commit signing (SSH or GPG)** — `main`/`staging` require signed commits. Squash-merges via the GitHub UI are signed automatically for your own PRs; CI bot commits are signed automatically too.
- **Create `dev`, `qa`, `staging`** (`main` is created on first push); confirm in `Settings → Rules` that both rulesets target this repo (their exported `source` points at a different repo and is ignored on import).
- _(Optional)_ keep a copy of your two ruleset JSONs in the repo at `.github/rulesets/` for documentation and easy re-import.

## Post-move steps (for the human)

1. `cp .env.mcp.example .env.mcp`, fill in real credentials, and **uncomment exactly one phase block** (`LOCAL` to start). `.env.mcp` stays gitignored. See `project-context/mcp-automation-setup.md`.
2. Install Prettier + the Tailwind plugin at the workspace root, **then add the plugin line back** to `.prettierrc`:
    ```bash
    pnpm add -D -w prettier prettier-plugin-tailwindcss
    ```
    then add to `.prettierrc` as a top-level key (just above `"overrides"`):
    ```json
    "plugins": ["prettier-plugin-tailwindcss"],
    ```
    **Install first, reference second** — referencing an uninstalled plugin throws `Cannot find package 'prettier-plugin-tailwindcss' imported from /noop.js`.
3. Command Palette → **"Extensions: Show Recommended Extensions"** → install them (you may have already done this).
4. **Restart Cursor** so it picks up `.cursor/mcp.json`, `.cursor/rules/`, `.vscode/settings.json`, and `AGENTS.md`.

## What was adapted (and why)

### `settings.json`

- **Removed** the three `sonarlint.connectionMode.*` bindings — they pointed at your client's private **"NIQ Sonarqube"** server, irrelevant here. SonarLint runs **standalone** (free, local) once installed; a commented template is left in the file for if you ever add SonarQube/SonarCloud for this repo.
- **Removed `prettier.configPath`** so Prettier resolves the **nearest** config (lets per-app overrides work if you ever add them; with a single root config it always resolves to that one). Kept `prettier.requireConfig: true`.
- **Added:** ESLint flat-config + fix-on-save; Tailwind IntelliSense with `cn()`/`cva()` class detection (shadcn) and string suggestions; `[typescriptreact]`/`[javascriptreact]` formatters; monorepo `search.exclude` / `files.watcherExclude` for performance.
- **Changed `formatOnType` → `false`** (Prettier doesn't drive on-type formatting; avoids cursor jumps). Kept your tabs/4 + LF and the YAML / GitHub-Actions 2-space overrides.

### `.prettierrc`

- **The Tailwind plugin line was REMOVED from the shipped file** so Prettier works immediately in the staging folder (which has no `node_modules`). **Add it back as Post-move step 2, after installing the package.** If you add more Prettier plugins later, `prettier-plugin-tailwindcss` must stay **last**.
- **Added a `package.json` override** (spaces / 2) since pnpm normalizes that file on install — keeping tabs there would fight the package manager.
- **Kept all your style choices** (printWidth 120, tabs/4, single quotes, `trailingComma: all`, `singleAttributePerLine`, etc.). Notes: `singleAttributePerLine: true` makes multi-prop JSX components tall — flip to `false` if you prefer compact. For **Tailwind v4** in a monorepo, if class sorting doesn't reflect your theme, set `tailwindStylesheet` in a per-app `.prettierrc` pointing to that app's CSS entry (e.g. `apps/storefront/src/app/globals.css`).
