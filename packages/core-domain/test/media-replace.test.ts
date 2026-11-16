import type { ImageDerivative, MediaAsset, MediaReplacement, MediaVersion } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	KEEP_REPLACED_DAYS,
	SEEDED_MEDIA_PROFILES,
	SEEDED_MEDIA_ROLES,
	checkReplace,
	derivativesFor,
	keptAfterReplace,
	olderVersions,
	originalStorageKey,
	replaceMediaAsset,
	replacementOriginalKey,
	storedKeys,
	sweepKeptFiles,
	type ImageCodecPort,
	type MediaAssetRepository,
	type MediaJob,
	type StoragePort,
} from '../src/index';

const profiles = new Map(SEEDED_MEDIA_PROFILES.map((profile) => [profile.key, profile]));
const NOW = new Date('2026-11-16T10:00:00.000Z');

const ready = (id: string): MediaVersion => {
	const [profileKey = '', fill = 'as_is'] = id.split('.');
	return {
		id,
		profileKey,
		profileVersion: 1,
		fill: fill as MediaVersion['fill'],
		state: 'ready',
		error: null,
		createdAt: '2026-11-10T00:00:00.000Z',
	};
};
const file = (versionId: string | null, role: string, width: number): ImageDerivative => ({
	role,
	storageKey: `media/med_r/${versionId ?? 'photo'}/${role}-${width}w-old.webp`,
	width,
	height: Math.round((width * 4) / 3),
	byteSize: 100,
	format: 'image/webp',
	roleVersion: 1,
	versionId,
});

/** A 3:4 product photo with one version, being replaced by a new 3:4 photo. */
const photo = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: 'med_r',
	kind: 'image',
	purpose: 'product',
	originalStorageKey: 'media/med_r/original.jpg',
	originalFormat: 'image/jpeg',
	originalByteSize: 1000,
	width: 3000,
	height: 4000,
	slug: 'red-banarasi',
	derivatives: [file('product_3x4.as_is', 'card', 400), file('product_3x4.as_is', 'thumb', 150)],
	versions: [ready('product_3x4.as_is')],
	dominantColor: '#111111',
	thumbHash: 'OLD',
	visibility: 'public',
	processing: { state: 'ready', attempts: 1, error: null, processedAt: '2026-11-10T00:00:00.000Z' },
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
	...overrides,
});
const queued = (overrides: Partial<MediaReplacement> = {}): MediaReplacement => ({
	key: 'media/med_r/original-20261116095900.jpg',
	contentType: 'image/jpeg',
	byteSize: 2000,
	width: 3000,
	height: 4000,
	sha256: null,
	phase: 'queued',
	reason: 'replace',
	made: 0,
	total: 0,
	error: null,
	startedAt: '2026-11-16T09:59:00.000Z',
	by: 'adm_1',
	...overrides,
});

/** In-memory stand-ins for the photo record, storage and the image library. */
const harness = (start: MediaAsset, probe = { width: 3000, height: 4000, format: 'jpeg', hasAlpha: false }) => {
	let row = start;
	const uploads: string[] = [];
	const jobs: MediaJob[] = [];
	const progress: { made?: number; total?: number }[] = [];
	const assets = {
		moveReplace: async (
			_id: string,
			from: readonly MediaReplacement['phase'][],
			change: Partial<MediaReplacement> | null,
		) => {
			if (!row.replacing || !from.includes(row.replacing.phase)) return null;
			if (change && ('made' in change || 'total' in change)) progress.push({ ...change });
			row = { ...row, replacing: change ? { ...row.replacing, ...change } : null };
			return row;
		},
		finishReplace: async (input: Parameters<MediaAssetRepository['finishReplace']>[0]) => {
			if (row.replacing?.phase !== 'making') return null;
			row = {
				...row,
				...input.set,
				derivatives: [...input.derivatives],
				versions: [...input.versions],
				keptFiles: [...input.keptFiles],
				replacing: null,
			};
			return row;
		},
	};
	const storage = {
		download: async () => new Uint8Array(2000),
		upload: async (input: { key: string }) => void uploads.push(input.key),
		getUrl: (key: string) => `https://cdn.example.test/${key}`,
	} as unknown as StoragePort;
	const codec: ImageCodecPort = {
		probe: async () => probe as never,
		render: async (_bytes, spec) => ({
			bytes: new Uint8Array(10),
			width: spec.width,
			height: spec.height ?? spec.width,
			sha256: `${spec.width}`.padEnd(8, 'a'),
		}),
		placeholder: async () => ({ thumbHash: 'NEW', dominantColor: '#aa3322' }),
	};
	const deps = {
		assets: assets as unknown as MediaAssetRepository,
		roles: {
			list: async () => [...SEEDED_MEDIA_ROLES],
			findByKey: async () => null,
			save: async (role: never) => role,
			insertMissing: async () => 0,
		},
		profiles: { list: async () => [...SEEDED_MEDIA_PROFILES] },
		storage,
		codec,
		queue: { enqueue: async (job: MediaJob) => void jobs.push(job) },
		now: () => NOW,
	};
	return { deps, uploads, jobs, progress, row: () => row };
};

