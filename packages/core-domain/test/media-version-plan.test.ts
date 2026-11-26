import type { MediaAsset, MediaProfile, MediaRoleDefinition, MediaVersion } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { cropKeeps } from '../src/catalog/media-files';

import {
	SEEDED_MEDIA_PROFILES,
	SEEDED_MEDIA_ROLES,
	checkCaps,
	checkProfileMinSize,
	checkVersionRequest,
	estimateVersionBytes,
	fillsForPhoto,
	planVersion,
	processMediaAsset,
	purposeForProfile,
	servesProfile,
	versionStorageKey,
	type ImageCodecPort,
	type MediaAssetRepository,
	type MediaJob,
	type StoragePort,
	planAddVersions,
} from '../src/index';

/** Media build step 2b: versions planned by profile and fill, and the worker making them write-once. */
const profile = (key: string): MediaProfile => {
	const found = SEEDED_MEDIA_PROFILES.find((row) => row.key === key);
	if (!found) throw new Error(key);
	return found;
};
const roles = SEEDED_MEDIA_ROLES as MediaRoleDefinition[];
const spec = (plan: ReturnType<typeof planVersion>, role: string, width: number) =>
	plan.files.find((file) => file.role === role && file.spec.width === width)?.spec;

describe('planVersion: each fill fits the photo to the profile’s shape', () => {
	const square = { width: 3000, height: 3000 };

	it('cuts a product photo’s swatch squares around its focus point only in its Crop version', () => {
		const portrait = { width: 1800, height: 2400 };
		const focal = { x: 0.5, y: 0.82 };
		const plan = (fill: 'as_is' | 'crop' | 'blur') =>
			planVersion({
				profile: profile('product_3x4'),
				fill,
				roles,
				source: portrait,
				maxDisplayWidth: null,
				focal,
			});
		// The Crop version: every square swatch keeps the part around the point (the fabric low on a model photo).
		expect(spec(plan('crop'), 'swatch_image', 240)).toMatchObject({ width: 240, height: 240, fit: 'cover', focal });
		expect(spec(plan('crop'), 'swatch_image_v2', 240)).toMatchObject({ fit: 'cover', focal });
		// "As is" and the other fills cut their squares from the middle: the point does not move them.
		expect(spec(plan('as_is'), 'swatch_image', 240)).not.toHaveProperty('focal');
		expect(spec(plan('blur'), 'swatch_image', 240)).not.toHaveProperty('focal');
		// A gallery photo that keeps its shape never uses the point.
		expect(spec(plan('as_is'), 'gallery', 1200)).not.toHaveProperty('focal');
	});

	it('white padding, blurred fill and crop make 3:4 boxes; swatches keep their own square crop', () => {
		const white = planVersion({
			profile: profile('product_3x4'),
			fill: 'white',
			roles,
			source: square,
			maxDisplayWidth: null,
		});
		expect(spec(white, 'gallery', 1600)).toMatchObject({ width: 1600, height: 2133, fit: 'pad' });
		expect(spec(white, 'swatch_image', 240)).toMatchObject({ width: 240, height: 240, fit: 'cover' });
		const blur = planVersion({
			profile: profile('product_3x4'),
			fill: 'blur',
			roles,
			source: square,
			maxDisplayWidth: null,
		});
		expect(spec(blur, 'card', 400)).toMatchObject({ height: 533, fit: 'blur' });
		const crop = planVersion({
			profile: profile('product_3x4'),
			fill: 'crop',
			roles,
			source: square,
			maxDisplayWidth: null,
		});
		expect(spec(crop, 'zoom', 2000)).toMatchObject({ height: 2667, fit: 'cover' });
		expect(white.files.every((file) => file.versionId === 'product_3x4.white')).toBe(true);
	});

	it('“As is” keeps the photo whole at its own shape', () => {
		const plan = planVersion({
			profile: profile('product_3x4'),
			fill: 'as_is',
			roles,
			source: { width: 3000, height: 4000 },
			maxDisplayWidth: null,
		});
		expect(spec(plan, 'gallery', 1600)).toMatchObject({ height: null, fit: 'inside' });
	});

	it('colour bars use the photo’s own colour, the Brand colour fill the Brand Kit colour', () => {
		const colours = { dominant: '#aa3322', brand: '#417394' };
		const bars = planVersion({
			profile: profile('hero_21x9'),
			fill: 'colour',
			roles,
			source: { width: 4000, height: 3000 },
			maxDisplayWidth: null,
			colours,
		});
		expect(spec(bars, 'banner', 1920)).toMatchObject({ height: 823, fit: 'pad', background: '#aa3322' });
		const icon = planVersion({
			profile: profile('browser_icon_1x1'),
			fill: 'brand',
			roles,
			source: { width: 1200, height: 400 },
			maxDisplayWidth: null,
			colours,
		});
		expect(spec(icon, 'brand_icon', 192)).toMatchObject({
			width: 192,
			height: 192,
			fit: 'pad',
			background: '#417394',
		});
		expect(spec(icon, 'brand_icon', 192)?.keepAlpha).toBeUndefined();
	});

	it('a keep-shape logo keeps its see-through background; a banner keeps its own shape', () => {
		const logo = planVersion({
			profile: profile('logo_keep_shape'),
			fill: 'as_is',
			roles,
			source: { width: 1200, height: 400 },
			maxDisplayWidth: null,
		});
		expect(spec(logo, 'brand_logo', 960)).toMatchObject({ fit: 'inside', keepAlpha: true });
		const strip = planVersion({
			profile: profile('banner_keep_shape'),
			fill: 'as_is',
			roles,
			source: { width: 2721, height: 805 },
			maxDisplayWidth: null,
		});
		expect(spec(strip, 'banner', 1920)).toMatchObject({ fit: 'inside', height: null });
	});

	it('never enlarges, and skips banner widths beyond twice the slot', () => {
		const small = planVersion({
			profile: profile('hero_21x9'),
			fill: 'crop',
			roles,
			source: { width: 1600, height: 900 },
			maxDisplayWidth: null,
		});
		expect(small.files.map((file) => file.spec.width)).toEqual([480, 768, 1080, 1440]);
		expect(small.skipped.map((row) => row.width)).toEqual([1920, 2560, 2880]);
		const slot = planVersion({
			profile: profile('banner_keep_shape'),
			fill: 'as_is',
			roles,
			source: { width: 4000, height: 1000 },
			maxDisplayWidth: 694,
		});
		expect(Math.max(...slot.files.map((file) => file.spec.width))).toBe(1080);
	});
});

