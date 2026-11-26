import { describe, expect, it, vi } from 'vitest';

/** Every adapter and use case the worker composes is a stand-in: nothing reaches a database, queue or bucket. */
const h = vi.hoisted(() => ({
	started: [] as Array<{ handlers: Record<string, (job: never) => Promise<unknown>> }>,
	documentFailed: [] as Array<(job: unknown, error: Error) => void>,
	settings: {
		get: vi.fn(async (): Promise<unknown> => ({ themeColor: '#417394' })),
		set: vi.fn(async () => undefined),
	},
	audit: { append: vi.fn(async () => undefined) },
	ledger: { release: vi.fn(async () => undefined) },
	storage: {
		getUrl: vi.fn((key: string) => `https://cdn.test/${key}`),
		listKeys: vi.fn(),
		deleteMany: vi.fn(async () => undefined),
	},
	assets: {
		referencedIds: vi.fn(async () => []),
		findManyByIds: vi.fn(async () => []),
		whereUsed: vi.fn(async () => new Map()),
		listStaleForRole: vi.fn(async () => []),
	},
	languagesList: vi.fn(async (): Promise<unknown[]> => []),
	locales: null as null | (() => string[]),
	jobs: { waiting: vi.fn(async () => 0), nightly: vi.fn(async () => ({ withProblems: 0, pruned: 0, warms: 0 })) },
	fetchRatesIfDue: vi.fn(async (): Promise<unknown> => null),
	warmPage: vi.fn(async (): Promise<unknown> => ({ skipped: null, statuses: [200, 200] })),
	use: {
		processMediaAsset: vi.fn(async (deps: { brandLogo(): unknown; brandColour(): Promise<unknown> }) => {
			await deps.brandLogo();
			return deps.brandColour();
		}),
		cutSwatch: vi.fn(async (deps: { process(id: string): Promise<unknown> }, input: { assetId: string }) =>
			deps.process(input.assetId),
		),
		sweepZips: vi.fn(async (deps: { releaseHold(id: string): Promise<unknown> }) => {
			await deps.releaseHold('hold_zip');
			return 0;
		}),
		checkSpaces: vi.fn(async (deps: Record<string, (value?: unknown) => unknown>) => {
			deps['listKeys']?.('media/');
			deps['referencedIds']?.();
			deps['findManyByIds']?.([]);
			deps['whereUsed']?.([]);
			return { filesInSpaces: 3, missingCount: 1, unrecorded: { count: 2 } };
		}),
		sweepKeptFiles: vi.fn(async () => 0),
		purgeMediaTrash: vi.fn(
			async (deps: {
				publicUrl(key: string): string;
				record(action: string, metadata: object): Promise<unknown>;
			}) => {
				deps.publicUrl('media/a');
				await deps.record('media.trash.purge', {});
				return { files: 0, folders: 0 };
			},
		),
		sweepUnfinishedUploads: vi.fn(
			async (deps: {
				release(id: string): Promise<unknown>;
				record(action: string, metadata: object): Promise<unknown>;
			}) => {
				await deps.release('hold_up');
				await deps.record('media.upload.swept', {});
				return 0;
			},
		),
	},
}));