describe('checking a Replace before anything moves (S7, C05)', () => {
	const same = { contentType: 'image/jpeg', byteSize: 2000, width: 3000, height: 4000 };

	it('a photo of the same shape, big enough, can replace it', () => {
		expect(checkReplace({ asset: photo(), profiles, photo: same })).toEqual({ refusal: null, versions: [] });
	});

	it('names every version that could not be remade the same way', () => {
		const check = checkReplace({ asset: photo(), profiles, photo: { ...same, width: 4000, height: 2000 } });
		expect(check).toEqual({
			refusal: 'versions_refused',
			versions: [{ versionId: 'product_3x4.as_is', refusal: 'fill_not_offered' }],
		});
		const small = checkReplace({ asset: photo(), profiles, photo: { ...same, width: 900, height: 1200 } });
		expect(small.versions).toEqual([{ versionId: 'product_3x4.as_is', refusal: 'below_minimum' }]);
	});

	it('one at a time, not while versions are being made, photos only, and only types the worker reads', () => {
		expect(checkReplace({ asset: photo({ replacing: queued() }), profiles, photo: same }).refusal).toBe(
			'replacing',
		);
		expect(
			checkReplace({ asset: photo({ replacing: queued({ phase: 'failed' }) }), profiles, photo: same }).refusal,
		).toBeNull();
		expect(
			checkReplace({
				asset: photo({ versions: [{ ...ready('product_3x4.as_is'), state: 'making' }] }),
				profiles,
				photo: same,
			}).refusal,
		).toBe('versions_making');
		expect(checkReplace({ asset: photo({ kind: 'file' }), profiles, photo: same }).refusal).toBe('not_a_photo');
		expect(checkReplace({ asset: photo({ versions: [] }), profiles, photo: same }).refusal).toBe('no_versions');
		expect(checkReplace({ asset: photo(), profiles, photo: { ...same, contentType: 'image/heic' } }).refusal).toBe(
			'photo_type_waits',
		);
		expect(checkReplace({ asset: photo(), profiles, photo: { ...same, width: 9000, height: 12000 } }).refusal).toBe(
			'too_many_pixels',
		);
	});
});

