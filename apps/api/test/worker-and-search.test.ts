import { Logger } from '@nestjs/common';
import { Product } from '@saha-textile/contracts';
import { SearchUnavailableError, type StoragePort, type YouTubePort } from '@saha-textile/core-domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleNotificationAdapter } from '../src/infra/console-notification.adapter';
import { LogOnlyCdnPurgeAdapter } from '../src/infra/log-only-cdn-purge.adapter';
import { buildNotificationPort } from '../src/infra/notification-factory';
import { UnavailableNotificationAdapter } from '../src/infra/unavailable-notification.adapter';
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
	documentWorkerClose: vi.fn(async () => {}),
	documentWorkerOn: vi.fn(),
	rendererClose: vi.fn(async () => {}),
	rendererConfigs: [] as unknown[],
	storage: { deleteMany: vi.fn(async () => {}) },
	purge: vi.fn(async () => {}),
	reconcile: vi.fn(async () => [] as string[]),
	process: vi.fn(async () => ({ status: 'ready' })),
	gc: vi.fn(async () => ({ dryRun: true, softDeleted: [], restored: [], hardDeleted: [] })),
	refresh: vi.fn(async () => ({ videos: 1 })),
	posters: vi.fn(async () => ({ copied: 1, kept: 0, removed: 0 })),
	videoCheck: vi.fn(async () => ({ checked: 2, gone: 1, back: 0, products: 1 })),
	weekly: vi.fn(async () => ({ insightSetId: 'w', relations: 2 })),
	alerts: vi.fn(async () => ({ sent: 1, held: 0, waiting: 0 })),
	roles: vi.fn(async () => [{ key: 'card', version: 2 }]),
	stale: vi.fn(async () => [
		{ id: 'm1', originalStorageKey: 'k' },
		{ id: 'm2', originalStorageKey: null },
	]),
	CloudflareCalls: [] as unknown[],
	YouTubeCalls: [] as unknown[],
	drain: vi.fn(async () => ({ indexed: 0, removed: 0, failed: 0 })),
	check: vi.fn(async () => ({
		checkedAt: new Date(0),
		live: 2,
		indexed: 1,
		missing: 1,
		extra: 0,
		recent: 0,
		requested: 1,
	})),
	catchUp: vi.fn(async () => 0),
}));

vi.mock('../src/search/search-release', () => ({
	drainSearchQueue: hoisted.drain,
	nightlySearchCheck: hoisted.check,
	catchUpSearch: hoisted.catchUp,
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
	startDocumentWorker: () => ({ close: hoisted.documentWorkerClose, on: hoisted.documentWorkerOn }),
}));
vi.mock('@saha-textile/adapters-pdf-chromium', () => ({
	ChromiumDocumentRenderer: class {
		close = hoisted.rendererClose;
		constructor(config: unknown) {
			hoisted.rendererConfigs.push(config);
		}
	},
}));
vi.mock('@saha-textile/adapters-storage-spaces', () => ({
	SpacesStorageAdapter: class {
		deleteMany = hoisted.storage.deleteMany;
	},
}));
vi.mock('@saha-textile/adapters-image-sharp', () => ({ SharpImageCodec: class {}, SharpImageAnalysis: class {} }));
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
		// Settings › Languages: the worker reads the stored list (none here, so ACTIVE_LOCALES stands in).
		MongoLanguageRepository: class {
			async seedIfEmpty() {
				return false;
			}
			async list() {
				return [];
			}
		},
		MongoAuditLogRepository: plain,
		MongoConsentRepository: plain,
		MongoCommunicationSwitchRepository: plain,
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
		// Page Builder (step 7): the waiting Go Lives and the nightly check are composed when the worker starts.
		MongoAdminUserRepository: plain,
		MongoAdminUserRoleAssignmentRepository: plain,
		MongoBlogPostRepository: plain,
		MongoCategoryPlacementRepository: plain,
		MongoContentBlockRepository: plain,
		MongoPageLayoutRepository: plain,
		MongoRoleRepository: plain,
		MongoSavedBlockRepository: plain,
		MongoMediaAssetRepository: class {
			listStaleForRole = hoisted.stale;
		},
		MongoMediaRoleRepository: class {
			list = hoisted.roles;
		},
		MongoMediaProfileRepository: plain,
		MongoEmailPictureRepository: plain,
		// Folder downloads as .zip (media step 5): made when the worker starts.
		MongoMediaZipRepository: plain,
		MongoStorageLedgerRepository: plain,
		MongoMediaFolderRepository: plain,
	};
});
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<typeof import('@saha-textile/core-domain')>()),
	reconcileSeededRoles: hoisted.reconcile,
	processMediaAsset: hoisted.process,
	runMediaGarbageCollection: hoisted.gc,
	refreshYouTubeFeed: hoisted.refresh,
	copyYouTubePosters: hoisted.posters,
	checkProductVideos: hoisted.videoCheck,
	runWeeklyInsight: hoisted.weekly,
	deliverStockAlerts: hoisted.alerts,
}));

