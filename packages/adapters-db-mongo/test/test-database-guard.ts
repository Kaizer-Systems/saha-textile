import { buildMongoConfig, TEST_DATABASE_NAME } from '../src/config';

/**
 * Loaded before every test file (vitest.config.mts). An opt-in database run (`RUN_DB_IT=1`) deletes
 * and rewrites rows, so it may only open a test database (a name ending in _it, _e2e or _test).
 * Without MONGODB_DB_NAME the adapter would otherwise open the working database, saha_textile_local,
 * which happened once on 2026-11-20 before this guard.
 */
if (process.env.RUN_DB_IT === '1') {
	const { dbName } = buildMongoConfig(process.env);
	if (!TEST_DATABASE_NAME.test(dbName)) {
		throw new Error(
			`RUN_DB_IT=1 refused: ${dbName} is not a test database. Set MONGODB_DB_NAME to one ending in _it, _e2e or _test, for example: node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo test`,
		);
	}
}
