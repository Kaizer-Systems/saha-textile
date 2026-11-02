import type { AuditLog, MediaAsset, MediaRoleDefinition } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	ImageDecodeError,
	SEEDED_MEDIA_ROLES,
	checkIngest,
	checkReviewPhotos,
	derivativeStorageKey,
	mediaSlug,
	planDerivatives,
	processMediaAsset,
	resolveImage,
	reviewPhotoSlug,
	runMediaGarbageCollection,
	type ImageCodecPort,
	type MediaAssetRepository,
	type MediaJob,
	type StoragePort,
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

const widthsOf = (plan: ReturnType<typeof planDerivatives>, role: string) =>
	plan.derivatives.filter((derivative) => derivative.role === role).map((derivative) => derivative.spec.width);

describe('checkIngest — the locked caps', () => {
	const base = { purpose: 'product' as const, contentType: 'image/jpeg', byteSize: 5_000_000 };
	it('accepts a 3:4 product photo at the floor', () => {
		expect(checkIngest({ ...base, width: 1600, height: 2133 })).toEqual({ refusal: null, warnings: [] });
	});
	it('refuses types, bytes, pixels and the product floor', () => {
		expect(checkIngest({ ...base, contentType: 'image/webp', width: 1600, height: 2133 }).refusal?.code).toBe(
			'type_not_accepted',
		);
		expect(checkIngest({ ...base, byteSize: 26 * 1024 * 1024, width: 1600, height: 2133 }).refusal?.code).toBe(
			'too_large',
		);
		expect(checkIngest({ ...base, width: 8001, height: 6000 }).refusal?.code).toBe('too_many_pixels');
		expect(checkIngest({ ...base, width: 7900, height: 7000 }).refusal?.code).toBe('too_many_pixels');
		expect(checkIngest({ ...base, width: 1500, height: 2000 }).refusal?.code).toBe('below_minimum');
	});
	it('warns, not refuses, an off-3:4 product photo and a small review photo', () => {
		expect(checkIngest({ ...base, width: 2000, height: 2000 }).warnings).toEqual(['aspect_off_target']);
		expect(checkIngest({ ...base, purpose: 'review', width: 400, height: 300 })).toEqual({
			refusal: null,
			warnings: ['below_recommended_size'],
		});
	});
});

describe('planDerivatives — the locked ladder', () => {
	it('renders every product width from a large 3:4 source, without primary-only roles', () => {
		const plan = planDerivatives({
			asset: asset(),
			source: { width: 3000, height: 4000 },
			roles: SEEDED_MEDIA_ROLES,
			servesAsPrimary: false,
		});
		expect(widthsOf(plan, 'card')).toEqual([200, 400, 700, 960]);
		expect(widthsOf(plan, 'gallery')).toEqual([600, 900, 1200, 1600]);
		expect(widthsOf(plan, 'zoom')).toEqual([2000]);
		expect(widthsOf(plan, 'swatch_image')).toEqual([80, 160, 240]);
		expect(widthsOf(plan, 'share')).toEqual([]);
		expect(plan.letterboxed).toBe(false);
	});
	it('adds share, feed and email copies for the primary image', () => {
		const plan = planDerivatives({
			asset: asset(),
			source: { width: 3000, height: 4000 },
			roles: SEEDED_MEDIA_ROLES,
			servesAsPrimary: true,
		});
		expect(widthsOf(plan, 'share')).toEqual([1200]);
		expect(widthsOf(plan, 'feed_square')).toEqual([1200]);
		expect(plan.derivatives.find((derivative) => derivative.role === 'email_thumb')?.spec.format).toBe(
			'image/jpeg',
		);
	});
	it('never upscales: a 1600 px source skips the 2000 px zoom', () => {
		const plan = planDerivatives({
			asset: asset(),
			source: { width: 1600, height: 2133 },
			roles: SEEDED_MEDIA_ROLES,
			servesAsPrimary: false,
		});
		expect(widthsOf(plan, 'zoom')).toEqual([]);
		expect(plan.skipped).toContainEqual({ role: 'zoom', width: 2000 });
	});
	it('letterboxes an off-3:4 product photo to 3:4', () => {
		const plan = planDerivatives({
			asset: asset(),
			source: { width: 3000, height: 3000 },
			roles: SEEDED_MEDIA_ROLES,
			servesAsPrimary: false,
		});
		const card = plan.derivatives.find((derivative) => derivative.role === 'card' && derivative.spec.width === 400);
		expect(plan.letterboxed).toBe(true);
		expect(card?.spec).toMatchObject({ fit: 'pad', width: 400, height: 533 });
	});
	it('keeps banner shape and skips widths beyond twice the slot', () => {
		const plan = planDerivatives({
			asset: asset({ purpose: 'banner', maxDisplayWidth: 694 }),
			source: { width: 2880, height: 1620 },
			roles: SEEDED_MEDIA_ROLES,
			servesAsPrimary: false,
		});
		expect(widthsOf(plan, 'banner')).toEqual([480, 768, 1080]);
		expect(plan.letterboxed).toBe(false);
	});
	it('review photos get exactly the two review roles', () => {
		const plan = planDerivatives({
			asset: asset({ purpose: 'review' }),
			source: { width: 3024, height: 4032 },
			roles: SEEDED_MEDIA_ROLES,
			servesAsPrimary: false,
		});
		expect([...new Set(plan.derivatives.map((derivative) => derivative.role))]).toEqual([
			'review_thumb',
			'review_full',
		]);
	});
});

