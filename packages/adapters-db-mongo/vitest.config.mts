import { defineConfig } from 'vitest/config';

/**
 * The adapter's integration tests share a database. Seed and migration suites use the same
 * fixed keys, so one suite's cleanup can remove another suite's data when files run in parallel.
 */
export default defineConfig({
	test: {
		// An opt-in database run may only open a test database; see the file.
		setupFiles: ['./test/test-database-guard.ts'],
		fileParallelism: process.env.RUN_DB_IT !== '1',
		maxWorkers: 4,
		hookTimeout: 30_000,
		testTimeout: 15_000,
	},
});