describe('the checks before a version is made', () => {
	it('offers “As is” alone to a photo that already has the shape, and the profile’s fills otherwise', () => {
		expect(fillsForPhoto(profile('product_3x4'), { width: 3000, height: 4000 })).toEqual(['as_is']);
		expect(fillsForPhoto(profile('product_3x4'), { width: 3000, height: 3000 })).toEqual(['white', 'blur', 'crop']);
		expect(fillsForPhoto(profile('banner_keep_shape'), { width: 2721, height: 805 })).toEqual(['as_is']);
	});

	it('refuses an unknown, switched-off or made-by-itself profile, a fill not offered, too small, too big, wrong type', () => {
		const base = {
			fill: 'as_is' as const,
			source: { width: 3000, height: 4000 },
			byteSize: 1000,
			contentType: 'image/jpeg',
		};
		expect(checkVersionRequest({ ...base, profile: null })).toBe('profile_unknown');
		expect(checkVersionRequest({ ...base, profile: { ...profile('product_3x4'), enabled: false } })).toBe(
			'profile_off',
		);
		expect(checkVersionRequest({ ...base, profile: profile('link_preview') })).toBe('profile_not_chosen');
		expect(checkVersionRequest({ ...base, profile: profile('product_3x4'), fill: 'blur' })).toBe(
			'fill_not_offered',
		);
		expect(
			checkVersionRequest({ ...base, profile: profile('product_3x4'), source: { width: 900, height: 1200 } }),
		).toBe('below_minimum');
		expect(checkVersionRequest({ ...base, profile: profile('product_3x4'), byteSize: 26 * 1024 * 1024 })).toBe(
			'too_large',
		);
		// HEIC is turned into a JPEG in the browser, so no profile takes it; the worker's own types are all taken.
		expect(checkVersionRequest({ ...base, profile: profile('product_3x4'), contentType: 'image/heic' })).toBe(
			'type_not_accepted',
		);
		for (const contentType of ['image/webp', 'image/avif', 'image/tiff', 'image/vnd.adobe.photoshop']) {
			expect(checkVersionRequest({ ...base, profile: profile('product_3x4'), contentType })).toBeNull();
		}
		expect(checkVersionRequest({ ...base, profile: profile('product_3x4') })).toBeNull();
	});

	it('reads the smallest-photo rule on the short side or the width, warn or refuse', () => {
		expect(checkProfileMinSize(profile('hero_21x9'), { width: 1920, height: 823 })).toEqual({
			result: 'warn',
			edge: 'width',
			px: 2560,
			has: 1920,
		});
		expect(checkProfileMinSize(profile('banner_keep_shape'), { width: 10, height: 10 })).toEqual({ result: 'ok' });
	});

	it('lets a 48 MP iPhone photo through (8192 px, decision 8) and still stops past it', () => {
		const iphone = { contentType: 'image/jpeg', byteSize: 20 * 1024 * 1024, width: 8064, height: 6048 };
		expect(checkCaps(iphone)).toBeNull();
		expect(checkCaps({ ...iphone, width: 8200, height: 4000 })).toMatchObject({
			code: 'too_many_pixels',
			maxLongEdge: 8192,
		});
		expect(checkCaps({ ...iphone, width: 8000, height: 7000 })).toMatchObject({ code: 'too_many_pixels' });
	});

	it('a place accepts a photo holding a ready version of its profile, whatever it was uploaded for (step 4d)', () => {
		const version = (profileKey: string, state = 'ready') => ({ profileKey, state });
		// A product photo given a Blog cover version later is a blog picture now.
		expect(servesProfile({ purpose: 'product', versions: [version('blog_cover_2x1')] }, ['blog_cover_2x1'])).toBe(
			true,
		);
		// A version still being made doesn't count yet; nor does another profile.
		expect(
			servesProfile({ purpose: 'blog', versions: [version('blog_cover_2x1', 'making')] }, ['blog_cover_2x1']),
		).toBe(false);
		expect(servesProfile({ purpose: 'product', versions: [version('product_3x4')] }, ['banner_keep_shape'])).toBe(
			false,
		);
		// A photo not yet named into versions is judged by what it was uploaded for.
		expect(servesProfile({ purpose: 'brand', versions: [] }, ['logo_keep_shape', 'browser_icon_1x1'])).toBe(true);
		expect(servesProfile({ purpose: 'product' }, ['logo_keep_shape'])).toBe(false);
	});

	it('keeps the older screens’ purpose, files under the version’s folder, and estimates storage', () => {
		expect(
			['product_3x4', 'hero_21x9', 'banner_keep_shape', 'logo_keep_shape', 'square_1x1'].map(purposeForProfile),
		).toEqual(['product', 'banner', 'banner', 'brand', 'icon']);
		expect(
			versionStorageKey({
				assetId: 'med_7Hk2',
				versionId: 'hero_21x9.crop',
				slug: 'banarasi-weave-closeup',
				role: 'banner',
				width: 1920,
				sha256: '1f3a9c2e00',
				format: 'image/webp',
			}),
		).toBe('media/med_7Hk2/hero-21x9-crop/banarasi-weave-closeup-banner-1920w-1f3a9c2e.webp');
		expect(estimateVersionBytes(10_000_000, 2)).toBe(7_000_000);
	});
});

