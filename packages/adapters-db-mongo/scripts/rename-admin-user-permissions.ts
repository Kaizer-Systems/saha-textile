/**
 * Remap stored `user.*` permission grants to `admin_user.*`.
 *
 * Usage:
 *   pnpm --filter @saha-textile/adapters-db-mongo rename:admin-user-permissions -- --dry-run
 *   pnpm --filter @saha-textile/adapters-db-mongo rename:admin-user-permissions
 */
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { renameAdminUserPermissions } from '../src/migrations/rename-admin-user-permissions';

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	await connectMongo();
	try {
		const report = await renameAdminUserPermissions(getMongoose().connection, { dryRun });
		const prefix = dryRun ? '[rename-admin-user-permissions] DRY RUN —' : '[rename-admin-user-permissions]';
		console.log(
			`${prefix} rolesUpdated=${report.rolesUpdated} adminUsersUpdated=${report.adminUsersUpdated} invitesUpdated=${report.invitesUpdated} codesRewritten=${report.codesRewritten}`,
		);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error('[rename-admin-user-permissions] failed:', error);
	process.exitCode = 1;
});