vi.mock('@saha-textile/adapters-queue-bullmq', () => ({
	BullMqMediaJobQueue: class {
		enqueue = vi.fn(async () => undefined);
		registerSchedules = vi.fn(async () => undefined);
		close = vi.fn(async () => undefined);
	},
	startMediaWorker: (input: (typeof h.started)[number]) => {
		h.started.push(input);
		return { close: vi.fn(async () => undefined) };
	},
	startDocumentWorker: () => ({
		close: vi.fn(async () => undefined),
		on: (_event: string, listener: (job: unknown, error: Error) => void) => void h.documentFailed.push(listener),
	}),
}));
vi.mock('@saha-textile/adapters-pdf-chromium', () => ({
	ChromiumDocumentRenderer: class {
		close = vi.fn(async () => undefined);
	},
}));
vi.mock('@saha-textile/adapters-storage-spaces', () => ({
	SpacesStorageAdapter: class {
		getUrl = h.storage.getUrl;
		listKeys = h.storage.listKeys;
		deleteMany = h.storage.deleteMany;
	},
}));
vi.mock('@saha-textile/adapters-image-sharp', () => ({ SharpImageCodec: class {}, SharpImageAnalysis: class {} }));
vi.mock('@saha-textile/adapters-cdn-cloudflare', () => ({
	CloudflareCdnPurge: class {
		purgeUrls = vi.fn(async () => undefined);
	},
}));
vi.mock('@saha-textile/adapters-youtube', () => ({ YouTubeDataApi: class {} }));
vi.mock('@saha-textile/adapters-archive-zip', () => ({ YazlZipArchive: class {} }));
vi.mock('@saha-textile/adapters-fx', () => ({
	ExchangeRateApiFxAdapter: class {
		constructor(public options: unknown) {}
	},
}));
vi.mock('@saha-textile/adapters-db-mongo', () => {
	const plain = class {};
	return {
		MongoAuditLogRepository: class {
			append = h.audit.append;
		},
		MongoCommunicationSwitchRepository: plain,
		MongoCurrencyRepository: plain,
		MongoConsentRepository: plain,
		MongoCustomerRepository: plain,
		MongoLanguageRepository: class {
			seedIfEmpty = async () => false;
			list = h.languagesList;
		},
		MongoMediaAssetRepository: class {
			referencedIds = h.assets.referencedIds;
			findManyByIds = h.assets.findManyByIds;
			whereUsed = h.assets.whereUsed;
			listStaleForRole = h.assets.listStaleForRole;
		},
		MongoMediaFavouriteRepository: plain,
		MongoMediaFolderRepository: plain,
		MongoMediaProfileRepository: plain,
		MongoEmailPictureRepository: plain,
		MongoMediaRoleRepository: class {
			list = async () => [];
		},
		MongoShareLinkRepository: plain,
		MongoMessageOutboxRepository: plain,
		MongoNotificationSettingsRepository: plain,
		MongoNotificationTemplateRepository: plain,
		MongoOrderRepository: plain,
		MongoProductInsightSetRepository: plain,
		MongoProductRelationRepository: plain,
		MongoProductRepository: plain,
		MongoProductVariantRepository: plain,
		MongoSiteSettingsRepository: class {
			get = h.settings.get;
			set = h.settings.set;
		},
		MongoStockAlertRepository: plain,
		MongoStorageLedgerRepository: class {
			release = h.ledger.release;
		},
		MongoMediaZipRepository: plain,
	};
});
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<typeof import('@saha-textile/core-domain')>()),
	reconcileSeededRoles: async () => [],
	brandStripLogo: async () => null,
	processMediaAsset: h.use.processMediaAsset,
	replaceMediaAsset: vi.fn(async () => ({ status: 'replaced' })),
	cutSwatch: h.use.cutSwatch,
	dropUnusedCut: vi.fn(async () => 'dropped'),
	sweepUnusedCuts: vi.fn(async () => 1),
	buildZip: vi.fn(async () => 'ready'),
	sweepZips: h.use.sweepZips,
	checkSpaces: h.use.checkSpaces,
	sweepKeptFiles: h.use.sweepKeptFiles,
	purgeMediaTrash: h.use.purgeMediaTrash,
	sweepUnfinishedUploads: h.use.sweepUnfinishedUploads,
	measureWordSpots: vi.fn(async () => 'measured'),
}));
vi.mock('../src/search/meilisearch-search', () => ({
	MeilisearchSearch: class {
		constructor(_host: unknown, _key: unknown, _loaded: unknown, _index: unknown, locales: () => string[]) {
			h.locales = locales;
		}
	},
	noProductsLoaded: async () => [],
}));
vi.mock('../src/search/search-release', () => ({
	drainSearchQueue: async () => ({ indexed: 0, removed: 0, failed: 0 }),
	nightlySearchCheck: async () => ({ live: 0, indexed: 0, missing: 0, extra: 0, requested: 0 }),
	catchUpSearch: async () => 0,
}));
vi.mock('../src/page-builder/page-go-live.worker', () => ({ composePageBuilderJobs: () => h.jobs }));
vi.mock('../src/fx/fx-fetch', () => ({ fetchRatesIfDue: h.fetchRatesIfDue }));
vi.mock('../src/page-builder/page-warm', () => ({ warmPage: h.warmPage }));

import { composeMediaWorker } from '../src/worker/media-worker';

const config = (over: Record<string, unknown> = {}) =>
	({
		spaces: { key: 'k', secret: 's', bucket: 'b', region: 'r', endpoint: 'e', cdnUrl: 'c' },
		redis: { host: 'h', port: 1, db: 0 },
		media: { workerConcurrency: 2, gcLive: false },
		notifications: { provider: 'console' },
		search: { index: 'products' },
		locales: ['en', 'bn'],
		fx: {},
		documents: {
			chromiumChannel: undefined,
			chromiumExecutable: '/usr/bin/chromium',
			noSandbox: true,
			renderTimeoutMs: 30_000,
		},
		...over,
	}) as never;

const handlers = async (input = config()) => {
	h.started.length = 0;
	await composeMediaWorker(input);
	return (h.started[0] as (typeof h.started)[number]).handlers;
};
const run = (all: Record<string, (job: never) => Promise<unknown>>, name: string, job: unknown = {}) =>
	(all[name] as (job: unknown) => Promise<unknown>)(job);

