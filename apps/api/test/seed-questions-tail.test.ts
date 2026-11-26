import { afterEach, describe, expect, it, vi } from 'vitest';

/** The script runs on import; nothing is read from `.env` and its guards stop it before any database. */
vi.mock('dotenv/config', () => ({}));
vi.mock('@saha-textile/adapters-db-mongo', () => ({
	connectMongo: vi.fn(),
	disconnectMongo: vi.fn(),
	MongoAdminUserRepository: class {},
	MongoProductQuestionRepository: class {},
	MongoProductRepository: class {},
}));
vi.mock('../src/catalog/content.service', () => ({ ContentService: class {} }));

const argv = process.argv;
afterEach(() => {
	process.argv = argv;
	vi.unstubAllEnvs();
});

describe('the product questions seed: the last guard', () => {
	it('refuses when no database name is set at all', async () => {
		vi.resetModules();
		process.argv = ['node', 'seed-local-product-questions.js', '--i-am-local'];
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('MONGODB_HOST', '');
		vi.stubEnv('MONGODB_DB_NAME', undefined);
		let failure: unknown = null;
		// Vite resolves the .js name to the TypeScript file.
		await import('../src/seed-local-product-questions.js').catch((error: unknown) => {
			failure = error;
		});
		expect(String(failure)).toContain('MONGODB_DB_NAME must end in _local');
	});
});