describe('the worker’s Replace (S7, C08)', () => {
	it('remakes every version from the new photo, counts the sizes, swaps in one write, and keeps the old files 7 days', async () => {
		const run = harness(photo({ replacing: queued() }));
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toMatchObject({ status: 'ready' });
		const row = run.row();
		expect(row.replacing).toBeNull();
		expect(row.originalStorageKey).toBe('media/med_r/original-20261116095900.jpg');
		expect(row.originalByteSize).toBe(2000);
		expect(row.thumbHash).toBe('NEW');
		expect(row.versions?.map((version) => `${version.id}:${version.state}`)).toEqual(['product_3x4.as_is:ready']);
		expect(row.derivatives.every((one) => one.storageKey.endsWith('aaaa.webp'))).toBe(true);
		expect(run.uploads.length).toBe(row.derivatives.length);
		// The sizes were counted for the popup, then each one as it was made.
		const total = run.progress.find((step) => step.total)?.total;
		expect(total).toBe(run.uploads.length);
		expect(run.progress.at(-1)?.made).toBe(total);
		expect(row.keptFiles).toEqual([
			{
				keys: [
					'media/med_r/product_3x4.as_is/card-400w-old.webp',
					'media/med_r/product_3x4.as_is/thumb-150w-old.webp',
					'media/med_r/original.jpg',
				],
				bytes: 200,
				deleteAfter: new Date(NOW.getTime() + KEEP_REPLACED_DAYS * 86_400_000).toISOString(),
				reason: 'replace',
			},
		]);
		expect(run.jobs).toEqual([]);
	});

	it('a new photo that can’t make a version stops the whole Replace; the old photo stays and the new files go', async () => {
		const run = harness(photo({ replacing: queued() }), {
			width: 4000,
			height: 2000,
			format: 'jpeg',
			hasAlpha: false,
		});
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toEqual({
			status: 'rejected',
			reason: 'product_3x4.as_is: fill_not_offered',
		});
		expect(run.row().replacing).toMatchObject({ phase: 'failed', error: 'product_3x4.as_is: fill_not_offered' });
		expect(run.row().originalStorageKey).toBe('media/med_r/original.jpg');
		expect(run.jobs[0]).toMatchObject({
			type: 'delete-objects',
			keys: ['media/med_r/original-20261116095900.jpg'],
		});
	});

	it('a file that isn’t really a picture, or of another type than said, is refused', async () => {
		const run = harness(photo({ replacing: queued({ contentType: 'image/png' }) }));
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toEqual({
			status: 'rejected',
			reason: 'content_does_not_match_declared_type',
		});
	});

	it('takes a WebP, GIF or AVIF replacement whose bytes are that type, and keeps its own ending (media step 5)', async () => {
		for (const [contentType, format] of [
			['image/webp', 'webp'],
			['image/gif', 'gif'],
			['image/avif', 'avif'],
		] as const) {
			const run = harness(photo({ replacing: queued({ contentType }) }), {
				width: 3000,
				height: 4000,
				format,
				hasAlpha: false,
			});
			const outcome = await replaceMediaAsset(run.deps, { assetId: 'med_r' });
			expect(outcome).not.toEqual({ status: 'rejected', reason: 'content_does_not_match_declared_type' });
		}
		expect(replacementOriginalKey('med_r', 'image/avif', NOW)).toBe('media/med_r/original-20261116100000.avif');
		expect(originalStorageKey('med_r', 'image/gif')).toBe('media/med_r/original.gif');
	});

	it('runs once: a Replace not queued is not taken again', async () => {
		const run = harness(photo({ replacing: queued({ phase: 'making' }) }));
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toEqual({ status: 'not_claimed' });
		expect(run.uploads).toEqual([]);
	});
});

describe('kept files (decision 11)', () => {
	it('keeps only what the new photo no longer uses', () => {
		const old = photo();
		const reused = old.derivatives[0] as ImageDerivative;
		expect(
			keptAfterReplace(old, { derivatives: [reused], originalStorageKey: 'media/med_r/original-2.jpg' }, NOW)
				?.keys,
		).toEqual(['media/med_r/product_3x4.as_is/thumb-150w-old.webp', 'media/med_r/original.jpg']);
		expect(
			keptAfterReplace(
				{ derivatives: [], originalStorageKey: 'media/med_r/original.jpg' },
				{ derivatives: [], originalStorageKey: 'media/med_r/original.jpg' },
				NOW,
			),
		).toBeNull();
	});

	it('the daily sweep deletes what is due (pictures cleared from the CDN, never the private original) and forgets it', async () => {
		const due = photo({
			// After the Replace, the photo shows a new original; the old one is among the kept files.
			originalStorageKey: 'media/med_r/original-20261109100000.jpg',
			keptFiles: [
				{
					keys: ['media/med_r/x/card-400w-old.webp', 'media/med_r/original.jpg'],
					bytes: 100,
					deleteAfter: '2026-11-16T09:00:00.000Z',
					reason: 'replace',
				},
				{
					keys: ['media/med_r/later.webp'],
					bytes: 1,
					deleteAfter: '2026-11-20T00:00:00.000Z',
					reason: 'replace',
				},
			],
		});
		const jobs: MediaJob[] = [];
		const dropped: string[] = [];
		const swept = await sweepKeptFiles(
			{
				assets: { listKeptDue: async () => [due], dropKept: async (id: string) => void dropped.push(id) },
				queue: { enqueue: async (job: MediaJob) => void jobs.push(job) },
				storage: { getUrl: (key: string) => `https://cdn.example.test/${key}` },
			},
			NOW,
		);
		expect(swept).toBe(1);
		expect(jobs).toEqual([
			{
				type: 'delete-objects',
				keys: ['media/med_r/x/card-400w-old.webp', 'media/med_r/original.jpg'],
				urls: ['https://cdn.example.test/media/med_r/x/card-400w-old.webp'],
			},
		]);
		expect(dropped).toEqual(['med_r']);
	});

	it('deleting a photo for good also deletes its kept files and a replacement on its way', () => {
		const asset = photo({
			keptFiles: [
				{ keys: ['media/med_r/kept.webp'], bytes: 1, deleteAfter: NOW.toISOString(), reason: 'replace' },
			],
			replacing: queued(),
		});
		expect(storedKeys(asset)).toEqual(
			expect.arrayContaining(['media/med_r/kept.webp', 'media/med_r/original-20261116095900.jpg']),
		);
		expect(replacementOriginalKey('med_r', 'image/png', NOW)).toBe('media/med_r/original-20261116100000.png');
	});
});

