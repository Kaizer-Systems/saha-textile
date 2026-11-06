import type { AuditLog, MediaAsset, MediaRoleDefinition } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	ImageDecodeError,
	SEEDED_MEDIA_ROLES,
	checkIngest,
	checkReviewPhotos,
	derivativeStorageKey,
	discardReviewPhotos,
	originalStorageKey,
	planDerivatives,
	processMediaAsset,
	publishReviewPhotos,
	refreshYouTubeFeed,
	resolveImage,
	runMediaGarbageCollection,
	staleRolesOf,
	type ImageCodecPort,
	type MediaAssetRepository,
	type MediaJob,
	type SiteSettingsRepository,
	type StoragePort,
	type YouTubePort,
} from '../src/index';

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: 'med_1',
	kind: 'image',
	purpose: 'product',
	originalStorageKey: 'media/med_1/original.jpg',
	originalFormat: 'image/jpeg',
	originalByteSize: 1000,
	width: null,
	height: null,
	slug: 'red-banarasi-saree',
	derivatives: [],
	dominantColor: null,
	thumbHash: null,
	visibility: 'public',
	processing: { state: 'queued', attempts: 0, error: null, processedAt: null },
	warnings: [],
	servesAsPrimary: false,
	maxDisplayWidth: null,
	renditions: [],
	hlsPlaylistKey: null,
	durationSeconds: null,
	text: { alt: { en: 'Red saree' }, title: {}, caption: {} },
	status: 'draft',
	uploadedBy: null,
	deletedAt: null,
	createdAt: '2026-10-01T00:00:00.000Z',
	...overrides,
});

/* ---------- in-memory test doubles for the use cases ---------- */

class FakeAssets implements MediaAssetRepository {
	readonly rows = new Map<string, MediaAsset>();
	references = new Map<string, number>();
	constructor(seed: MediaAsset[]) {
		for (const row of seed) this.rows.set(row.id, row);
	}
	async findById(id: string) {
		return this.rows.get(id) ?? null;
	}
	async findManyByIds(ids: readonly string[]) {
		return ids.map((id) => this.rows.get(id)).filter((row): row is MediaAsset => !!row);
	}
	async list() {
		return { items: [...this.rows.values()], total: this.rows.size, page: 1, pageSize: 24 };
	}
	async create(row: MediaAsset) {
		this.rows.set(row.id, row);
		return row;
	}
	async update(row: MediaAsset) {
		this.rows.set(row.id, row);
		return row;
	}
	async countReferences(id: string) {
		return this.references.get(id) ?? 0;
	}
	async claimForProcessing(id: string, options?: { allowReady?: boolean }) {
		const row = this.rows.get(id);
		const allowed = ['queued', 'failed', ...(options?.allowReady ? ['ready'] : [])];
		if (!row || !allowed.includes(row.processing.state)) return null;
		const claimed = {
			...row,
			processing: { ...row.processing, state: 'processing' as const, attempts: row.processing.attempts + 1 },
		};
		this.rows.set(id, claimed);
		return claimed;
	}
	async listStaleForRole() {
		return [];
	}
	async listLiveCreatedBefore(input: { createdBefore: string; afterId: string | null; limit: number }) {
		return [...this.rows.values()]
			.filter(
				(row) =>
					!row.deletedAt &&
					(row.createdAt ?? '') < input.createdBefore &&
					(!input.afterId || row.id > input.afterId),
			)
			.slice(0, input.limit);
	}
	async listOrphans(input: { deletedBefore: string; limit: number }) {
		return [...this.rows.values()]
			.filter((row) => row.deletedAt && row.deletedAt <= input.deletedBefore)
			.slice(0, input.limit);
	}
	async softDelete(id: string, at: string) {
		const row = this.rows.get(id);
		if (row) this.rows.set(id, { ...row, deletedAt: at });
	}
	async restore(id: string) {
		const row = this.rows.get(id);
		if (row) this.rows.set(id, { ...row, deletedAt: null });
	}
	async hardDelete(id: string) {
		this.rows.delete(id);
	}
}

const storage = (bytes = new Uint8Array([1, 2, 3])) => {
	const uploads: { key: string; visibility?: string; cacheControl?: string }[] = [];
	const port: StoragePort = {
		upload: async (input) => {
			uploads.push(input);
			return { key: input.key, url: `https://cdn.test/${input.key}` };
		},
		download: async () => bytes,
		getUrl: (key) => `https://cdn.test/${key}`,
		delete: async () => {},
		deleteMany: async () => {},
		setVisibility: async () => {},
		createSignedDownloadUrl: async ({ key }) => `https://signed.test/${key}`,
		createSignedUploadUrl: async ({ key }) => ({ url: `https://upload.test/${key}` }),
	};
	return { port, uploads };
};

