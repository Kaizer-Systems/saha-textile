/**
 * Reconciles live MongoDB indexes with the ones the models declare.
 *
 * Run it explicitly — never at application boot. Dropping and rebuilding an index is a reviewed
 * migration, and `AGENTS.md` plus the index-lifecycle rule forbid uncontrolled schema mutation
 * on startup.
 *
 * Usage (from the repo root; reads the same MONGODB_* env as the API):
 *   pnpm mongo:reconcile-indexes -- --dry-run
 *   pnpm mongo:reconcile-indexes
 *
 * Exit codes: 0 = aligned (or nothing to do), 1 = failure.
 */
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import * as models from '../src/models';
import { reconcileIndexes } from '../src/migrations/reconcile-indexes';

/** Every exported model, so a divergence cannot hide in a collection nobody thought to list. */
function allModels() {
	return Object.entries(models)
		.filter(([name, value]) => name.endsWith('Model') && typeof value === 'function')
		.map(([, value]) => value as never);
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	await connectMongo();
	try {
		/**
		 * Named out loud, because the connection comes from MONGODB_* in the environment and an
		 * unset variable falls back to a DEFAULT database rather than failing. A migration that
		 * quietly reconciles the wrong database reports success and changes nothing that matters.
		 */
		console.log(`[reconcile-indexes] database: ${getMongoose().connection.name}`);

		const report = await reconcileIndexes(allModels(), { dryRun });

		for (const entry of report.entries) {
			if (entry.alreadyAligned) continue;
			const parts = [
				entry.dropped.length > 0 ? `rebuilding ${entry.dropped.join(', ')}` : null,
				entry.missing.length > 0 ? `creating missing ${entry.missing.join(', ')}` : null,
			].filter(Boolean);
			console.log(`[reconcile-indexes] ${entry.collection}: ${parts.join('; ')}`);
		}

		const prefix = dryRun ? '[reconcile-indexes] DRY RUN —' : '[reconcile-indexes]';
		console.log(
			`${prefix} collections=${report.entries.length} rebuilt=${report.dropped} created=${report.missing}`,
		);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error('[reconcile-indexes] failed:', error);
	process.exitCode = 1;
});