describe('a new focal point (S10, media step 3c)', () => {
	const cropVersion = { ...ready('product_3x4.crop'), fill: 'crop' as const };
	const focalPhoto = () =>
		photo({
			width: 4000,
			height: 2000,
			focal: { x: 0.2, y: 0.5 },
			versions: [ready('product_3x4.white'), cropVersion],
			derivatives: [
				file('product_3x4.white', 'card', 400),
				file('product_3x4.crop', 'card', 400),
				file(null, 'share', 1200),
			],
			replacing: queued({ key: 'media/med_r/original.jpg', reason: 'focal', width: 4000, height: 2000 }),
		});

	it('remakes only Crop versions around the point; other files and the original stay, old crop files are kept', async () => {
		const run = harness(focalPhoto(), { width: 4000, height: 2000, format: 'jpeg', hasAlpha: false });
		const specs: { focal?: unknown; fit: string }[] = [];
		const render = run.deps.codec.render;
		run.deps.codec.render = async (bytes, spec) => (specs.push(spec), render(bytes, spec));
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toMatchObject({ status: 'ready' });
		const row = run.row();
		expect(specs.length).toBeGreaterThan(0);
		expect(specs.every((spec) => spec.fit === 'cover' && JSON.stringify(spec.focal) === '{"x":0.2,"y":0.5}')).toBe(
			true,
		);
		expect(row.originalStorageKey).toBe('media/med_r/original.jpg');
		const keys = row.derivatives.map((one) => one.storageKey);
		expect(keys).toContain('media/med_r/product_3x4.white/card-400w-old.webp');
		expect(keys).toContain('media/med_r/photo/share-1200w-old.webp');
		expect(keys).not.toContain('media/med_r/product_3x4.crop/card-400w-old.webp');
		expect(row.keptFiles).toEqual([
			expect.objectContaining({ keys: ['media/med_r/product_3x4.crop/card-400w-old.webp'], reason: 'focal' }),
		]);
		expect(row.versions?.map((version) => `${version.id}:${version.state}`)).toEqual([
			'product_3x4.white:ready',
			'product_3x4.crop:ready',
		]);
	});

	it('a point moved and put back makes the same files again: they leave the kept list and the sweep never deletes them', async () => {
		const probe = { width: 4000, height: 2000, format: 'jpeg', hasAlpha: false };
		const first = harness(focalPhoto(), probe);
		await replaceMediaAsset(first.deps, { assetId: 'med_r' });
		const made = first.row().derivatives.filter((row) => row.versionId === 'product_3x4.crop');
		expect(made.length).toBeGreaterThan(0);
		// An earlier move kept these very files; putting the point back makes them again, at the same addresses.
		const earlier = {
			keys: [...made.map((row) => row.storageKey), 'media/med_r/product_3x4.crop/card-400w-b.webp'],
			bytes: 5000,
			deleteAfter: '2026-11-16T09:00:00.000Z',
			reason: 'focal' as const,
		};
		const again = harness({ ...focalPhoto(), keptFiles: [earlier] }, probe);
		await replaceMediaAsset(again.deps, { assetId: 'med_r' });
		const row = again.row();
		const madeBytes = made.reduce((sum, one) => sum + one.byteSize, 0);
		expect(row.keptFiles).toEqual([
			{ ...earlier, keys: ['media/med_r/product_3x4.crop/card-400w-b.webp'], bytes: 5000 - madeBytes },
			expect.objectContaining({ keys: ['media/med_r/product_3x4.crop/card-400w-old.webp'], reason: 'focal' }),
		]);
		// Even a kept list written before that, still naming live files, never deletes them.
		const jobs: MediaJob[] = [];
		await sweepKeptFiles(
			{
				assets: { listKeptDue: async () => [{ ...row, keptFiles: [earlier] }], dropKept: async () => {} },
				queue: { enqueue: async (job: MediaJob) => void jobs.push(job) },
				storage: { getUrl: (key: string) => `https://cdn.example.test/${key}` },
			},
			NOW,
		);
		expect(jobs.flatMap((job) => (job.type === 'delete-objects' ? job.keys : []))).toEqual([
			'media/med_r/product_3x4.crop/card-400w-b.webp',
		]);
	});

	it('a failure never deletes the original the photo still uses', async () => {
		const run = harness(focalPhoto(), { width: 4000, height: 2000, format: 'png', hasAlpha: false });
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toMatchObject({ status: 'rejected' });
		const deleted = run.jobs.flatMap((job) => (job.type === 'delete-objects' ? job.keys : []));
		expect(deleted).not.toContain('media/med_r/original.jpg');
		expect(run.row().originalStorageKey).toBe('media/med_r/original.jpg');
	});
});

