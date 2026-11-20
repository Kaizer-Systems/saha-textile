/**
 * The commands a change goes through on GitHub, in the order `pnpm pipeline:local` runs them on this
 * Mac (plan step 6). `.github/workflows/ci.yml` and `publish-images.yml` run each of these as a
 * `run:` line, and `stages.test.mjs` (part of `pnpm test:scripts`, so CI too) fails when the two
 * drift apart: a listed command CI no longer runs, or a `pnpm`/`bash` command CI runs that is not
 * listed here or in CI_ONLY.
 */

/** Stage 1, the checks: the CI jobs' commands, in their order. */
export const CHECKS = [
	{ name: 'Lint and repository guards', run: 'pnpm lint:shop' },
	{ name: 'Script tests', run: 'pnpm test:scripts' },
	{ name: 'Types', run: 'pnpm typecheck:shop' },
	{ name: 'Workspace packages', run: 'pnpm turbo run build --filter="./packages/*"' },
	{ name: 'MongoDB', run: 'pnpm mongo:up' },
	{ name: 'Redis', run: 'pnpm redis:up' },
	{ name: 'Tests at 100% coverage', run: 'pnpm coverage' },
	{ name: 'Production builds', run: 'pnpm build:product-apps' },
	{ name: 'Browser tests on production builds', run: 'pnpm e2e:stack' },
	{ name: 'Speed gate', run: 'pnpm e2e:stack -- --speed' },
];

/** Stage 2: the production stack proof on throwaway values (publish-images.yml). */
export const PROOF = { name: 'Production stack proof', run: 'bash scripts/production-proof.sh' };

/**
 * Commands only a fresh GitHub runner needs: this Mac already has its packages, certificates and a
 * real apps/api/.env. The Release Console has its own job and is not part of the shop's pipeline.
 */
export const CI_ONLY = ['pnpm install --frozen-lockfile', 'pnpm setup:local-https', 'pnpm check:console'];

/** The six stages, in order. */
export const STAGES = ['checks', 'proof', 'images', 'release', 'deploy', 'record'];