const codec = (probe: Awaited<ReturnType<ImageCodecPort['probe']>> | Error): ImageCodecPort => ({
	probe: async () => {
		if (probe instanceof Error) throw probe;
		return probe;
	},
	render: async (_bytes, spec) => ({
		bytes: new Uint8Array(10),
		width: spec.width,
		height: spec.height ?? Math.round((spec.width * 4) / 3),
		sha256: `${spec.width}`.padEnd(8, 'a') + spec.format.length,
	}),
	placeholder: async () => ({ thumbHash: 'AAAA', dominantColor: '#aa3322' }),
});

const queue = () => {
	const jobs: MediaJob[] = [];
	return {
		jobs,
		port: {
			enqueue: async (job: MediaJob) => {
				jobs.push(job);
			},
		},
	};
};

const roles = {
	list: async () => SEEDED_MEDIA_ROLES as MediaRoleDefinition[],
	findByKey: async () => null,
	save: async (role: MediaRoleDefinition) => role,
	insertMissing: async () => 0,
};
const now = () => new Date('2026-11-02T00:00:00.000Z');

const derivative = (overrides: Record<string, unknown> = {}) =>
	({
		role: 'card',
		storageKey: 'media/med_1/old.webp',
		width: 400,
		height: 533,
		byteSize: 1,
		format: 'image/webp',
		roleVersion: 1,
		...overrides,
	}) as MediaAsset['derivatives'][number];

const ready = { state: 'ready' as const, attempts: 1, error: null, processedAt: null };

const audit = () => {
	const entries: AuditLog[] = [];
	return {
		entries,
		port: {
			append: async (entry: AuditLog) => {
				entries.push(entry);
				return entry;
			},
			list: async () => ({ items: [], total: 0, page: 1, pageSize: 1 }),
			purgeOlderThan: async () => 0,
		},
	};
};

const role = (overrides: Partial<MediaRoleDefinition>): MediaRoleDefinition => ({
	key: 'wide',
	label: 'Wide',
	seeded: false,
	purposes: ['banner'],
	widths: [800],
	aspect: { width: 2, height: 1 },
	fit: 'pad',
	format: 'image/webp',
	quality: 80,
	primaryOnly: false,
	respectSlotMaxWidth: false,
	version: 1,
	...overrides,
});

describe('checkIngest for blogs', () => {
	const blog = { purpose: 'blog' as const, contentType: 'image/jpeg', byteSize: 1000 };
	it('warns on a narrow blog image only', () => {
		expect(checkIngest({ ...blog, width: 900, height: 506 }).warnings).toContain('below_recommended_size');
		expect(checkIngest({ ...blog, width: 2400, height: 1350 }).warnings).not.toContain('below_recommended_size');
	});
});

describe('planDerivatives shapes', () => {
	it.each(['category', 'blog'] as const)('letterboxes an off-shape %s image', (purpose) => {
		const plan = planDerivatives({
			asset: asset({ purpose }),
			source: { width: 3000, height: 3000 },
			roles: [],
			servesAsPrimary: false,
		});
		expect(plan.letterboxed).toBe(true);
	});

	it('skips a letterboxed width that would need upscaling', () => {
		const plan = planDerivatives({
			asset: asset(),
			source: { width: 800, height: 800 },
			roles: [role({ purposes: ['product'], fit: 'inside', aspect: null, widths: [600, 1200] })],
			servesAsPrimary: false,
		});
		expect(plan.letterboxed).toBe(true);
		expect(plan.derivatives.map((row) => row.spec.width)).toEqual([600]);
		expect(plan.skipped).toEqual([{ role: 'wide', width: 1200 }]);
	});

	it('skips a boxed width that would need upscaling', () => {
		const plan = planDerivatives({
			asset: asset({ purpose: 'banner' }),
			source: { width: 500, height: 250 },
			roles: [role({})],
			servesAsPrimary: false,
		});
		expect(plan.derivatives).toEqual([]);
		expect(plan.skipped).toEqual([{ role: 'wide', width: 800 }]);
	});
});