// --- the worker -----------------------------------------------------------------------------------

const asking = (id: string, state: MediaVersion['state'] = 'making'): MediaVersion => {
	const [profileKey, fill] = id.split('.') as [string, MediaVersion['fill']];
	return {
		id: id as MediaVersion['id'],
		profileKey,
		profileVersion: 1,
		fill,
		state,
		createdAt: '2026-11-16T00:00:00.000Z',
	};
};

const photo = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: 'med_1',
	kind: 'image',
	purpose: 'product',
	originalStorageKey: 'media/med_1/original.jpg',
	originalFormat: 'image/jpeg',
	originalByteSize: 1000,
	width: null,
	height: null,
	slug: 'red-banarasi',
	derivatives: [],
	versions: [asking('product_3x4.white')],
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
	text: { alt: {}, title: {}, caption: {} },
	status: 'draft',
	uploadedBy: null,
	deletedAt: null,
	...overrides,
});

const harness = (start: MediaAsset, options: { failOn?: (width: number) => boolean; duringRun?: () => void } = {}) => {
	let row = start;
	const uploads: string[] = [];
	const jobs: MediaJob[] = [];
	const assets = {
		claimForProcessing: async (_id: string, claim?: { allowReady?: boolean }) => {
			const allowed = ['queued', 'failed', ...(claim?.allowReady ? ['ready'] : [])];
			if (!allowed.includes(row.processing.state)) return null;
			row = { ...row, processing: { ...row.processing, state: 'processing' } };
			return row;
		},
		settleVersions: async (input: Parameters<MediaAssetRepository['settleVersions']>[0]) => {
			options.duringRun?.();
			const byId = new Map(input.versions.map((version) => [version.id, version]));
			row = {
				...row,
				...input.set,
				derivatives: [...row.derivatives, ...input.addDerivatives],
				versions: row.versions?.map((version) => byId.get(version.id) ?? version),
			};
			return row;
		},
		update: async (next: MediaAsset) => (row = next),
		ask: (version: MediaVersion) => {
			row = { ...row, versions: [...(row.versions ?? []), version] };
		},
	};
	const storage = {
		download: async () => new Uint8Array(5),
		upload: async (input: { key: string }) => void uploads.push(input.key),
		getUrl: (key: string) => `https://cdn.example.test/${key}`,
	} as unknown as StoragePort;
	const codec: ImageCodecPort = {
		probe: async () => ({ width: 3000, height: 3000, format: 'jpeg', hasAlpha: false }),
		render: async (_bytes, renderSpec) => {
			if (options.failOn?.(renderSpec.width)) throw new Error('out of memory');
			return {
				bytes: new Uint8Array(10),
				width: renderSpec.width,
				height: renderSpec.height ?? renderSpec.width,
				sha256: `${renderSpec.width}`.padEnd(8, 'f'),
			};
		},
		placeholder: async () => ({ thumbHash: 'AAAA', dominantColor: '#aa3322' }),
	};
	const deps = {
		assets: assets as unknown as MediaAssetRepository,
		roles: {
			list: async () => roles,
			findByKey: async () => null,
			save: async (r: MediaRoleDefinition) => r,
			insertMissing: async () => 0,
		},
		profiles: {
			list: async () =>
				SEEDED_MEDIA_PROFILES.map((row) => (row.key === 'product_3x4' ? { ...row, version: 2 } : row)),
		},
		storage,
		codec,
		queue: { enqueue: async (job: MediaJob) => void jobs.push(job) },
		now: () => new Date('2026-11-16T10:00:00.000Z'),
	};
	return { deps, uploads, jobs, assets, row: () => row };
};

