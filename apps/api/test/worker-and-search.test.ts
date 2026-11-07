import type { Product } from '@saha-textile/contracts';
import { SearchUnavailableError, type StoragePort, type YouTubePort } from '@saha-textile/core-domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleNotificationAdapter } from '../src/infra/console-notification.adapter';
import { LogOnlyCdnPurgeAdapter } from '../src/infra/log-only-cdn-purge.adapter';
import { buildNotificationPort } from '../src/infra/notification-factory';
import { UnavailableYouTubeAdapter } from '../src/infra/unavailable-youtube.adapter';
import { UnconfiguredStorageAdapter } from '../src/infra/unconfigured-storage.adapter';
import { MeilisearchSearch } from '../src/search/meilisearch-search';
import { composeMediaWorker } from '../src/worker/media-worker';

const hoisted = vi.hoisted(() => ({
	started: [] as Array<{
		handlers: Record<string, (job: never) => Promise<unknown>>;
		onFailed: (job: unknown, error: Error) => void;
	}>,
	queue: {
		enqueue: vi.fn(async () => {}),
		registerSchedules: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
	},
	workerClose: vi.fn(async () => {}),
	storage: { deleteMany: vi.fn(async () => {}) },
	purge: vi.fn(async () => {}),
	reconcile: vi.fn(async () => [] as string[]),
	process: vi.fn(async () => ({ status: 'ready' })),
	gc: vi.fn(async () => ({ dryRun: true, softDeleted: [], restored: [], hardDeleted: [] })),
	refresh: vi.fn(async () => ({ videos: 1 })),
	weekly: vi.fn(async () => ({ insightSetId: 'w', relations: 2 })),
	alerts: vi.fn(async () => ({ sent: 1, held: 0, waiting: 0 })),
	roles: vi.fn(async () => [{ key: 'card', version: 2 }]),
	stale: vi.fn(async () => [
		{ id: 'm1', originalStorageKey: 'k' },
		{ id: 'm2', originalStorageKey: null },
	]),
	CloudflareCalls: [] as unknown[],
	YouTubeCalls: [] as unknown[],
}));

vi.mock('@saha-textile/adapters-queue-bullmq', () => ({
	BullMqMediaJobQueue: class {
		enqueue = hoisted.queue.enqueue;
		registerSchedules = hoisted.queue.registerSchedules;
		close = hoisted.queue.close;
	},
	startMediaWorker: (input: (typeof hoisted.started)[number]) => {
		hoisted.started.push(input);
		return { close: hoisted.workerClose };
	},
}));
vi.mock('@saha-textile/adapters-storage-spaces', () => ({
	SpacesStorageAdapter: class {
		deleteMany = hoisted.storage.deleteMany;
	},
}));
vi.mock('@saha-textile/adapters-image-sharp', () => ({ SharpImageCodec: class {} }));
vi.mock('@saha-textile/adapters-cdn-cloudflare', () => ({
	CloudflareCdnPurge: class {
		purgeUrls = hoisted.purge;
		constructor(config: unknown) {
			hoisted.CloudflareCalls.push(config);
		}
	},
}));
vi.mock('@saha-textile/adapters-youtube', () => ({
	YouTubeDataApi: class {
		constructor(config: unknown) {
			hoisted.YouTubeCalls.push(config);
		}
	},
}));
vi.mock('@saha-textile/adapters-db-mongo', () => {
	const plain = class {};
	return {
		MongoAuditLogRepository: plain,
		MongoConsentRepository: plain,
		MongoCustomerRepository: plain,
		MongoMessageOutboxRepository: plain,
		MongoNotificationSettingsRepository: plain,
		MongoNotificationTemplateRepository: plain,
		MongoOrderRepository: plain,
		MongoProductInsightSetRepository: plain,
		MongoProductRelationRepository: plain,
		MongoProductRepository: plain,
		MongoProductVariantRepository: plain,
		MongoSiteSettingsRepository: plain,
		MongoStockAlertRepository: plain,
		MongoMediaAssetRepository: class {
			listStaleForRole = hoisted.stale;
		},
		MongoMediaRoleRepository: class {
			list = hoisted.roles;
		},
	};
});
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<typeof import('@saha-textile/core-domain')>()),
	reconcileSeededRoles: hoisted.reconcile,
	processMediaAsset: hoisted.process,
	runMediaGarbageCollection: hoisted.gc,
	refreshYouTubeFeed: hoisted.refresh,
	runWeeklyInsight: hoisted.weekly,
	deliverStockAlerts: hoisted.alerts,
}));

