import { afterEach, describe, expect, it, vi } from 'vitest';

/** The scripts run on import; every database call is a stand-in and nothing is read from `.env`. */
const h = vi.hoisted(() => ({
	disconnect: vi.fn(async () => undefined),
	variants: [] as Array<Record<string, unknown>>,
	products: [] as Array<Record<string, unknown>>,
	documented: [] as string[],
	updates: [] as unknown[],
	check: vi.fn(
		async (
			_rows: Array<{ row: number; sku: string }>,
		): Promise<{ rows: Array<{ row: number; sku: string; result: string }> }> => ({ rows: [] }),
	),
	post: vi.fn(async (rows: unknown[]) => ({ number: 'OS/26-27/000001', rows, totalUnits: 3, totalValueINR: 900 })),
	// product questions
	file: '[]',
	admin: { id: 'adm_1' } as null | { id: string },
	answered: [] as Array<{ question: string }>,
	productBySlug: (slug: string): null | { id: string } => (slug === 'gone' ? null : { id: `p_${slug}` }),
	ask: vi.fn(async () => ({ id: 'q_1' })),
	answer: vi.fn(async () => undefined),
}));
vi.mock('dotenv/config', () => ({}));
const chain = (value: () => unknown) => ({
	lean: () => ({ exec: async () => value() }),
	select: () => ({ lean: () => ({ exec: async () => value() }) }),
});
vi.mock('@saha-textile/adapters-db-mongo', () => {
	const plain = class {};
	return {
		connectMongo: async () => undefined,
		disconnectMongo: h.disconnect,
		ProductVariantModel: {
			find: () => chain(() => h.variants),
			updateMany: (filter: unknown, update: unknown) => ({
				exec: async () => void h.updates.push(['many', filter, update]),
			}),
			updateOne: (filter: unknown, update: unknown) => ({
				exec: async () => void h.updates.push(['one', filter, update]),
			}),
		},
		ProductModel: { find: () => chain(() => h.products) },
		InventoryLedgerModel: { distinct: () => ({ exec: async () => h.documented }) },
		InventoryCostLayerModel: { distinct: () => ({ exec: async () => [] }) },
		MongoAdminUserRepository: class {
			findByEmail = async () => h.admin;
		},
		MongoAdminUserRoleAssignmentRepository: plain,
		MongoAuditLogRepository: plain,
		MongoInventoryCostLayerRepository: plain,
		MongoInventorySettingsRepository: plain,
		MongoMediaAssetRepository: plain,
		MongoNumberAllocator: plain,
		MongoOpeningStockRepository: plain,
		MongoRoleRepository: plain,
		MongoSearchOutboxRepository: plain,
		MongoStockHoldRepository: plain,
		MongoStockMovement: plain,
		MongoStockReadRepository: plain,
		MongoTransactionManager: plain,
		MongoProductQuestionRepository: class {
			listAnsweredForProduct = async () => ({ items: h.answered });
		},
		MongoProductRepository: class {
			findBySlug = async (slug: string) => h.productBySlug(slug);
		},
	};
});
vi.mock('../src/purchasing/opening-stock.service', () => ({
	OpeningStockService: class {
		check = h.check;
		post = h.post;
	},
}));
vi.mock('../src/purchasing/purchasing-support', () => ({ PurchasingSupport: class {} }));
vi.mock('../src/purchasing/stock-writer', () => ({ StockWriter: class {} }));
vi.mock('node:fs/promises', async (original) => ({
	...(await original<typeof import('node:fs/promises')>()),
	readFile: async () => h.file,
}));
vi.mock('../src/catalog/content.service', () => ({
	ContentService: class {
		ask = h.ask;
		answer = h.answer;
	},
}));

const argv = process.argv;
afterEach(() => {
	process.argv = argv;
	process.exitCode = undefined;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	h.disconnect.mockClear();
	h.updates.length = 0;
	h.check.mockClear();
	h.post.mockClear();
	h.ask.mockClear();
	h.answer.mockClear();
});

const local = (env: Record<string, string> = {}) => {
	vi.stubEnv('NODE_ENV', 'test');
	vi.stubEnv('MONGODB_HOST', '');
	vi.stubEnv('MONGODB_DB_NAME', 'saha_textile_local');
	for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
};

/** Imports a script with these arguments; answers the error its guards threw, if any. */
async function run(script: 'opening' | 'questions', args: string[]) {
	vi.resetModules();
	process.argv = ['node', 'script.js', ...args];
	const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	let failure: unknown = null;
	// The scripts run on import; Vite resolves the .js names to the TypeScript files.
	const load =
		script === 'opening'
			? import('../src/seed-local-opening-stock.js')
			: import('../src/seed-local-product-questions.js');
	await load.catch((thrown: unknown) => {
		failure = thrown;
	});
	return { log, error, failure };
}