describe('processMediaAsset with versions asked for', () => {
	it('makes the asked version under its folder, records the profile settings, and leaves no stray job', async () => {
		const run = harness(photo());
		await expect(processMediaAsset(run.deps, { assetId: 'med_1', reprocess: false })).resolves.toMatchObject({
			status: 'ready',
		});
		expect(run.row().versions).toEqual([
			{ ...asking('product_3x4.white'), state: 'ready', error: null, profileVersion: 2 },
		]);
		expect(run.uploads.every((key) => key.startsWith('media/med_1/product-3x4-white/'))).toBe(true);
		expect(run.row().processing.state).toBe('ready');
		expect(run.jobs).toEqual([]);
	});

	it('never touches a version already made, and adds only missing per-photo pictures', async () => {
		const made = {
			role: 'card',
			storageKey: 'media/med_1/old-card.webp',
			width: 400,
			height: 533,
			byteSize: 9,
			format: 'image/webp' as const,
			roleVersion: 1,
			versionId: 'product_3x4.white' as MediaVersion['id'],
		};
		const share = {
			...made,
			role: 'share',
			storageKey: 'media/med_1/share.jpg',
			width: 1200,
			height: 630,
			format: 'image/jpeg' as const,
			versionId: null,
		};
		const run = harness(
			photo({
				servesAsPrimary: true,
				processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
				versions: [asking('product_3x4.white', 'ready'), asking('product_3x4.crop')],
				derivatives: [made, share],
			}),
		);
		await processMediaAsset(run.deps, { assetId: 'med_1', reprocess: true });
		expect(run.uploads.some((key) => key.includes('product-3x4-white'))).toBe(false);
		expect(run.uploads.some((key) => key.includes('-share-'))).toBe(false);
		expect(run.uploads.some((key) => key.includes('-story-'))).toBe(true);
		expect(run.row().derivatives.slice(0, 2)).toEqual([made, share]);
		expect(run.row().versions?.map((version) => version.state)).toEqual(['ready', 'ready']);
	});

	it('fails one version on its own, removes its half-made files, and still makes the others', async () => {
		const run = harness(photo({ versions: [asking('product_3x4.white'), asking('product_3x4.crop')] }), {
			failOn: (width) => width === 1600,
		});
		await processMediaAsset(run.deps, { assetId: 'med_1', reprocess: false });
		// Both fail at 1600 px here, after some files of each were written.
		expect(run.row().versions?.map((version) => [version.id, version.state, version.error])).toEqual([
			['product_3x4.white', 'failed', 'render_failed'],
			['product_3x4.crop', 'failed', 'render_failed'],
		]);
		const cleanups = run.jobs.filter((job) => job.type === 'delete-objects');
		expect(cleanups).toHaveLength(2);
		expect(run.row().derivatives.filter((file) => file.versionId)).toEqual([]);
		expect(run.row().processing.state).toBe('ready');
	});

	it('refuses a version the photo cannot have, without stopping the rest', async () => {
		const run = harness(photo({ versions: [asking('product_3x4.as_is'), asking('square_1x1.crop')] }));
		await processMediaAsset(run.deps, { assetId: 'med_1', reprocess: false });
		expect(run.row().versions?.map((version) => [version.id, version.state, version.error ?? null])).toEqual([
			['product_3x4.as_is', 'failed', 'fill_not_offered'],
			['square_1x1.crop', 'failed', 'fill_not_offered'],
		]);
	});

	it('queues one more run when a version was asked for while this one ran', async () => {
		const late = asking('product_3x4.blur');
		let asked = false;
		const run = harness(photo(), {
			duringRun: () => {
				if (!asked) run.assets.ask(late);
				asked = true;
			},
		});
		await processMediaAsset(run.deps, { assetId: 'med_1', reprocess: false });
		expect(run.row().versions?.map((version) => [version.id, version.state])).toEqual([
			['product_3x4.white', 'ready'],
			['product_3x4.blur', 'making'],
		]);
		expect(run.jobs).toEqual([{ type: 'reprocess', assetId: 'med_1', reason: 'versions' }]);
	});

	it('refuses the whole upload past the caps, and fails versions when the original is gone', async () => {
		const run = harness(photo());
		run.deps.codec.probe = async () => ({ width: 9000, height: 3000, format: 'jpeg', hasAlpha: false });
		await expect(processMediaAsset(run.deps, { assetId: 'med_1', reprocess: false })).resolves.toEqual({
			status: 'rejected',
			reason: 'too_many_pixels',
		});
		const gone = harness(photo({ originalStorageKey: null }));
		await processMediaAsset(gone.deps, { assetId: 'med_1', reprocess: false });
		expect(gone.row().versions?.[0]).toMatchObject({ state: 'failed', error: 'original_gone' });
	});
});