const config = (overrides: Record<string, unknown> = {}) =>
	({
		spaces: { key: 'k', secret: 's', bucket: 'b', region: 'r', endpoint: 'e', cdnUrl: 'c' },
		redis: { host: 'h', port: 1, db: 0 },
		media: { workerConcurrency: 2, gcLive: false },
		notifications: { provider: 'console' },
		...overrides,
	}) as never;

beforeEach(() => {
	hoisted.started.length = 0;
	hoisted.CloudflareCalls.length = 0;
	hoisted.YouTubeCalls.length = 0;
	vi.clearAllMocks();
});

const started = async (input = config()) => {
	const worker = await composeMediaWorker(input);
	return { worker, entry: hoisted.started[0] as (typeof hoisted.started)[number] };
};

describe('composeMediaWorker', () => {
	it('needs storage credentials', async () => {
		for (const spaces of [
			{ secret: 's', bucket: 'b' },
			{ key: 'k', bucket: 'b' },
			{ key: 'k', secret: 's' },
		]) {
			await expect(composeMediaWorker(config({ spaces }))).rejects.toThrow('needs Spaces credentials');
		}
	});

	it('registers schedules, logs reconciled roles, and closes both halves', async () => {
		hoisted.reconcile.mockResolvedValueOnce(['card']);
		const { worker } = await started();
		expect(hoisted.queue.registerSchedules).toHaveBeenCalledTimes(1);
		await worker.close();
		expect(hoisted.workerClose).toHaveBeenCalledTimes(1);
		expect(hoisted.queue.close).toHaveBeenCalledTimes(1);
	});

	it('names a failed job, or says it does not know which', async () => {
		const { entry } = await started();
		expect(() => entry.onFailed({ name: 'process', id: '1' }, new Error('boom'))).not.toThrow();
		expect(() => entry.onFailed(undefined, new Error('boom'))).not.toThrow();
	});

	it('processes and reprocesses', async () => {
		const { entry } = await started();
		await entry.handlers['process']?.({ assetId: 'm1' } as never);
		expect(hoisted.process).toHaveBeenLastCalledWith(expect.anything(), { assetId: 'm1', reprocess: false });
		await entry.handlers['reprocess']?.({ assetId: 'm1' } as never);
		expect(hoisted.process).toHaveBeenLastCalledWith(expect.anything(), { assetId: 'm1', reprocess: true });
	});

	it('uses Cloudflare when it is configured, and only logs a purge when it is not', async () => {
		const purging = await started(
			config({ media: { workerConcurrency: 1, cloudflareZoneId: 'z', cloudflarePurgeToken: 't' } }),
		);
		expect(hoisted.CloudflareCalls).toEqual([{ zoneId: 'z', apiToken: 't' }]);
		await purging.entry.handlers['delete-objects']?.({ keys: ['k'], urls: ['u'] } as never);
		expect(hoisted.storage.deleteMany).toHaveBeenCalledWith(['k']);
		expect(hoisted.purge).toHaveBeenCalledWith(['u']);
		await purging.entry.handlers['delete-objects']?.({ keys: ['k'], urls: [] } as never);
		expect(hoisted.purge).toHaveBeenCalledTimes(1);
		await purging.entry.handlers['purge']?.({ urls: ['v'] } as never);
		expect(hoisted.purge).toHaveBeenLastCalledWith(['v']);
		hoisted.started.length = 0;
		const logging = await started(config({ media: { workerConcurrency: 1, cloudflareZoneId: 'z' } }));
		await expect(logging.entry.handlers['purge']?.({ urls: ['v'] } as never)).resolves.toBeUndefined();
	});

	it('runs garbage collection as a dry run unless it is live', async () => {
		const dry = await started();
		await dry.entry.handlers['gc']?.({} as never);
		expect(hoisted.gc).toHaveBeenLastCalledWith(expect.anything(), { dryRun: true });
		((hoisted.gc.mock.calls as unknown[][])[0]?.[0] as { newId: () => string }).newId();
		hoisted.gc.mockResolvedValueOnce({
			dryRun: false,
			softDeleted: ['a'] as never[],
			restored: [],
			hardDeleted: [],
		});
		hoisted.started.length = 0;
		const live = await started(config({ media: { workerConcurrency: 1, gcLive: true } }));
		await live.entry.handlers['gc']?.({} as never);
		expect(hoisted.gc).toHaveBeenLastCalledWith(expect.anything(), { dryRun: false });
	});

	it('skips the YouTube refresh with no key, and runs it with one', async () => {
		const skipped = await started();
		expect(await skipped.entry.handlers['youtube-refresh']?.({} as never)).toEqual({ skipped: 'not_configured' });
		hoisted.started.length = 0;
		const running = await started(config({ media: { workerConcurrency: 1, youtubeApiKey: 'y' } }));
		expect(await running.entry.handlers['youtube-refresh']?.({} as never)).toEqual({ videos: 1 });
		expect(hoisted.YouTubeCalls).toEqual([{ apiKey: 'y' }]);
	});

	it('queues stale assets that still have an original', async () => {
		const { entry } = await started();
		expect(await entry.handlers['reprocess-stale']?.({} as never)).toEqual({ queued: 1 });
		expect(hoisted.queue.enqueue).toHaveBeenCalledWith({ type: 'reprocess', assetId: 'm1', reason: 'ladder' });
	});

	it('runs the weekly insight and stock alerts', async () => {
		const { entry } = await started();
		expect(await entry.handlers['weekly-insight']?.({} as never)).toMatchObject({ relations: 2 });
		expect(await entry.handlers['stock-alerts']?.({} as never)).toMatchObject({ sent: 1 });
		const now = (hoisted.weekly.mock.calls[0] as unknown as [{ now: () => Date }])[0].now;
		expect(now()).toBeInstanceOf(Date);
	});
});

