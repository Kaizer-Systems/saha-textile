import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

/**
 * The local banner tool, run against mocks. Every adapter is replaced before the script loads,
 * so nothing here can reach a database, a queue or a bucket.
 */
const h = vi.hoisted(
	() =>
		({
			connect: null,
			disconnect: null,
			close: null,
			findByKey: null,
			upsert: null,
			presign: null,
			finalize: null,
			status: null,
			read: null,
			metadata: null,
			resize: null,
			config: {},
		}) as unknown as Record<'connect' | 'disconnect' | 'close' | 'findByKey' | 'upsert', Mock> &
			Record<'presign' | 'finalize' | 'status' | 'read' | 'metadata' | 'resize', Mock> & {
				config: Record<string, unknown>;
			},
);

const held = vi.hoisted(() => ({ audit: null as null | { append: (entry: string) => Promise<string> } }));

vi.mock('dotenv/config', () => ({}));
vi.mock('@saha-textile/adapters-db-mongo', () => {
	const blank = class {};
	return {
		connectMongo: () => h.connect(),
		disconnectMongo: () => h.disconnect(),
		MongoContentBlockRepository: class {
			findByKey = (key: string) => h.findByKey(key);
		},
		MongoMediaAssetRepository: blank,
		MongoMediaRoleRepository: blank,
		MongoSiteSettingsRepository: blank,
		// The storage check the demo uploads pass (composeMongoMediaService).
		MongoMediaFolderRepository: blank,
		MongoStorageLedgerRepository: blank,
		MongoRoleRepository: blank,
		MongoAdminUserRoleAssignmentRepository: blank,
	};
});
vi.mock('@saha-textile/adapters-queue-bullmq', () => ({
	BullMqMediaJobQueue: class {
		close = () => h.close();
	},
}));
vi.mock('@saha-textile/adapters-storage-spaces', () => ({ SpacesStorageAdapter: class {} }));
vi.mock('node:fs/promises', () => ({ readFile: (path: string) => h.read(path) }));
vi.mock('sharp', () => ({
	default: () => ({
		metadata: () => h.metadata(),
		resize: (options: unknown) => {
			h.resize(options);
			return { jpeg: () => ({ toBuffer: async () => Buffer.from('slide') }) };
		},
	}),
}));
vi.mock('../src/config/app-config', () => ({ loadConfig: () => h.config }));
vi.mock('../src/media/media.service', () => ({
	MediaService: class {
		constructor(...parts: unknown[]) {
			held.audit = parts[4] as typeof held.audit;
		}

		presign = (...args: unknown[]) => h.presign(...args);
		finalize = (...args: unknown[]) => h.finalize(...args);
		status = (...args: unknown[]) => h.status(...args);
	},
}));
vi.mock('../src/media/content-blocks.service', () => ({
	ContentBlocksService: class {
		upsert = (block: unknown) => h.upsert(block);
	},
}));

const spaces = { key: 'k', secret: 's', bucket: 'b', region: 'r', endpoint: 'e', cdnUrl: 'c' };
const heldArgv = process.argv;

const run = async (argv: string[] = ['--i-am-local'], env: Record<string, string | undefined> = {}) => {
	vi.resetModules();
	process.argv = ['node', 'seed', ...argv];
	for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value as string);
	await import('../src/seed-local-home-banners.js');
	for (let i = 0; i < 60; i += 1) await new Promise((done) => setImmediate(done));
};

const failure = () => vi.mocked(console.error).mock.calls[0]?.[0] as Error;

