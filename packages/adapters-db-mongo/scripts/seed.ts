/**
 * Seed runner. Reads MONGODB_* env (assemble @-safe URI at runtime), connects,
 * upserts the seed data, then disconnects.
 *
 * Usage (from repo root, with apps/api/.env loaded or vars exported):
 *   pnpm --filter @saha/adapters-db-mongo seed
 */
import { connectMongo, disconnectMongo } from '../src/connection';
import { seedDatabase } from '../src/seed/index';

async function main(): Promise<void> {
	await connectMongo();
	const result = await seedDatabase();
	console.log('[seed] done:', result);
	await disconnectMongo();
}

main().catch((err: unknown) => {
	console.error('[seed] failed:', err);
	process.exitCode = 1;
});