describe('buildNotificationPort', () => {
	const stores = {} as never;
	const notifications = (values: Record<string, unknown>) =>
		config({ notifications: { msg91EmailFrom: 'a@example.test', ...values } });

	it('uses MSG91 only with a key', () => {
		const port = buildNotificationPort(notifications({ provider: 'msg91', msg91AuthKey: 'key' }), stores);
		expect(port).not.toBeInstanceOf(ConsoleNotificationAdapter);
		expect(buildNotificationPort(notifications({ provider: 'msg91' }), stores)).toBeInstanceOf(
			ConsoleNotificationAdapter,
		);
		expect(
			buildNotificationPort(notifications({ provider: 'console', msg91AuthKey: 'key' }), stores),
		).toBeInstanceOf(ConsoleNotificationAdapter);
	});
});

describe('local stand-ins', () => {
	it('console notifier says a message went nowhere real', async () => {
		const port = new ConsoleNotificationAdapter();
		expect(await port.isChannelEnabled('email', 'transactional')).toBe(true);
		const result = await port.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'k',
			destination: 'a@example.test',
		} as never);
		expect(result.providerMessageId).toBeDefined();
	});

	it('log-only purge does nothing', async () => {
		await expect(new LogOnlyCdnPurgeAdapter().purgeUrls(['u'])).resolves.toBeUndefined();
	});

	it('unavailable YouTube refuses plainly', async () => {
		const port = new UnavailableYouTubeAdapter() as unknown as YouTubePort;
		await expect(port.resolveChannel('@a')).rejects.toThrow();
		await expect(port.listPlaylistVideos({ playlistId: 'p', limit: 1 })).rejects.toThrow();
		await expect(port.findVideo('v')).rejects.toThrow();
	});

	it('unconfigured storage refuses every write and read', async () => {
		const port = new UnconfiguredStorageAdapter() as unknown as StoragePort;
		for (const call of [
			() => port.upload({ key: 'k', body: new Uint8Array(), contentType: 't' }),
			() => port.download('k'),
			() => port.delete('k'),
			() => port.deleteMany(['k']),
			() => port.setVisibility('k', 'public'),
			() => port.createSignedDownloadUrl({ key: 'k', expiresInSeconds: 1 }),
			() => port.createSignedUploadUrl({ key: 'k', contentType: 't' }),
		]) {
			await expect((async () => call())()).rejects.toThrow();
		}
		expect(() => port.getUrl('k')).toThrow();
	});
});