describe('storage keys', () => {
	it('names originals by type', () => {
		expect(originalStorageKey('med_1', 'image/png')).toBe('media/med_1/original.png');
		expect(originalStorageKey('med_1', 'image/jpeg')).toBe('media/med_1/original.jpg');
	});

	it('uses jpg for a JPEG derivative', () => {
		const key = derivativeStorageKey({
			assetId: 'med_1',
			slug: 'red',
			role: 'email_thumb',
			width: 300,
			sha256: 'abcdef0123',
			format: 'image/jpeg',
		});
		expect(key).toBe('media/med_1/red-email-thumb-300w-abcdef01.jpg');
	});
});

describe('runMediaGarbageCollection paging', () => {
	const deps = (assets: FakeAssets, jobs = queue()) => ({
		assets,
		storage: storage().port,
		queue: jobs.port,
		audit: audit().port,
		now,
		newId: () => 'aud_1',
	});
	const many = (prefix: string, count: number, overrides: Partial<MediaAsset>) =>
		Array.from({ length: count }, (_, index) =>
			asset({
				id: `${prefix}${String(index).padStart(3, '0')}`,
				createdAt: '2026-08-01T00:00:00.000Z',
				...overrides,
			}),
		);

	it('walks every page of live assets', async () => {
		const report = await runMediaGarbageCollection(deps(new FakeAssets(many('a', 201, {}))), { dryRun: true });
		expect(report.softDeleted).toHaveLength(201);
	});

	it('walks every page of orphans and stops when none are left', async () => {
		const assets = new FakeAssets(many('o', 201, { deletedAt: '2026-09-01T00:00:00.000Z' }));
		const report = await runMediaGarbageCollection(deps(assets), { dryRun: false });
		expect(report.hardDeleted).toHaveLength(201);
		expect(assets.rows.size).toBe(0);
	});

	it('stops when a full page holds only what it already handled', async () => {
		const assets = new FakeAssets(many('r', 200, { deletedAt: '2026-09-01T00:00:00.000Z' }));
		for (const id of assets.rows.keys()) assets.references.set(id, 1);
		assets.restore = async () => {};
		const report = await runMediaGarbageCollection(deps(assets), { dryRun: false });
		expect(report.restored).toHaveLength(200);
	});

	it('changes nothing past grace in a dry run', async () => {
		const assets = new FakeAssets([
			asset({ id: 'gone', deletedAt: '2026-09-01T00:00:00.000Z' }),
			asset({ id: 'back', deletedAt: '2026-09-01T00:00:00.000Z' }),
		]);
		assets.references.set('back', 1);
		const report = await runMediaGarbageCollection(deps(assets), { dryRun: true });
		expect(report).toMatchObject({ hardDeleted: ['gone'], restored: ['back'] });
		expect(assets.rows.size).toBe(2);
		expect(assets.rows.get('back')?.deletedAt).not.toBeNull();
	});

	it('deletes public objects with their URLs, private ones without', async () => {
		const jobs = queue();
		const assets = new FakeAssets([
			asset({
				id: 'public',
				deletedAt: '2026-09-01T00:00:00.000Z',
				derivatives: [derivative()],
			}),
			asset({
				id: 'private',
				visibility: 'private',
				originalStorageKey: null,
				deletedAt: '2026-09-01T00:00:00.000Z',
				derivatives: [derivative({ storageKey: 'media/private/a.webp' })],
			}),
			asset({ id: 'empty', originalStorageKey: null, deletedAt: '2026-09-01T00:00:00.000Z' }),
		]);
		await runMediaGarbageCollection(deps(assets, jobs), { dryRun: false });
		expect(jobs.jobs).toEqual([
			{
				type: 'delete-objects',
				keys: ['media/med_1/old.webp', 'media/med_1/original.jpg'],
				urls: ['https://cdn.test/media/med_1/old.webp'],
			},
			{ type: 'delete-objects', keys: ['media/private/a.webp'], urls: [] },
		]);
		expect(assets.rows.size).toBe(0);
	});
});