beforeEach(() => {
	vi.stubEnv('NODE_ENV', 'development');
	vi.stubEnv('MONGODB_HOST', '127.0.0.1');
	vi.stubEnv('MONGODB_DB_NAME', 'shop_local');
	h.config = { spaces, redis: {}, locales: ['en', 'bn'] };
	h.connect = vi.fn(async () => undefined);
	h.disconnect = vi.fn(async () => undefined);
	h.close = vi.fn(async () => undefined);
	h.findByKey = vi.fn(async () => null);
	h.upsert = vi.fn(async () => undefined);
	h.presign = vi.fn(async () => ({ assetId: 'med_1', uploadUrl: 'https://u', headers: {} }));
	h.finalize = vi.fn(async () => undefined);
	h.status = vi.fn(async () => ({ state: 'ready' }));
	h.read = vi.fn(async () => Buffer.from('art'));
	h.metadata = vi.fn(async () => ({ width: 2789, height: 825 }));
	h.resize = vi.fn();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, status: 200 })),
	);
	vi.spyOn(console, 'log').mockImplementation(() => undefined);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	process.argv = heldArgv;
	process.exitCode = undefined;
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('seed-local-home-banners', () => {
	it.each([
		['the local flag', [], {}, 'Pass --i-am-local'],
		['production', ['--i-am-local'], { NODE_ENV: 'production' }, 'NODE_ENV=production'],
		['a remote database', ['--i-am-local'], { MONGODB_HOST: 'db.example.test' }, 'not a loopback host'],
		['a local database name', ['--i-am-local'], { MONGODB_DB_NAME: 'shop' }, 'must end in _local'],
		['any database name', ['--i-am-local'], { MONGODB_DB_NAME: undefined }, 'must end in _local'],
	])('refuses without %s', async (_name, argv, env, text) => {
		await expect(run(argv, env)).rejects.toThrow(text);
		expect(h.connect).not.toHaveBeenCalled();
	});

	it.each([
		['key', { ...spaces, key: '' }],
		['secret', { ...spaces, secret: '' }],
		['bucket', { ...spaces, bucket: '' }],
	])('needs the Spaces %s', async (_name, value) => {
		h.config = { spaces: value };
		await expect(run()).rejects.toThrow('Spaces credentials are required');
	});

	it('treats an unset host as local', async () => {
		await run(['--i-am-local'], { MONGODB_HOST: '' });
		expect(h.connect).toHaveBeenCalledOnce();
	});

	it('fills every hero and promo slot with a live banner', async () => {
		await run();
		const blocks = h.upsert.mock.calls.map(([block]) => block as Record<string, unknown>);
		expect(blocks.map((block) => `${String(block['position'])}:${String(block['slot'])}`)).toEqual([
			'hero:main',
			'hero:slide_2',
			'hero:slide_3',
			'hero:side',
			'hero:side_top',
			'hero:side_bottom',
			'hero:left',
			'hero:right',
			'promo_wide:item_1',
			'promo_wide:item_2',
		]);
		expect(blocks[0]).toMatchObject({
			ownerType: 'home',
			status: 'active',
			images: { desktop: 'med_1' },
			alt: { en: expect.any(String), bn: expect.any(String) },
			link: { href: '/collections', external: false },
		});
		expect(h.close).toHaveBeenCalledOnce();
		expect(h.disconnect).toHaveBeenCalledOnce();
	});

	it('gives the three slides one shape, so the carousel keeps its height', async () => {
		await run();
		expect(h.resize).toHaveBeenCalledTimes(3);
		expect(h.resize).toHaveBeenCalledWith(expect.objectContaining({ width: 2789, height: 825, fit: 'contain' }));
	});

	it('uploads as a banner sized for its position', async () => {
		await run();
		const [, request] = h.presign.mock.calls[0] as [unknown, Record<string, unknown>];
		expect(request).toMatchObject({ purpose: 'banner', contentType: 'image/jpeg', maxDisplayWidth: 2560 });
	});

	it('keeps no audit trail for a local tool', async () => {
		await run();
		await expect(held.audit?.append('entry')).resolves.toBe('entry');
	});

	it('never overwrites a filled slot', async () => {
		h.findByKey = vi.fn(async (key: string) => (key === 'home:-:hero:main' ? { key } : null));
		await run();
		expect(h.upsert).toHaveBeenCalledTimes(9);
		expect(h.presign).toHaveBeenCalledTimes(9);
	});

	it('stops at an unreadable image', async () => {
		h.metadata = vi.fn(async () => ({}));
		await run();
		expect(failure().message).toContain('unreadable image');
		expect(process.exitCode).toBe(1);
		expect(h.disconnect).toHaveBeenCalledOnce();
	});

	it('stops at an image with no height', async () => {
		h.metadata = vi.fn(async () => ({ width: 100 }));
		await run();
		expect(failure().message).toContain('unreadable image');
	});

	it('stops when the bucket refuses the upload', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 403 })),
		);
		await run();
		expect(failure().message).toContain('upload refused (403)');
		expect(h.finalize).not.toHaveBeenCalled();
	});

	it('reports a failed image', async () => {
		h.status = vi.fn(async () => ({ state: 'failed', error: 'bad file' }));
		await run();
		expect(failure().message).toContain('processing failed: bad file');
		expect(h.upsert).not.toHaveBeenCalled();
	});

	it('waits for the worker, then gives up', async () => {
		vi.spyOn(globalThis, 'setTimeout').mockImplementation(((done: () => void) => {
			done();
			return 0;
		}) as never);
		h.status = vi.fn(async () => ({ state: 'processing' }));
		await run();
		for (let i = 0; i < 400; i += 1) await new Promise((done) => setImmediate(done));
		expect(h.status).toHaveBeenCalledTimes(180);
		expect(failure().message).toContain('worker did not finish');
	});
});