describe('local seed guards', () => {
	it('refuse without the local flag, in production, on a remote host or a database not ending in _local', async () => {
		for (const script of ['opening', 'questions'] as const) {
			local();
			expect(String((await run(script, [])).failure)).toContain('--i-am-local');
			local({ NODE_ENV: 'production' });
			expect(String((await run(script, ['--i-am-local'])).failure)).toContain('NODE_ENV=production');
			local({ MONGODB_HOST: 'db.example.test' });
			expect(String((await run(script, ['--i-am-local'])).failure)).toContain('not a loopback host');
			local({ MONGODB_DB_NAME: 'saha_textile_prod' });
			expect(String((await run(script, ['--i-am-local'])).failure)).toContain('_local');
		}
	});

	it('refuse when no database name is set at all', async () => {
		local();
		delete process.env['MONGODB_DB_NAME'];
		expect(String((await run('opening', ['--i-am-local'])).failure)).toContain('_local');
	});

	it('need a cost share between 1 and 100, and a questions file with who answers', async () => {
		local();
		expect(String((await run('opening', ['--i-am-local', '--cost-pct', '0'])).failure)).toContain('--cost-pct');
		expect(String((await run('questions', ['--i-am-local', '--file', 'q.json'])).failure)).toContain(
			'--answered-by',
		);
	});
});