describe('processMediaAsset edges', () => {
	const run = async (seed: MediaAsset, probe: Parameters<typeof codec>[0], jobs = queue()) => {
		const assets = new FakeAssets([seed]);
		const outcome = processMediaAsset(
			{ assets, roles, storage: storage().port, codec: codec(probe), queue: jobs.port, now },
			{ assetId: seed.id, reprocess: true },
		);
		return { outcome, assets, jobs };
	};
	const jpeg = { width: 3000, height: 4000, format: 'jpeg' as const, hasAlpha: false };

	it('settles an asset with no original and keeps its derivatives', async () => {
		const kept = [derivative()];
		const { outcome, assets } = await run(asset({ originalStorageKey: null, derivatives: kept }), jpeg);
		expect(await outcome).toEqual({ status: 'ready', rendered: 0, skipped: 0 });
		expect(assets.rows.get('med_1')?.derivatives).toEqual(kept);
	});

	it('rejects a photo below the floor once decoded, and deletes it', async () => {
		const { outcome, jobs } = await run(asset(), { ...jpeg, width: 400, height: 500 });
		expect(await outcome).toEqual({ status: 'rejected', reason: 'below_minimum' });
		expect(jobs.jobs).toEqual([{ type: 'delete-objects', keys: ['media/med_1/original.jpg'], urls: [] }]);
	});

	it('records a failure that is not a decode error and lets the queue retry', async () => {
		const { outcome, assets } = await run(asset(), new Error('disk full'));
		await expect(outcome).rejects.toThrow('disk full');
		expect(assets.rows.get('med_1')?.processing).toMatchObject({ state: 'failed', error: 'disk full' });
	});

	it('records a thrown value that is not an Error', async () => {
		const assets = new FakeAssets([asset()]);
		const broken = { ...storage().port, download: () => Promise.reject('offline') } as StoragePort;
		await expect(
			processMediaAsset(
				{ assets, roles, storage: broken, codec: codec(jpeg), queue: queue().port, now },
				{ assetId: 'med_1', reprocess: false },
			),
		).rejects.toBe('offline');
		expect(assets.rows.get('med_1')?.processing.error).toBe('processing failed');
	});

	it('warns on letterboxing and skipped widths', async () => {
		const { outcome, assets } = await run(asset(), { ...jpeg, width: 1800, height: 1800 });
		await outcome;
		expect(assets.rows.get('med_1')?.warnings).toEqual(
			expect.arrayContaining(['aspect_off_target', 'letterboxed', 'role_width_skipped']),
		);
	});

	it('retires dropped files, with URLs for a public asset', async () => {
		const { outcome, jobs } = await run(asset({ derivatives: [derivative()] }), jpeg);
		await outcome;
		expect(jobs.jobs).toEqual([
			{
				type: 'delete-objects',
				keys: ['media/med_1/old.webp'],
				urls: ['https://cdn.test/media/med_1/old.webp'],
			},
		]);
	});

	it('retires dropped files without URLs for a private asset', async () => {
		const { outcome, jobs } = await run(asset({ visibility: 'private', derivatives: [derivative()] }), jpeg);
		await outcome;
		expect(jobs.jobs).toEqual([{ type: 'delete-objects', keys: ['media/med_1/old.webp'], urls: [] }]);
	});

	it('treats a decode error as a rejection', async () => {
		const { outcome } = await run(asset(), new ImageDecodeError('no', null));
		expect(await outcome).toEqual({ status: 'rejected', reason: 'not_an_image' });
	});
});

describe('resolveImage alt fallback', () => {
	const resolved = (text: Record<string, string>, altOverride?: Record<string, string>) =>
		resolveImage({
			asset: asset({
				width: 300,
				height: 400,
				derivatives: [derivative()],
				text: { alt: text, title: {}, caption: {} },
			}),
			getUrl: (key) => key,
			locale: 'fr',
			fallbackLocale: 'en',
			...(altOverride ? { altOverride } : {}),
		});

	it('falls back through the override, then the asset, then nothing', () => {
		expect(resolved({ en: 'Asset' }, { en: 'Override' })?.alt).toBe('Override');
		expect(resolved({ en: 'Asset' })?.alt).toBe('Asset');
		expect(resolved({})?.alt).toBe('');
	});
});

describe('staleRolesOf', () => {
	it('lists each role rendered from an older version once', () => {
		const stale = asset({
			derivatives: [
				derivative(),
				derivative({ width: 800 }),
				derivative({ role: 'gallery', roleVersion: 2 }),
				derivative({ role: 'unknown' }),
			],
		});
		expect(
			staleRolesOf(
				stale,
				new Map([
					['card', 2],
					['gallery', 2],
				]),
			),
		).toEqual(['card']);
	});
});

