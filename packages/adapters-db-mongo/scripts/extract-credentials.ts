/**
 * Extract embedded password/PIN/identity fields into credential collections.
 *
 * Usage:
 *   pnpm mongo:extract-credentials -- --dry-run
 *   pnpm mongo:extract-credentials
 */
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import { extractCredentials } from '../src/migrations/extract-credentials';

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	await connectMongo();
	try {
		const report = await extractCredentials(getMongoose().connection, { dryRun });
		const prefix = dryRun ? '[extract-credentials] DRY RUN —' : '[extract-credentials]';
		console.log(
			`${prefix} password=${report.passwordCredentialsUpserted} pin=${report.pinCredentialsUpserted} identities=${report.authIdentitiesUpserted} customersUnset=${report.customersUnset} adminUsersUnset=${report.adminUsersUnset}`,
		);
	} finally {
		await disconnectMongo();
	}
}

main().catch((error: unknown) => {
	console.error('[extract-credentials] failed:', error);
	process.exitCode = 1;
});
