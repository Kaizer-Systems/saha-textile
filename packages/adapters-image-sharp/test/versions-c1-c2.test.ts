import type { MediaAsset, MediaVersion } from '@saha-textile/contracts';
import {
	type MediaAssetRepository,
	type MediaJob,
	type StoragePort,
	SEEDED_MEDIA_PROFILES,
	SEEDED_MEDIA_ROLES,
	processMediaAsset,
} from '@saha-textile/core-domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpImageCodec } from '../src/index.js';

/**
 * Media build step 2b on the real image library: versions made by profile and fill from real photos, and the
 * brief's two checks — C1, public sizes carry no location or camera details; C2, a sideways phone photo comes out
 * upright.
 */
const codec = new SharpImageCodec();

const photo = async (
	width: number,
	height: number,
	extra: { orientation?: number; exif?: boolean; alpha?: boolean } = {},
): Promise<Uint8Array> => {
	let image = sharp({
		create: {
			width,
			height,
			channels: extra.alpha ? 4 : 3,
			background: extra.alpha ? { r: 200, g: 30, b: 40, alpha: 0 } : { r: 200, g: 30, b: 40 },
		},
	});
	image = extra.alpha ? image.png() : image.jpeg({ quality: 90 });
	if (extra.orientation) image = image.withMetadata({ orientation: extra.orientation });
	if (extra.exif) {
		image = image.withExif({
			IFD0: { Make: 'Apple', Model: 'iPhone 17 Pro Max', Artist: 'A shopper' },
			IFD3: {
				GPSLatitudeRef: 'N',
				GPSLatitude: '22/1 34/1 0/1',
				GPSLongitudeRef: 'E',
				GPSLongitude: '88/1 22/1 0/1',
			},
		});
	}
	return new Uint8Array(await image.toBuffer());
};

const asking = (...ids: string[]): MediaVersion[] =>
	ids.map((id) => {
		const [profileKey, fill] = id.split('.') as [string, MediaVersion['fill']];
		return {
			id: id as MediaVersion['id'],
			profileKey,
			profileVersion: 1,
			fill,
			state: 'making',
			createdAt: '2026-11-16T00:00:00.000Z',
		};
	});