describe('review photos', () => {
	const photo = (overrides: Partial<MediaAsset> = {}) =>
		asset({
			id: 'p1',
			purpose: 'review',
			visibility: 'private',
			uploadedBy: { type: 'customer', id: 'cus_1' },
			processing: ready,
			derivatives: [derivative()],
			...overrides,
		});
	const check = (seed: MediaAsset[], assetIds: string[]) =>
		checkReviewPhotos({ assets: new FakeAssets(seed) }, { customerId: 'cus_1', assetIds });

	it('refuses a missing, wrong, unready or admin-owned photo', async () => {
		expect((await check([], ['p1'])).refusal).toBe('not_found');
		expect((await check([photo({ purpose: 'product' })], ['p1'])).refusal).toBe('wrong_purpose');
		expect((await check([photo({ processing: { ...ready, state: 'processing' } })], ['p1'])).refusal).toBe(
			'not_ready',
		);
		expect((await check([photo({ uploadedBy: { type: 'admin', id: 'cus_1' } })], ['p1'])).refusal).toBe(
			'not_owned',
		);
		expect((await check([photo({ uploadedBy: null })], ['p1'])).refusal).toBe('not_owned');
	});

	it('publishes a private review photo and leaves others alone', async () => {
		const assets = new FakeAssets([
			photo(),
			photo({ id: 'p2', visibility: 'public' }),
			photo({ id: 'p3', purpose: 'product' }),
		]);
		const port = { ...storage().port, setVisibility: vi.fn(async () => {}) };
		await publishReviewPhotos({ assets, storage: port, queue: queue().port }, ['p1', 'p2', 'p3']);
		expect(port.setVisibility).toHaveBeenCalledTimes(1);
		expect(port.setVisibility).toHaveBeenCalledWith('media/med_1/old.webp', 'public');
		expect(assets.rows.get('p1')).toMatchObject({ visibility: 'public', status: 'live' });
		expect(assets.rows.get('p3')?.visibility).toBe('private');
	});

	it('discards review photos only', async () => {
		const assets = new FakeAssets([photo(), photo({ id: 'p2', purpose: 'product' })]);
		await discardReviewPhotos({ assets, storage: storage().port, queue: queue().port }, ['p1', 'p2']);
		expect([...assets.rows.keys()]).toEqual(['p2']);
	});
});

describe('refreshYouTubeFeed', () => {
	const video = (index: number) => ({
		videoId: `video${index}`,
		title: `Video ${index}`,
		publishedAt: '2026-10-01T00:00:00.000Z',
		thumbnailUrl: 'https://i.ytimg.com/a.jpg',
	});
	const build = (stored: unknown, channel: unknown) => {
		const set = vi.fn(async () => {});
		const settings = { get: async () => stored, set } as unknown as SiteSettingsRepository;
		const youtube = {
			resolveChannel: vi.fn(async () => channel),
			listPlaylistVideos: vi.fn(async () => Array.from({ length: 12 }, (_, index) => video(index))),
		} as unknown as YouTubePort;
		return { set, settings, youtube };
	};

	it('stops when the channel cannot be found', async () => {
		const { settings, youtube, set } = build(null, null);
		expect(await refreshYouTubeFeed({ settings, youtube, now })).toEqual({ skipped: 'channel_not_found' });
		expect(youtube.resolveChannel).toHaveBeenCalledWith('@SahaTextile');
		expect(set).not.toHaveBeenCalled();
	});

	it('resolves the channel once, saves it, and stores ten videos', async () => {
		const { settings, youtube, set } = build(null, { channelId: 'UC1', uploadsPlaylistId: 'UU1' });
		expect(await refreshYouTubeFeed({ settings, youtube, now })).toEqual({ videos: 12 });
		expect(set).toHaveBeenNthCalledWith(1, 'youtube', expect.objectContaining({ uploadsPlaylistId: 'UU1' }));
		const feed = (set.mock.calls[1] as unknown as [string, { videos: unknown[]; fetchedAt: string }])[1];
		expect(feed.videos).toHaveLength(10);
		expect(feed.fetchedAt).toBe('2026-11-02T00:00:00.000Z');
	});

	it('reuses a saved playlist', async () => {
		const { settings, youtube } = build(
			{ channelHandle: '@a', channelId: 'UC1', uploadsPlaylistId: 'UU9', displayCount: 8, railPlacements: [] },
			null,
		);
		await refreshYouTubeFeed({ settings, youtube, now });
		expect(youtube.resolveChannel).not.toHaveBeenCalled();
		expect(youtube.listPlaylistVideos).toHaveBeenCalledWith({ playlistId: 'UU9', limit: 10 });
	});
});
