import { defineConfig } from 'vitest/config';

/**
 * The adapter's integration tests share one MongoDB replica set. Unbounded, Vitest runs a file per
 * CPU core (15 on a 16-core Mac) and their setup hooks queue behind the server's three-at-a-time
 * index builds until they time out. Four files at a time keeps the suite as fast in practice and
 * stable under load; the longer hook limit absorbs a slow machine without hiding a real hang.
 */
export default defineConfig({
	test: {
		// An opt-in database run may only open a test database; see the file.
		setupFiles: ['./test/test-database-guard.ts'],
		maxWorkers: 4,
		hookTimeout: 30_000,
		testTimeout: 15_000,
	},
});