describe('a new web file name (R5-6, media step 3d)', () => {
	const renaming = () =>
		photo({
			width: 4000,
			height: 2000,
			versions: [ready('product_3x4.white'), { ...ready('product_3x4.crop'), fill: 'crop' as const }],
			derivatives: [
				file('product_3x4.white', 'card', 400),
				file('product_3x4.crop', 'card', 400),
				file(null, 'share', 1200),
			],
			replacing: queued({
				key: 'media/med_r/original.jpg',
				reason: 'rename',
				slug: 'red-banarasi-silk-front',
				width: 4000,
				height: 2000,
			}),
		});
	const probe = { width: 4000, height: 2000, format: 'jpeg', hasAlpha: false };

	it('makes every file again under the new name from the same original, and swaps the name in with them', async () => {
		const run = harness(renaming(), probe);
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toMatchObject({ status: 'ready' });
		const row = run.row();
		expect(row.slug).toBe('red-banarasi-silk-front');
		expect(row.originalStorageKey).toBe('media/med_r/original.jpg');
		expect(row.derivatives.length).toBeGreaterThan(0);
		expect(row.derivatives.every((one) => one.storageKey.includes('/red-banarasi-silk-front-'))).toBe(true);
		expect(row.versions?.map((version) => `${version.id}:${version.state}`)).toEqual([
			'product_3x4.white:ready',
			'product_3x4.crop:ready',
		]);
		// The old files stay 7 days; the original is the photo's own, so it is not among them.
		expect(row.keptFiles).toEqual([
			expect.objectContaining({
				reason: 'rename',
				keys: [
					'media/med_r/product_3x4.white/card-400w-old.webp',
					'media/med_r/product_3x4.crop/card-400w-old.webp',
					'media/med_r/photo/share-1200w-old.webp',
				],
			}),
		]);
		expect(run.jobs.filter((job) => job.type === 'delete-objects')).toEqual([]);
	});

	it('a failure keeps the old name and never deletes the original', async () => {
		const run = harness(renaming(), { ...probe, format: 'png' });
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toMatchObject({ status: 'rejected' });
		const deleted = run.jobs.flatMap((job) => (job.type === 'delete-objects' ? job.keys : []));
		expect(deleted).not.toContain('media/med_r/original.jpg');
		expect(run.row().slug).toBe('red-banarasi');
		expect(run.row().replacing).toMatchObject({ phase: 'failed' });
	});
});