describe('the media worker’s jobs', () => {
	it('starts with the stored languages even when they cannot be read, and indexes every content language', async () => {
		h.languagesList.mockRejectedValueOnce(new Error('database down'));
		await handlers();
		expect(h.locales?.()).toContain('en');
	});

	it('processes with the Brand Kit’s colour, or none, and cuts a swatch through the same processing', async () => {
		const all = await handlers();
		expect(await run(all, 'process', { assetId: 'med_1' })).toBe('#417394');
		h.settings.get.mockResolvedValueOnce(null);
		expect(await run(all, 'reprocess', { assetId: 'med_1' })).toBeNull();
		await run(all, 'cut', { assetId: 'med_cut' });
		expect(h.use.processMediaAsset).toHaveBeenLastCalledWith(expect.anything(), {
			assetId: 'med_cut',
			reprocess: true,
		});
		expect(await run(all, 'replace', { assetId: 'med_1' })).toEqual({ status: 'replaced' });
		expect(await run(all, 'drop-cut', { assetId: 'med_cut' })).toBe('dropped');
		expect(await run(all, 'cut-sweep')).toBe(1);
		expect(await run(all, 'word-spots', { assetId: 'med_1', versionId: 'ver_1' })).toEqual({ outcome: 'measured' });
	});

	it('settles waiting Go Lives, quietly when none went, and runs the nightly page check', async () => {
		const all = await handlers();
		expect(await run(all, 'page-go-live-waiting')).toEqual({ went: 0 });
		h.jobs.waiting.mockResolvedValueOnce(2);
		expect(await run(all, 'page-go-live-waiting')).toEqual({ went: 2 });
		expect(await run(all, 'page-builder-nightly')).toEqual({ withProblems: 0, pruned: 0, warms: 0 });
	});

	it('warms a page with the shop address or none, naming a skip or the answers', async () => {
		const noOrigin = await handlers();
		await run(noOrigin, 'page-warm', { pageType: 'home', at: 'now' });
		expect(h.warmPage).toHaveBeenLastCalledWith(expect.objectContaining({ origin: null }), 'home');
		const all = await handlers(
			config({ media: { workerConcurrency: 2, gcLive: false, shopOrigin: 'https://shop.test' } }),
		);
		h.warmPage.mockResolvedValueOnce({ skipped: 'no origin', statuses: [] });
		expect(await run(all, 'page-warm', { pageType: 'home', at: 'now' })).toEqual({
			skipped: 'no origin',
			statuses: [],
		});
	});

	it('fetches exchange rates when due, with or without a key, saying what changed or why it failed', async () => {
		const all = await handlers();
		expect(await run(all, 'fx-fetch-due')).toBeNull();
		for (const result of [
			{ ok: false, problem: null },
			{ ok: false, problem: 'quota' },
			{ ok: true, updated: [] },
			{ ok: true, updated: ['USD'] },
		]) {
			h.fetchRatesIfDue.mockResolvedValueOnce(result);
			expect(await run(all, 'fx-fetch-due')).toBe(result);
		}
		const keyed = await handlers(config({ fx: { exchangeRateApiKey: 'fx-key' } }));
		await run(keyed, 'fx-fetch-due');
	});

	it('sweeps .zip files, kept files, Trash and unfinished uploads, logging only when something went', async () => {
		const all = await handlers();
		await run(all, 'zip', { zipId: 'zip_1' });
		await run(all, 'zip-sweep');
		h.use.sweepZips.mockResolvedValueOnce(2);
		await run(all, 'zip-sweep');
		expect(h.ledger.release).toHaveBeenCalledWith('hold_zip');
		expect(await run(all, 'kept-files-sweep')).toBe(0);
		h.use.sweepKeptFiles.mockResolvedValueOnce(4);
		expect(await run(all, 'kept-files-sweep')).toBe(4);
		expect(await run(all, 'trash-purge')).toEqual({ files: 0, folders: 0 });
		h.use.purgeMediaTrash.mockResolvedValueOnce({ files: 2, folders: 1 });
		expect(await run(all, 'trash-purge')).toEqual({ files: 2, folders: 1 });
		expect(await run(all, 'upload-sweep')).toEqual({ swept: 0 });
		h.use.sweepUnfinishedUploads.mockResolvedValueOnce(3);
		expect(await run(all, 'upload-sweep')).toEqual({ swept: 3 });
		expect(h.audit.append).toHaveBeenCalled();
	});

	it('checks Spaces against the records and keeps the answer for the Media page', async () => {
		const all = await handlers();
		expect(await run(all, 'spaces-check')).toEqual({ missing: 1, unrecorded: 2 });
		expect(h.settings.set).toHaveBeenCalledWith(
			'media_nightly_check',
			expect.objectContaining({ missingCount: 1 }),
		);
	});

	it('logs a business document that failed, with or without its job', async () => {
		h.documentFailed.length = 0;
		await handlers();
		const [failed] = h.documentFailed;
		expect(() => failed?.(undefined, new Error('chromium crashed'))).not.toThrow();
		expect(() => failed?.({ id: 'doc_1' }, new Error('timeout'))).not.toThrow();
	});
});