describe('Reprocess: which versions a photo gets (media step 3a)', () => {
	const profiles = new Map(SEEDED_MEDIA_PROFILES.map((profile) => [profile.key, profile]));
	const weave = {
		kind: 'image' as const,
		width: 4800,
		height: 2400,
		originalByteSize: 1_000_000,
		originalFormat: 'image/png' as const,
		originalStorageKey: 'media/med_w/original.png',
		versions: [
			{
				id: 'blog_cover_2x1.as_is',
				profileKey: 'blog_cover_2x1',
				profileVersion: 1,
				fill: 'as_is' as const,
				state: 'ready' as const,
				error: null,
				createdAt: '2026-11-16T00:00:00.000Z',
			},
			{
				id: 'product_3x4.white',
				profileKey: 'product_3x4',
				profileVersion: 1,
				fill: 'white' as const,
				state: 'failed' as const,
				error: 'render_failed',
				createdAt: '2026-11-16T00:00:00.000Z',
			},
		],
	};
	const at = '2026-11-16T12:00:00.000Z';

	it('adds new versions, retries a failed one, skips one already made and names each refusal', () => {
		const plan = planAddVersions({
			asset: weave,
			asked: [
				{ profileKey: 'product_3x4', fill: 'crop' },
				{ profileKey: 'product_3x4', fill: 'white' },
				{ profileKey: 'blog_cover_2x1', fill: 'as_is' },
				{ profileKey: 'product_3x4', fill: 'as_is' },
				{ profileKey: 'link_preview', fill: 'blur' },
				{ profileKey: 'nope', fill: 'white' },
				{ profileKey: 'product_3x4', fill: 'crop' },
			],
			profiles,
			at,
		});
		expect(plan.add.map((version) => `${version.id}:${version.state}`)).toEqual(['product_3x4.crop:making']);
		expect(plan.retry.map((version) => version.id)).toEqual(['product_3x4.white']);
		expect(plan.skipped).toEqual([
			{ versionId: 'blog_cover_2x1.as_is', reason: 'already_made' },
			{ versionId: 'product_3x4.as_is', reason: 'fill_not_offered' },
			{ versionId: 'link_preview.blur', reason: 'profile_not_chosen' },
			{ versionId: 'nope.white', reason: 'profile_unknown' },
		]);
	});

	it('for many photos, a fill becomes “As is” where the photo already fits; a file without an original is no photo', () => {
		const square = { ...weave, width: 2000, height: 2000, versions: [] };
		const plan = planAddVersions({
			asset: square,
			asked: [{ profileKey: 'square_1x1', fill: 'crop' }],
			profiles,
			fitAsIs: true,
			at,
		});
		expect(plan.add.map((version) => version.id)).toEqual(['square_1x1.as_is']);
		const file = planAddVersions({
			asset: { ...square, kind: 'file' as never, originalStorageKey: null },
			asked: [{ profileKey: 'square_1x1', fill: 'crop' }],
			profiles,
			at,
		});
		expect(file.skipped).toEqual([{ versionId: 'square_1x1.crop', reason: 'not_a_photo' }]);
	});

	it('a crop keeps the middle share of the photo, and estimates count every new version', () => {
		// The brief's example: a 2:1 photo cropped to 3:4 keeps the middle 38% of its width (C01).
		expect(cropKeeps({ width: 4800, height: 2400 }, { width: 3, height: 4 })).toEqual({
			side: 'width',
			share: 0.375,
		});
		expect(cropKeeps({ width: 3000, height: 4000 }, { width: 21, height: 9 }).side).toBe('height');
		expect(cropKeeps({ width: 2000, height: 1000 }, { width: 2, height: 1 }).share).toBe(1);
		expect(estimateVersionBytes(1_000_000, 3)).toBe(1_050_000);
	});
});