describe('bringing older versions up to date (F02, media step 3e)', () => {
	const older = () =>
		photo({
			width: 4000,
			height: 2000,
			versions: [ready('product_3x4.white'), ready('blog_cover_2x1.as_is')],
			derivatives: [
				file('product_3x4.white', 'card', 400),
				file('blog_cover_2x1.as_is', 'blog', 480),
				file(null, 'share', 1200),
			],
			replacing: queued({
				key: 'media/med_r/original.jpg',
				reason: 'refresh',
				profileKey: 'product_3x4',
				width: 4000,
				height: 2000,
			}),
		});
	const probe = { width: 4000, height: 2000, format: 'jpeg', hasAlpha: false };
	/** Product 3:4's settings were changed once since the photo's versions were made. */
	const changed = SEEDED_MEDIA_PROFILES.map((row) =>
		row.key === 'product_3x4' ? { ...row, version: row.version + 1 } : row,
	);

	it('remakes only that profile’s older versions with today’s settings; the rest of the photo stays', async () => {
		const run = harness(older(), probe);
		run.deps.profiles = { list: async () => changed };
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toMatchObject({ status: 'ready' });
		const row = run.row();
		const keys = row.derivatives.map((one) => one.storageKey);
		expect(keys).toContain('media/med_r/blog_cover_2x1.as_is/blog-480w-old.webp');
		expect(keys).toContain('media/med_r/photo/share-1200w-old.webp');
		expect(keys).not.toContain('media/med_r/product_3x4.white/card-400w-old.webp');
		expect(row.versions?.find((version) => version.id === 'product_3x4.white')?.profileVersion).toBe(
			(changed.find((one) => one.key === 'product_3x4')?.version ?? 0) as number,
		);
		expect(row.versions?.find((version) => version.id === 'blog_cover_2x1.as_is')?.profileVersion).toBe(1);
		expect(row.originalStorageKey).toBe('media/med_r/original.jpg');
		expect(row.keptFiles).toEqual([
			expect.objectContaining({ reason: 'refresh', keys: ['media/med_r/product_3x4.white/card-400w-old.webp'] }),
		]);
	});

	it('with nothing older left, the run just ends and nothing changes', async () => {
		const run = harness(older(), probe);
		await expect(replaceMediaAsset(run.deps, { assetId: 'med_r' })).resolves.toMatchObject({
			status: 'ready',
			rendered: 0,
		});
		expect(run.row().replacing).toBeNull();
		expect(run.row().derivatives).toEqual(older().derivatives);
		expect(run.uploads).toEqual([]);
	});

	it('olderVersions lists only ready versions of that profile, made before its settings changed, that can be made again', () => {
		const profile = changed.find((one) => one.key === 'product_3x4');
		if (!profile) throw new Error('product_3x4 missing');
		expect(olderVersions(older(), profile).map((version) => version.id)).toEqual(['product_3x4.white']);
		expect(olderVersions(older(), { ...profile, version: 1 })).toEqual([]);
		expect(olderVersions(older(), { ...profile, fills: ['blur'] })).toEqual([]);
	});
});

describe('a place that stores its version (R4-1, media step 4b)', () => {
	const two = () =>
		photo({
			width: 4000,
			height: 2000,
			versions: [ready('product_3x4.white'), ready('product_3x4.blur')],
			derivatives: [
				file('product_3x4.white', 'card', 400),
				file('product_3x4.blur', 'card', 400),
				file(null, 'share', 1200),
			],
		});

	it('draws that version’s files and the pictures made once per photo; without one, the website’s own pick', () => {
		const keys = (versionId?: string | null) => derivativesFor(two(), versionId).map((row) => row.storageKey);
		expect(keys('product_3x4.blur')).toEqual([
			'media/med_r/product_3x4.blur/card-400w-old.webp',
			'media/med_r/photo/share-1200w-old.webp',
		]);
		expect(keys(null)).toEqual([
			'media/med_r/product_3x4.white/card-400w-old.webp',
			'media/med_r/photo/share-1200w-old.webp',
		]);
		// A version that is gone or not ready falls back, so the place still shows the photo.
		expect(keys('product_3x4.crop')).toEqual(keys(null));
	});
});