describe('storage keys and slugs', () => {
	it('builds immutable derivative keys', () => {
		expect(
			derivativeStorageKey({
				assetId: 'med_1',
				slug: 'red-saree',
				role: 'swatch_image',
				width: 160,
				sha256: '9c1d2e4fabcdef',
				format: 'image/webp',
			}),
		).toBe('media/med_1/red-saree-swatch-image-160w-9c1d2e4f.webp');
	});
	it('slugs to ASCII and never leaks a customer into a review photo name', () => {
		expect(mediaSlug('Dhakāi Jamdani Saree.JPG')).toBe('dhakai-jamdani-saree');
		expect(mediaSlug('***')).toBe('image');
		expect(reviewPhotoSlug('Bridal Lehenga')).toBe('bridal-lehenga-customer-photo');
	});
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

describe('processMediaAsset', () => {
	it('renders, uploads immutably, and records placeholders', async () => {
		const assets = new FakeAssets([asset()]);
		const store = storage();
		const jobs = queue();
		const outcome = await processMediaAsset(
			{
				assets,
				roles,
				storage: store.port,
				codec: codec({ width: 3000, height: 4000, format: 'jpeg', hasAlpha: false }),
				queue: jobs.port,
				now,
			},
			{ assetId: 'med_1', reprocess: false },
		);
		const saved = assets.rows.get('med_1');
		expect(outcome).toMatchObject({ status: 'ready' });
		expect(saved?.processing.state).toBe('ready');
		expect(saved?.dominantColor).toBe('#aa3322');
		expect(
			saved?.derivatives.some((derivative) => derivative.role === 'gallery' && derivative.width === 1600),
		).toBe(true);
		expect(store.uploads.every((upload) => upload.cacheControl?.includes('immutable'))).toBe(true);
		expect(jobs.jobs).toEqual([]);
	});

	it('deletes an upload that is not really an image', async () => {
		const assets = new FakeAssets([asset()]);
		const jobs = queue();
		const outcome = await processMediaAsset(
			{
				assets,
				roles,
				storage: storage().port,
				codec: codec(new ImageDecodeError('nope')),
				queue: jobs.port,
				now,
			},
			{ assetId: 'med_1', reprocess: false },
		);
		expect(outcome).toEqual({ status: 'rejected', reason: 'not_an_image' });
		expect(assets.rows.get('med_1')?.originalStorageKey).toBeNull();
		expect(jobs.jobs).toEqual([{ type: 'delete-objects', keys: ['media/med_1/original.jpg'], urls: [] }]);
	});

	it('rejects bytes whose real type differs from the declared one', async () => {
		const assets = new FakeAssets([asset()]);
		const outcome = await processMediaAsset(
			{
				assets,
				roles,
				storage: storage().port,
				codec: codec({ width: 3000, height: 4000, format: 'webp', hasAlpha: false }),
				queue: queue().port,
				now,
			},
			{ assetId: 'med_1', reprocess: false },
		);
		expect(outcome).toEqual({ status: 'rejected', reason: 'content_does_not_match_declared_type' });
	});

	it('writes review photos private and discards their original', async () => {
		const assets = new FakeAssets([asset({ purpose: 'review', visibility: 'private' })]);
		const store = storage();
		const jobs = queue();
		await processMediaAsset(
			{
				assets,
				roles,
				storage: store.port,
				codec: codec({ width: 3024, height: 4032, format: 'jpeg', hasAlpha: false }),
				queue: jobs.port,
				now,
			},
			{ assetId: 'med_1', reprocess: false },
		);
		expect(store.uploads.every((upload) => upload.visibility === 'private')).toBe(true);
		expect(assets.rows.get('med_1')?.originalStorageKey).toBeNull();
		expect(jobs.jobs).toEqual([{ type: 'delete-objects', keys: ['media/med_1/original.jpg'], urls: [] }]);
	});

	it('is a no-op for a duplicate job', async () => {
		const assets = new FakeAssets([
			asset({ processing: { state: 'processing', attempts: 1, error: null, processedAt: null } }),
		]);
		const outcome = await processMediaAsset(
			{
				assets,
				roles,
				storage: storage().port,
				codec: codec({ width: 1, height: 1, format: 'jpeg', hasAlpha: false }),
				queue: queue().port,
				now,
			},
			{ assetId: 'med_1', reprocess: false },
		);
		expect(outcome).toEqual({ status: 'not_claimed' });
	});
});

describe('resolveImage', () => {
	it('groups derivatives by role and resolves alt per locale, override first', () => {
		const resolved = resolveImage({
			asset: asset({
				width: 3000,
				height: 4000,
				text: { alt: { en: 'Red saree', fr: 'Sari rouge' }, title: {}, caption: {} },
				derivatives: [
					{
						role: 'card',
						storageKey: 'k/400',
						width: 400,
						height: 533,
						byteSize: 1,
						format: 'image/webp',
						roleVersion: 1,
					},
					{
						role: 'card',
						storageKey: 'k/200',
						width: 200,
						height: 267,
						byteSize: 1,
						format: 'image/webp',
						roleVersion: 1,
					},
				],
			}),
			getUrl: (key) => `https://cdn.test/${key}`,
			locale: 'fr',
			fallbackLocale: 'en',
			altOverride: { en: 'Override' },
		});
		expect(resolved?.roles.card?.map((source) => source.width)).toEqual([200, 400]);
		expect(resolved?.alt).toBe('Sari rouge');
	});
	it('hides private review photos', () => {
		expect(
			resolveImage({
				asset: asset({ visibility: 'private', width: 1, height: 1 }),
				getUrl: (key) => key,
				locale: 'en',
				fallbackLocale: 'en',
			}),
		).toBeNull();
	});
});

describe('checkReviewPhotos', () => {
	const photo = (id: string, customer = 'cus_1') =>
		asset({
			id,
			purpose: 'review',
			uploadedBy: { type: 'customer', id: customer },
			processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
		});
	it('accepts up to five ready photos the customer uploaded', async () => {
		const assets = new FakeAssets([photo('a'), photo('b')]);
		expect((await checkReviewPhotos({ assets }, { customerId: 'cus_1', assetIds: ['a', 'b'] })).refusal).toBeNull();
	});
	it('refuses someone else’s photo and a sixth photo', async () => {
		const assets = new FakeAssets([photo('a', 'cus_2')]);
		expect((await checkReviewPhotos({ assets }, { customerId: 'cus_1', assetIds: ['a'] })).refusal).toBe(
			'not_owned',
		);
		expect(
			(await checkReviewPhotos({ assets }, { customerId: 'cus_1', assetIds: ['1', '2', '3', '4', '5', '6'] }))
				.refusal,
		).toBe('too_many');
	});
});

describe('runMediaGarbageCollection', () => {
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

	it('respects the recency guard, references, and grace — and audits', async () => {
		const assets = new FakeAssets([
			asset({ id: 'fresh', createdAt: '2026-11-01T12:00:00.000Z' }),
			asset({ id: 'used', createdAt: '2026-09-01T00:00:00.000Z' }),
			asset({ id: 'orphan', createdAt: '2026-09-01T00:00:00.000Z' }),
			asset({ id: 'expired', createdAt: '2026-08-01T00:00:00.000Z', deletedAt: '2026-09-15T00:00:00.000Z' }),
			asset({ id: 'revived', createdAt: '2026-08-01T00:00:00.000Z', deletedAt: '2026-09-15T00:00:00.000Z' }),
		]);
		assets.references.set('used', 1);
		assets.references.set('revived', 2);
		const jobs = queue();
		const log = audit();
		const report = await runMediaGarbageCollection(
			{ assets, storage: storage().port, queue: jobs.port, audit: log.port, now, newId: () => 'aud_1' },
			{ dryRun: false },
		);
		expect(report.softDeleted).toEqual(['orphan']);
		expect(report.restored).toEqual(['revived']);
		expect(report.hardDeleted).toEqual(['expired']);
		expect(assets.rows.has('expired')).toBe(false);
		expect(assets.rows.get('fresh')?.deletedAt).toBeNull();
		expect(log.entries[0]?.action).toBe('media.gc.run');
	});

	it('writes nothing in a dry run', async () => {
		const assets = new FakeAssets([asset({ id: 'orphan', createdAt: '2026-09-01T00:00:00.000Z' })]);
		const report = await runMediaGarbageCollection(
			{ assets, storage: storage().port, queue: queue().port, audit: audit().port, now, newId: () => 'aud_1' },
			{ dryRun: true },
		);
		expect(report.softDeleted).toEqual(['orphan']);
		expect(assets.rows.get('orphan')?.deletedAt).toBeNull();
	});
});
