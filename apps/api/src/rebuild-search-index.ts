import 'dotenv/config';

import { connectMongo, disconnectMongo } from '@saha-textile/adapters-db-mongo';

import { prepareSearchIndex, releaseSearch } from './search/search-release';

/**
 * Fills the Meilisearch index from Mongo, the source of truth. Safe to repeat.
 *
 * - `pnpm --filter @saha-textile/api search:rebuild` always rebuilds this version's index, for a
 *   fresh index or after a bulk catalogue change.
 * - `--release` builds only when this search version's index is not built yet, and otherwise
 *   applies settings and search words. The release-steps runner does the same as one of its steps.
 */
async function main(): Promise<void> {
	await connectMongo();
	try {
		const done = await prepareSearchIndex(releaseSearch(), { release: process.argv.includes('--release') });
		process.stdout.write(`${done}\n`);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