const run = async (original: Uint8Array, versions: MediaVersion[], contentType = 'image/jpeg') => {
	let row: MediaAsset = {
		id: 'med_1',
		kind: 'image',
		purpose: 'product',
		originalStorageKey: 'media/med_1/original.jpg',
		originalFormat: contentType as MediaAsset['originalFormat'],
		originalByteSize: original.byteLength,
		width: null,
		height: null,
		slug: 'red-banarasi',
		derivatives: [],
		versions,
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
	};
	const files = new Map<string, Uint8Array>();
	const jobs: MediaJob[] = [];
	const assets = {
		claimForProcessing: async () => (row = { ...row, processing: { ...row.processing, state: 'processing' } }),
		settleVersions: async (input: Parameters<MediaAssetRepository['settleVersions']>[0]) => {
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
	} as unknown as MediaAssetRepository;
	const storage = {
		download: async () => original,
		upload: async (input: { key: string; body: Uint8Array }) => {
			files.set(input.key, input.body);
		},
		getUrl: (key: string) => `https://cdn.example.test/${key}`,
	} as unknown as StoragePort;
	await processMediaAsset(
		{
			assets,
			roles: {
				list: async () => [...SEEDED_MEDIA_ROLES],
				findByKey: async () => null,
				save: async (r) => r,
				insertMissing: async () => 0,
			},
			profiles: { list: async () => [...SEEDED_MEDIA_PROFILES] },
			storage,
			codec,
			queue: { enqueue: async (job) => void jobs.push(job) },
			now: () => new Date('2026-11-16T00:00:00.000Z'),
			brandColour: async () => '#417394',
		},
		{ assetId: 'med_1', reprocess: false },
	);
	return { row, files, jobs };
};

describe('versions made from real photos (media step 2b)', () => {
	it('C1: no file the website shows carries location or camera details', async () => {
		const original = await photo(1800, 2400, { exif: true });
		expect((await sharp(original).metadata()).exif).toBeDefined();
		const { files, row } = await run(original, asking('product_3x4.as_is'));
		expect(row.versions?.[0]?.state).toBe('ready');
		expect(files.size).toBeGreaterThan(5);
		for (const [key, bytes] of files) {
			const meta = await sharp(bytes).metadata();
			expect(meta.exif, key).toBeUndefined();
			expect(meta.xmp, key).toBeUndefined();
			expect(meta.iptc, key).toBeUndefined();
		}
	});

	it('C2: a sideways phone photo comes out upright in every file', async () => {
		// Stored 2400 wide × 1800 tall with “turn 90°”: the photo itself is upright 3:4.
		const original = await photo(2400, 1800, { orientation: 6 });
		const { files, row } = await run(original, asking('product_3x4.as_is'));
		expect([row.width, row.height]).toEqual([1800, 2400]);
		for (const [key, bytes] of files) {
			const meta = await sharp(bytes).metadata();
			if (!key.includes('swatch')) expect((meta.height ?? 0) > (meta.width ?? 0), key).toBe(true);
			expect(meta.orientation ?? 1, key).toBe(1);
		}
	});

	it('makes two fills side by side under their own folders, at the profile’s shape', async () => {
		const square = await photo(2400, 2400);
		const { files, row } = await run(square, asking('product_3x4.white', 'product_3x4.crop'));
		expect(row.versions?.map((version) => [version.id, version.state])).toEqual([
			['product_3x4.white', 'ready'],
			['product_3x4.crop', 'ready'],
		]);
		const keys = [...files.keys()];
		expect(keys.some((key) => key.startsWith('media/med_1/product-3x4-white/red-banarasi-gallery-1600w-'))).toBe(
			true,
		);
		expect(keys.some((key) => key.startsWith('media/med_1/product-3x4-crop/red-banarasi-gallery-1600w-'))).toBe(
			true,
		);
		const gallery = row.derivatives.filter((file) => file.role === 'gallery' && file.width === 1600);
		expect(gallery.map((file) => [file.versionId, file.width, file.height])).toEqual([
			['product_3x4.white', 1600, 2133],
			['product_3x4.crop', 1600, 2133],
		]);
		// White padding keeps the whole square photo with white above and below; a crop fills the box.
		const white = files.get(gallery[0]?.storageKey as string) as Uint8Array;
		const top = await sharp(white).extract({ left: 800, top: 5, width: 1, height: 1 }).raw().toBuffer();
		expect([...top]).toEqual([255, 255, 255]);
		const crop = files.get(gallery[1]?.storageKey as string) as Uint8Array;
		const cropTop = await sharp(crop).extract({ left: 800, top: 5, width: 1, height: 1 }).raw().toBuffer();
		expect(cropTop[0]).toBeGreaterThan(150);
		expect(cropTop[1]).toBeLessThan(80);
	});

	it('puts a see-through icon on the Brand Kit colour for the Brand colour fill', async () => {
		const logo = await photo(1200, 400, { alpha: true });
		const { files, row } = await run(logo, asking('browser_icon_1x1.brand'), 'image/png');
		expect(row.versions?.[0]?.state).toBe('ready');
		const icon = [...files.entries()].find(
			([key]) => key.includes('browser-icon-1x1-brand/') && key.includes('-192w-'),
		);
		expect(icon).toBeDefined();
		const pixel = await sharp(icon?.[1])
			.extract({ left: 2, top: 2, width: 1, height: 1 })
			.removeAlpha()
			.raw()
			.toBuffer();
		expect([...pixel]).toEqual([0x41, 0x73, 0x94]);
	});

	it('never enlarges: a small photo skips the bigger sizes and notes it', async () => {
		const small = await photo(900, 1200);
		const { row } = await run(small, asking('category_3x4.as_is'));
		// Category 3:4 refuses photos under 1600 px on the short side.
		expect(row.versions?.[0]).toMatchObject({ state: 'failed', error: 'below_minimum' });
		const blog = await run(await photo(1200, 600), asking('blog_cover_2x1.as_is'));
		expect(blog.row.versions?.[0]?.state).toBe('ready');
		expect(Math.max(...blog.row.derivatives.map((file) => file.width))).toBe(1200);
		expect(blog.row.warnings).toEqual(expect.arrayContaining(['role_width_skipped', 'below_recommended_size']));
	});
});