describe('the opening stock seed', () => {
	it('moves nothing when every stocked variant has history, and says when bundle rows were left alone', async () => {
		local();
		h.variants = [{ _id: 'v_done', productId: 'p1', sku: 'S1', priceINR: 100, stock: { quantity: 2 } }];
		h.documented = ['v_done'];
		h.products = [];
		const quiet = await run('opening', ['--i-am-local']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(quiet.log).toHaveBeenCalledWith('Nothing to move: every variant with stock already has stock history.');
		h.disconnect.mockClear();
		h.variants = [{ _id: 'v_set', productId: 'p_set', sku: 'SET', priceINR: 100, stock: { quantity: 1 } }];
		h.documented = [];
		h.products = [{ _id: 'p_set', type: 'bundle' }];
		const sets = await run('opening', ['--i-am-local']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(sets.log).toHaveBeenCalledWith(expect.stringContaining('1 bundle rows left alone'));
	});

	it('posts typed stock as opening stock at the cost share, metres for fabric, giving refused rows their number back', async () => {
		local();
		const future = new Date(Date.now() + 86_400_000 * 30);
		h.variants = [
			{
				_id: 'v_piece',
				productId: 'p_piece',
				sku: 'PIECE',
				priceINR: 1000,
				salePriceINR: null,
				stock: { quantity: 3 },
			},
			{
				_id: 'v_cloth',
				productId: 'p_cloth',
				sku: 'CLOTH',
				priceINR: 500,
				salePriceINR: 400,
				stock: { quantity: 25, held: 5 },
			},
			{ _id: 'v_bare', productId: 'p_bare', sku: 'BARE', priceINR: 200 },
			{ _id: 'v_set', productId: 'p_set', sku: 'SET', priceINR: 100, stock: { quantity: 1 } },
		];
		h.documented = [];
		h.products = [
			{ _id: 'p_piece', soldBy: 'piece', createdAt: new Date('2026-10-01T00:00:00.000Z') },
			{ _id: 'p_cloth', soldBy: 'metre', createdAt: future },
			{ _id: 'p_set', type: 'bundle' },
		];
		h.check.mockImplementationOnce(async (rows) => ({
			rows: rows.map((row) => ({
				row: row.row,
				sku: row.sku,
				result: row.sku === 'CLOTH' ? 'unknown_sku' : 'ready',
			})),
		}));
		const { log } = await run('opening', ['--i-am-local', '--cost-pct', '50']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		const sent = h.check.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
		expect(sent.map((row) => [row['sku'], row['quantity'], row['unitCostINR']])).toEqual([
			['PIECE', 3, 500],
			['CLOTH', 2.5, 200],
			['BARE', 0, 100],
		]);
		expect(sent.find((row) => row['sku'] === 'PIECE')?.['receivedOn']).toBe('2026-10-01');
		expect(h.updates).toContainEqual([
			'one',
			{ _id: 'v_cloth' },
			{ $set: { 'stock.quantity': 25, 'stock.held': 5 } },
		]);
		expect(log).toHaveBeenCalledWith(expect.stringContaining('Skipped 1 rows: CLOTH (unknown_sku)'));
		expect(log).toHaveBeenCalledWith(expect.stringContaining('Posted OS/26-27/000001'));
	});

	it('gives a refused row with no stock of its own nothing back, and skips no rows when every one is ready', async () => {
		local();
		h.variants = [{ _id: 'v_bare', productId: 'p_bare', sku: 'BARE', priceINR: 200 }];
		h.products = [{ _id: 'p_bare', soldBy: 'piece' }];
		h.documented = [];
		h.check.mockImplementationOnce(async (rows) => ({
			rows: rows.map((row) => ({ row: row.row, sku: row.sku, result: 'unknown_sku' })),
		}));
		await run('opening', ['--i-am-local']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.updates).toContainEqual([
			'one',
			{ _id: 'v_bare' },
			{ $set: { 'stock.quantity': 0, 'stock.held': 0 } },
		]);
		h.disconnect.mockClear();
		// The console spy outlives one run: start the second with no lines.
		vi.mocked(console.log).mockClear();
		h.variants = [{ _id: 'v_piece', productId: 'p_piece', sku: 'PIECE', priceINR: 1000, stock: { quantity: 3 } }];
		h.products = [{ _id: 'p_piece', soldBy: 'piece' }];
		h.check.mockImplementationOnce(async (rows) => ({
			rows: rows.map((row) => ({ row: row.row, sku: row.sku, result: 'ready' })),
		}));
		const ready = await run('opening', ['--i-am-local']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(ready.log).not.toHaveBeenCalledWith(expect.stringContaining('Skipped'));
	});

	it('posts nothing for a batch the check refuses whole, and reports a failure', async () => {
		local();
		h.variants = [{ _id: 'v_piece', productId: 'p_piece', sku: 'PIECE', priceINR: 1000, stock: { quantity: 3 } }];
		h.products = [{ _id: 'p_piece', soldBy: 'piece' }];
		h.documented = [];
		h.check.mockImplementationOnce(async (rows) => ({
			rows: rows.map((row) => ({ row: row.row, sku: 'OTHER', result: 'refused' })),
		}));
		await run('opening', ['--i-am-local']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.post).not.toHaveBeenCalled();
		h.disconnect.mockClear();
		h.check.mockRejectedValueOnce(new Error('database down'));
		const broken = await run('opening', ['--i-am-local']);
		await vi.waitFor(() => expect(broken.error).toHaveBeenCalled());
		expect(process.exitCode).toBe(1);
	});
});

describe('the product questions seed', () => {
	const row = (productSlug: string, question: string) => ({
		productSlug,
		question,
		askerName: 'Asha Roy',
		askerEmail: 'asha@example.test',
		answer: 'Yes, it is handwoven.',
	});

	it('asks and answers each new question once, skipping ones already answered', async () => {
		local();
		h.file = JSON.stringify([row('red-saree', 'Is it handwoven?'), row('red-saree', 'Does it fade?')]);
		h.answered = [{ question: 'Does it fade?' }];
		const { log } = await run('questions', [
			'--i-am-local',
			'--file',
			'q.json',
			'--answered-by',
			'owner@example.test',
		]);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.answer).toHaveBeenCalledWith('q_1', 'Yes, it is handwoven.', 'adm_1');
		expect(log).toHaveBeenCalledWith('Questions answered: 1. Already there: 1.');
	});

	it('stops at an unknown admin or product, and reports whatever was thrown', async () => {
		local();
		const args = ['--i-am-local', '--file', 'q.json', '--answered-by', 'owner@example.test'];
		h.file = JSON.stringify([row('gone', 'Is it handwoven?')]);
		h.admin = null;
		const noAdmin = await run('questions', args);
		await vi.waitFor(() =>
			expect(noAdmin.error).toHaveBeenCalledWith('No admin user with the email owner@example.test.'),
		);
		h.admin = { id: 'adm_1' };
		const noProduct = await run('questions', args);
		await vi.waitFor(() => expect(noProduct.error).toHaveBeenCalledWith('No live product with the slug gone.'));
		h.file = JSON.stringify([row('red-saree', 'Is it handwoven?')]);
		h.answered = [];
		h.ask.mockRejectedValueOnce('not an error');
		const odd = await run('questions', args);
		await vi.waitFor(() => expect(odd.error).toHaveBeenCalledWith('not an error'));
		expect(process.exitCode).toBe(1);
	});
});
