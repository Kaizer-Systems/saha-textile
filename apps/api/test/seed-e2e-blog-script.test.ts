import { afterEach, describe, expect, it, vi } from 'vitest';

/** The script runs on import; the database, bucket, picture tool and blog service are stand-ins. */
const h = vi.hoisted(() => ({
	disconnect: vi.fn(async () => undefined),
	spaces: { key: 'k', secret: 's', bucket: 'b' } as Record<string, string | undefined>,
	category: null as null | { id: string },
	posts: {} as Record<string, { id: string; status: string }>,
	storedAssets: new Set<string>(),
	created: [] as Array<{ id: string; derivatives: Array<{ width: number; byteSize: number }> }>,
	uploads: [] as string[],
	stored: new Set<string>(),
	meta: { width: 1600, height: 900 } as { width?: number; height?: number },
	live: true,
	saveTerm: vi.fn(async () => ({ id: 'bcat_new' })),
	create: vi.fn(async () => ({ post: { id: 'post_new' } })),
	goLive: vi.fn(async (): Promise<{ live: boolean; gaps: unknown[] }> => ({ live: true, gaps: [] })),
}));
vi.mock('dotenv/config', () => ({}));
vi.mock('@saha-textile/adapters-db-mongo', () => ({
	connectMongo: async () => undefined,
	disconnectMongo: h.disconnect,
	MongoBlogCategoryRepository: class {
		findBySlug = async () => h.category;
	},
	MongoBlogPostRepository: class {
		findBySlug = async (slug: string) => h.posts[slug] ?? null;
	},
	MongoBlogTagRepository: class {},
	MongoSeoRedirectRepository: class {},
	MongoMediaAssetRepository: class {
		findById = async (id: string) => (h.storedAssets.has(id) ? { id } : null);
		create = async (asset: (typeof h.created)[number]) => void h.created.push(asset);
	},
}));
vi.mock('@saha-textile/adapters-storage-spaces', () => ({
	SpacesStorageAdapter: class {
		getUrl = (key: string) => `https://cdn.test/${key}`;
		upload = async (input: { key: string }) => void h.uploads.push(input.key);
	},
}));
vi.mock('sharp', () => {
	const image = () => ({
		metadata: async () => h.meta,
		resize: () => ({
			toBuffer: async () => Buffer.from('cut'),
			webp: () => ({ toBuffer: async () => Buffer.from('webp-bytes') }),
		}),
	});
	return { default: image };
});
vi.mock('node:fs/promises', async (original) => ({
	...(await original<typeof import('node:fs/promises')>()),
	readFile: async () => Buffer.from('jpeg'),
}));
vi.mock('../src/config/app-config', () => ({ loadConfig: () => ({ spaces: h.spaces, locales: ['en', 'bn'] }) }));
vi.mock('../src/blog/blog-admin.service', () => ({
	BlogAdminService: class {
		saveTerm = h.saveTerm;
		create = h.create;
		goLive = h.goLive;
	},
}));

afterEach(() => {
	process.exitCode = undefined;
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	h.disconnect.mockClear();
	h.saveTerm.mockClear();
	h.create.mockClear();
	h.goLive.mockClear();
	h.created.length = 0;
	h.uploads.length = 0;
});

async function run(env: Record<string, string> = {}) {
	vi.resetModules();
	vi.stubEnv('MONGODB_DB_NAME', 'saha_textile_e2e');
	vi.stubEnv('MONGODB_HOST', '');
	for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
	// Pictures at these addresses are already in the bucket.
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => ({ ok: [...h.stored].some((key) => url.endsWith(key)) })),
	);
	const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	let failure: unknown = null;
	// The script runs on import; Vite resolves the .js name to the TypeScript file.
	await import('../src/seed-e2e-blog.js').catch((thrown: unknown) => {
		failure = thrown;
	});
	return { log, error, failure };
}

describe('the e2e blog seed', () => {
	it('refuses any database but the e2e one, a remote host, and a run without Spaces credentials', async () => {
		expect(String((await run({ MONGODB_DB_NAME: 'saha_textile_local' })).failure)).toContain(
			'seeds saha_textile_e2e only',
		);
		expect(String((await run({ MONGODB_HOST: 'db.example.test' })).failure)).toContain('not a loopback host');
		h.spaces = { key: 'k', secret: undefined, bucket: 'b' };
		expect(String((await run()).failure)).toContain('Spaces credentials are required');
		h.spaces = { key: 'k', secret: 's', bucket: 'b' };
	});

	it('makes the category once, leaves a live post, reuses a draft, makes covers only where missing and uploads only new sizes', async () => {
		h.category = null;
		h.posts = {
			'how-to-choose-a-banarasi-saree': { id: 'post_1', status: 'live' },
			'caring-for-silk-sarees': { id: 'post_2', status: 'draft' },
		};
		h.storedAssets = new Set(['med_0e2eb100-0000-4000-8000-000000000002']);
		h.stored = new Set(['blog-480w-e2e00001.webp']);
		const { log } = await run();
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.saveTerm).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith('how-to-choose-a-banarasi-saree: already live');
		expect(h.create).toHaveBeenCalledTimes(1);
		expect(h.goLive.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['post_2', 'post_new']);
		expect(h.created).toHaveLength(1);
		expect(h.created[0]?.derivatives.map((row) => [row.width, row.byteSize > 0])).toEqual([
			[480, false],
			[800, true],
			[1200, true],
			[1600, true],
		]);
	});

	it('uses the category already there, and stops at a picture it cannot read or a Go Live refused', async () => {
		h.category = { id: 'bcat_1' };
		h.posts = {};
		h.storedAssets = new Set();
		h.meta = {};
		const unreadable = await run();
		await vi.waitFor(() => expect(unreadable.error).toHaveBeenCalled());
		expect(h.saveTerm).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		h.meta = { width: 1600, height: 900 };
		h.goLive.mockResolvedValueOnce({ live: false, gaps: [{ field: 'title', locale: 'bn' }] });
		const refused = await run();
		await vi.waitFor(() => expect(refused.error).toHaveBeenCalled());
	});
});