const config = (overrides: Record<string, unknown> = {}) =>
	({
		spaces: { key: 'k', secret: 's', bucket: 'b', region: 'r', endpoint: 'e', cdnUrl: 'c' },
		redis: { host: 'h', port: 1, db: 0 },
		media: { workerConcurrency: 2, gcLive: false },
		notifications: { provider: 'console' },
		search: { index: 'products' },
		locales: ['en'],
		documents: {
			chromiumChannel: undefined,
			chromiumExecutable: '/usr/local/bin/document-chromium',
			noSandbox: true,
			renderTimeoutMs: 30_000,
		},
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
		// Business documents: the PDF worker and its browser close with the rest.
		expect(hoisted.documentWorkerClose).toHaveBeenCalledTimes(1);
		expect(hoisted.rendererClose).toHaveBeenCalledTimes(1);
		expect(hoisted.rendererConfigs.at(-1)).toMatchObject({
			executablePath: '/usr/local/bin/document-chromium',
			noSandbox: true,
		});
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
		expect(await running.entry.handlers['youtube-refresh']?.({} as never)).toEqual({
			videos: 1,
			posters: { copied: 1, kept: 0, removed: 0 },
		});
		expect(hoisted.YouTubeCalls).toEqual([{ apiKey: 'y' }]);
		// A poster failure never undoes the refreshed list.
		hoisted.posters.mockRejectedValueOnce(new Error('spaces down'));
		expect(await running.entry.handlers['youtube-refresh']?.({} as never)).toEqual({ videos: 1, posters: null });
	});

	it('skips the weekly product-video check with no key, and runs it with one', async () => {
		const skipped = await started();
		expect(await skipped.entry.handlers['product-videos-check']?.({} as never)).toEqual({
			skipped: 'not_configured',
		});
		hoisted.started.length = 0;
		const running = await started(config({ media: { workerConcurrency: 1, youtubeApiKey: 'y' } }));
		expect(await running.entry.handlers['product-videos-check']?.({} as never)).toMatchObject({ gone: 1 });
	});

	it('queues stale assets that still have an original', async () => {
		const { entry } = await started();
		expect(await entry.handlers['reprocess-stale']?.({} as never)).toEqual({ queued: 1 });
		expect(hoisted.queue.enqueue).toHaveBeenCalledWith({ type: 'reprocess', assetId: 'm1', reason: 'ladder' });
	});

	it('drains the search queue, runs the nightly check, and logs only when something moved', async () => {
		const { entry } = await started();
		await expect(entry.handlers['search-outbox']?.({} as never)).resolves.toEqual({
			indexed: 0,
			removed: 0,
			failed: 0,
		});
		hoisted.drain.mockResolvedValueOnce({ indexed: 2, removed: 1, failed: 1 });
		await expect(entry.handlers['search-outbox']?.({} as never)).resolves.toMatchObject({ indexed: 2 });
		await expect(entry.handlers['search-check']?.({} as never)).resolves.toMatchObject({ missing: 1 });
	});

	it('catches search up at start, and survives a failed catch-up', async () => {
		hoisted.catchUp.mockResolvedValueOnce(3);
		await started();
		expect(hoisted.catchUp).toHaveBeenCalledTimes(1);
		hoisted.catchUp.mockRejectedValueOnce(new Error('search down'));
		await expect(started()).resolves.toBeDefined();
		await new Promise((done) => setImmediate(done));
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
		config({ notifications: { msg91EmailFrom: { account: 'a@example.test' }, ...values } });

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

	it('on a server deployed without the key, refuses messages instead of pretending to send them', () => {
		const withoutKey = (deployEnv: string) =>
			config({
				nodeEnv: 'production',
				deployEnv,
				notifications: { msg91EmailFrom: { account: 'a@example.test' }, provider: 'msg91' },
			});
		for (const deployEnv of ['staging', 'production']) {
			expect(buildNotificationPort(withoutKey(deployEnv), stores)).toBeInstanceOf(UnavailableNotificationAdapter);
		}
		expect(buildNotificationPort(withoutKey('local'), stores)).toBeInstanceOf(ConsoleNotificationAdapter);
	});
});

