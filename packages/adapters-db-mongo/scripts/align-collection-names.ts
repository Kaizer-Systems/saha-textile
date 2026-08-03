/**
 * Aligns physical MongoDB collection names with the ratified Schema Nebula graph.
 *
 * Run it explicitly — never at application boot. Renaming collections is a reviewed
 * migration, and `AGENTS.md` plus the index-lifecycle rule forbid uncontrolled schema
 * mutation on startup.
 *
 * Usage (from the repo root; reads the same MONGODB_* env as the API):
 *   pnpm mongo:align-collections -- --dry-run
 *   pnpm mongo:align-collections
 *
 * Exit codes: 0 = aligned (or nothing to do), 1 = failure, 2 = at least one conflict a
 * human must resolve. A conflict means both the legacy and the ratified collection hold
 * data; the migration refuses to merge them rather than picking a winner.
 */
import { alignCollectionNames } from '../src/migrations/align-collection-names';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	await connectMongo();
	try {
		const report = await alignCollectionNames(getMongoose().connection, { dryRun });

		for (const entry of report.entries) {
			if (entry.outcome === 'absent') continue;
			const documents = entry.documents === undefined ? '' : ` (${entry.documents} docs)`;
			console.log(
				`[align-collections] ${entry.outcome.padEnd(15)} ${entry.legacyName} -> ${entry.targetName}${documents}`,
			);
		}

		const prefix = dryRun ? '[align-collections] DRY RUN —' : '[align-collections]';
		console.log(`${prefix} renamed=${report.renamed} conflicts=${report.conflicts}`);

		if (report.conflicts > 0) {
			console.error(
				'[align-collections] Refusing to merge. Both the legacy and ratified collection exist for the pairs marked "conflict"; inspect and consolidate them by hand.',
			);
			process.exitCode = 2;
		}
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error('[align-collections] failed:', error);
	process.exitCode = 1;
});
