/**
 * Import the storefront demo catalogue into the local database.
 *
 *   pnpm --filter @saha-textile/adapters-db-mongo seed:demo-catalogue
 *
 * Refuses a database name that does not contain "local". Safe to run twice.
 */
import { connectMongo, disconnectMongo } from '../src/connection';
import { assertLocalDatabase, seedDemoCatalogue } from '../src/seed/seed-demo-catalogue';

async function main(): Promise<void> {
	const dbName = assertLocalDatabase(process.env['MONGODB_DB_NAME']);
	await connectMongo();
	const result = await seedDemoCatalogue(dbName);
	console.log('[seed:demo-catalogue] done:', result);
	await disconnectMongo();
}

main().catch((error: unknown) => {
	console.error('[seed:demo-catalogue] failed:', error);
	process.exitCode = 1;
});