describe('UnavailableNotificationAdapter', () => {
	const message = {
		channel: 'sms',
		category: 'transactional',
		templateKey: 'otp_login',
		destination: '+919800000000',
		variables: { code: '481516' },
	} as const;

	it('records every message as failed, and logs neither the destination nor the code', async () => {
		const append = vi.fn(async (entry: unknown) => entry);
		const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		const port = new UnavailableNotificationAdapter(
			{ append, findByIdempotencyKey: vi.fn() } as never,
			() => new Date('2026-11-21T10:00:00.000Z'),
		);
		const result = await port.send(message as never);
		expect(result).toMatchObject({ status: 'failed', providerMessageId: null });
		expect(append).toHaveBeenCalledWith(
			expect.objectContaining({
				id: result.outboxEntryId,
				status: 'failed',
				templateKey: 'otp_login',
				errorMessage: UnavailableNotificationAdapter.REASON,
				createdAt: '2026-11-21T10:00:00.000Z',
				idempotencyKey: null,
			}),
		);
		const recorded = JSON.stringify(append.mock.calls);
		expect(recorded).not.toContain('9800000000');
		expect(recorded).not.toContain('481516');
		const logged = JSON.stringify(warn.mock.calls);
		expect(logged).toContain('otp_login');
		expect(logged).not.toContain('9800000000');
		expect(logged).not.toContain('481516');
		expect(await port.isChannelEnabled('sms', 'transactional')).toBe(false);
		warn.mockRestore();
	});

	it('answers a retry with the first attempt instead of recording it twice', async () => {
		const prior = { id: 'outbox_1', status: 'failed', providerMessageId: null };
		const append = vi.fn();
		const port = new UnavailableNotificationAdapter({
			append,
			findByIdempotencyKey: vi.fn(async () => prior),
		} as never);
		await expect(port.send({ ...message, idempotencyKey: 'k1' } as never)).resolves.toEqual({
			status: 'failed',
			providerMessageId: null,
			outboxEntryId: 'outbox_1',
		});
		expect(append).not.toHaveBeenCalled();
	});

	it('records a first attempt with its key and its shopper, timed by the clock', async () => {
		const append = vi.fn(async (entry: unknown) => entry);
		const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		const port = new UnavailableNotificationAdapter({
			append,
			findByIdempotencyKey: vi.fn(async () => null),
		} as never);
		const before = Date.now();
		const result = await port.send({ ...message, idempotencyKey: 'k2', userId: 'cus_1' } as never);
		expect(result.status).toBe('failed');
		const entry = append.mock.calls[0]?.[0] as { idempotencyKey: string; userId: string; createdAt: string };
		expect(entry).toMatchObject({ idempotencyKey: 'k2', userId: 'cus_1' });
		expect(Date.parse(entry.createdAt)).toBeGreaterThanOrEqual(before);
		warn.mockRestore();
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
	) => new MeilisearchSearch(host, key, load, 'products', ['en', 'bn']);

	beforeEach(() => {
		fetcher.mockReset();
		vi.stubGlobal('fetch', fetcher);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sets up the index and sends the document', async () => {
		fetcher.mockImplementation(async (url: string) =>
			reply(200, url.includes('/tasks/') ? { status: 'succeeded' } : { taskUid: 7 }),
		);
		const index = search();
		const full = (id: string) =>
			Product.parse({ id, type: 'simple', sku: id, title: { en: id }, slug: id, basePriceINR: 100 });
		await index.indexProduct({ product: full('p1'), variants: [] });
		await index.indexProduct({ product: full('p2'), variants: [] });
		expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
			'http://meili.test/indexes/products_v1/settings',
			'http://meili.test/tasks/7',
			'http://meili.test/indexes/products_v1/documents',
			'http://meili.test/indexes/products_v1/documents',
		]);
		expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer k' } });
	});

	it('removes a document, encoded, and takes an empty reply', async () => {
		fetcher.mockImplementation(async () => reply(204));
		await search(undefined, 'http://meili.test', '').removeProduct('a/b');
		expect(fetcher.mock.calls[0]?.[0]).toBe('http://meili.test/indexes/products_v1/documents/a%2Fb');
		expect(fetcher.mock.calls[0]?.[1].headers).not.toHaveProperty('authorization');
		expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('body');
	});

	/** Settings and tasks succeed; the search itself answers `body`. */
	const answer = (body: unknown) =>
		fetcher.mockImplementation(async (url: string) =>
			url.includes('/search')
				? reply(200, body)
				: reply(200, url.includes('/tasks/') ? { status: 'succeeded' } : { taskUid: 7 }),
		);
	const searchBody = () =>
		JSON.parse(
			fetcher.mock.calls.find((call) => String(call[0]).endsWith('/search'))?.[1].body as string,
		) as Record<string, unknown>;

	it('returns live products in the order found, "show first" sorting before the attribute rank', async () => {
		answer({ hits: [{ id: 'b' }, {}, { id: 'a' }, { id: 'gone' }, { id: 'draft' }], estimatedTotalHits: 9 });
		const result = await search(async () => [product('a'), product('b'), product('draft', 'draft')]).search({
			q: 'silk',
			categoryId: 'c"1',
			page: 2,
			pageSize: 5,
		} as never);
		expect(result).toMatchObject({ total: 9, page: 2, pageSize: 5 });
		expect(result.items.map((row) => row.id)).toEqual(['b', 'a']);
		expect(searchBody()).toMatchObject({
			q: 'silk',
			offset: 5,
			limit: 5,
			filter: 'categoryIds = "c\\"1"',
			sort: ['rankFirst:asc'],
		});
		const settings = JSON.parse(fetcher.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
		expect(settings).toMatchObject({
			searchableAttributes: ['words', 'searchTerms', 'facts', 'description'],
			rankingRules: ['words', 'typo', 'sort', 'attribute', 'proximity', 'exactness'],
		});
		expect(settings['sortableAttributes']).toContain('rankFirst');
		expect(settings).not.toHaveProperty('synonyms');
	});

	it('uses defaults for a bare query and an empty reply', async () => {
		answer({});
		const result = await search().search({ q: 'x', page: 0, pageSize: 0 } as never);
		expect(result).toMatchObject({ total: 0, page: 1, pageSize: 24, items: [] });
		expect(searchBody()).not.toHaveProperty('filter');
		fetcher.mockReset();
		answer({ hits: [{ id: 'a' }] });
		expect((await search().search({ q: 'x' } as never)).total).toBe(1);
	});

	it('writes many documents in batches and replaces the synonyms, keeping them for a rebuild', async () => {
		answer({});
		const index = search();
		const full = (id: string) =>
			Product.parse({ id, type: 'simple', sku: id, title: { en: id }, slug: id, basePriceINR: 100 });
		await index.indexProducts([]);
		expect(fetcher).not.toHaveBeenCalled();
		await index.indexProducts(
			Array.from({ length: 501 }, (_, n) => ({
				product: full(`p${n}`),
				variants: [],
				searchTerms: ['puja', 'পুজো'],
				showFirst: n === 0,
			})),
		);
		const writes = fetcher.mock.calls.filter((call) => String(call[0]).endsWith('/documents'));
		expect(writes).toHaveLength(2);
		const first = (JSON.parse(writes[0]?.[1].body as string) as Array<Record<string, unknown>>)[0];
		expect(first).toMatchObject({ searchTerms: 'puja পুজো', rankFirst: 0 });
		await index.updateSynonyms({ puja: ['pujo'] });
		const put = fetcher.mock.calls.find((call) => String(call[0]).endsWith('/settings/synonyms'));
		expect(put?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ puja: ['pujo'] }) });
		fetcher.mockClear();
		await index.replaceIndex([]);
		const applied = JSON.parse(fetcher.mock.calls[0]?.[1].body as string) as Record<string, unknown>;
		expect(applied['synonyms']).toEqual({ puja: ['pujo'] });
	});

	it('says search is down rather than falling through', async () => {
		await expect(search(undefined, '').search({ q: 'x' } as never)).rejects.toBeInstanceOf(SearchUnavailableError);
		fetcher.mockRejectedValueOnce(new Error('refused'));
		await expect(search().search({ q: 'x' } as never)).rejects.toBeInstanceOf(SearchUnavailableError);
		fetcher.mockResolvedValueOnce(reply(500));
		await expect(search().search({ q: 'x' } as never)).rejects.toBeInstanceOf(SearchUnavailableError);
	});
});
