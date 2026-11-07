/**
 * Split operator rows out of `customers` into `adminUsers` (`DEC-ACCOUNT-SEPARATION` Pass 5b).
 *
 * Usage (from the repo root; same MONGODB_* env as the API):
 *   pnpm mongo:split-admin-users -- --dry-run
 *   pnpm mongo:split-admin-users
 *
 * Exit codes: 0 = split / already-split / absent, 1 = failure, 2 = conflict.
 */
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { splitAdminUsers } from '../src/migrations/split-admin-users';

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	await connectMongo();
	try {
		const report = await splitAdminUsers(getMongoose().connection, { dryRun });
		const prefix = dryRun ? '[split-admin-users] DRY RUN —' : '[split-admin-users]';
		console.log(
			`${prefix} outcome=${report.outcome} operatorsMoved=${report.operatorsMoved} customersRewritten=${report.customersRewritten} foreignKeysUpdated=${report.foreignKeysUpdated}`,
		);
		console.log(`[split-admin-users] ${report.message}`);
		if (Object.keys(report.idMap).length > 0) {
			console.log(`[split-admin-users] idMap entries=${Object.keys(report.idMap).length}`);
		}
		if (report.outcome === 'conflict') {
			process.exitCode = 2;
		}
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error('[split-admin-users] failed:', error);
	process.exitCode = 1;
});