describe('MeilisearchSearch', () => {
	const reply = (status: number, body: unknown = {}) =>
		new Response(status === 204 ? null : JSON.stringify(body), { status });
	const fetcher = vi.fn();
	const product = (id: string, status = 'live') =>
		({ id, slug: id, sku: id, title: { en: id }, categoryIds: [], status }) as unknown as Product;
	const search = (
		load: (ids: readonly string[]) => Promise<Product[]> = async () => [],
		host: string | undefined = 'http://meili.test/',
		key: string | undefined = 'k',
	) => new MeilisearchSearch(host, key, load, 'products');

	beforeEach(() => {
		fetcher.mockReset();
		vi.stubGlobal('fetch', fetcher);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sets up the index and sends the document', async () => {
		fetcher.mockResolvedValue(reply(202, {}));
		fetcher.mockImplementation(async () => reply(202, {}));
		await search().indexProduct(product('p1'));
		expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
			'http://meili.test/indexes/products/settings',
			'http://meili.test/indexes/products/documents',
		]);
		expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer k' } });
	});

	it('removes a document, encoded, and takes an empty reply', async () => {
		fetcher.mockImplementation(async () => reply(204));
		await search(undefined, 'http://meili.test', '').removeProduct('a/b');
		expect(fetcher.mock.calls[0]?.[0]).toBe('http://meili.test/indexes/products/documents/a%2Fb');
		expect(fetcher.mock.calls[0]?.[1].headers).not.toHaveProperty('authorization');
		expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('body');
	});

	it('returns live products in the order found', async () => {
		fetcher.mockImplementation(async () =>
			reply(200, {
				hits: [{ id: 'b' }, {}, { id: 'a' }, { id: 'gone' }, { id: 'draft' }],
				estimatedTotalHits: 9,
			}),
		);
		const result = await search(async () => [product('a'), product('b'), product('draft', 'draft')]).search({
			q: 'silk',
			categoryId: 'c"1',
			page: 2,
			pageSize: 5,
		} as never);
		expect(result).toMatchObject({ total: 9, page: 2, pageSize: 5 });
		expect(result.items.map((row) => row.id)).toEqual(['b', 'a']);
		const body = JSON.parse(fetcher.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
		expect(body).toMatchObject({ q: 'silk', offset: 5, limit: 5, filter: 'categoryIds = "c\\"1"' });
	});

	it('uses defaults for a bare query and an empty reply', async () => {
		fetcher.mockImplementation(async () => reply(200, {}));
		const result = await search().search({ q: 'x', page: 0, pageSize: 0 } as never);
		expect(result).toMatchObject({ total: 0, page: 1, pageSize: 24, items: [] });
		const body = JSON.parse(fetcher.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
		expect(body).not.toHaveProperty('filter');
		fetcher.mockImplementation(async () => reply(200, { hits: [{ id: 'a' }] }));
		expect((await search().search({ q: 'x' } as never)).total).toBe(1);
	});

	it('says search is down rather than falling through', async () => {
		await expect(search(undefined, '').search({ q: 'x' } as never)).rejects.toBeInstanceOf(SearchUnavailableError);
		fetcher.mockRejectedValueOnce(new Error('refused'));
		await expect(search().search({ q: 'x' } as never)).rejects.toBeInstanceOf(SearchUnavailableError);
		fetcher.mockResolvedValueOnce(reply(500));
		await expect(search().search({ q: 'x' } as never)).rejects.toBeInstanceOf(SearchUnavailableError);
	});
});
