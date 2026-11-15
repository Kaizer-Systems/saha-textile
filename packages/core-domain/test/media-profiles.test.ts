import type { ImageDerivative, MediaAsset, MediaProfile } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	PER_PHOTO_ROLES,
	SEEDED_MEDIA_PROFILES,
	SEEDED_MEDIA_ROLES,
	assignExistingVersions,
	fitsProfileShape,
	reconcileBuiltInProfiles,
	versionFolder,
	versionIdOf,
} from '../src/index';

/** Media build step 2a: image profiles, and today's photos named under the version they already are. */

const file = (role: string, width: number, extra: Partial<ImageDerivative> = {}): ImageDerivative => ({
	role,
	storageKey: `media/med_1/red-banarasi-${role.replace(/_/g, '-')}-${width}w-1f3a9c2e.webp`,
	width,
	height: Math.round((width * 4) / 3),
	byteSize: width * 10,
	format: 'image/webp',
	roleVersion: 1,
	...extra,
});

const photo = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: 'med_1',
	kind: 'image',
	purpose: 'product',
	originalStorageKey: 'media/med_1/original.jpg',
	originalFormat: 'image/jpeg',
	originalByteSize: 1000,
	width: 3000,
	height: 4000,
	slug: 'red-banarasi',
	derivatives: [file('thumb', 150), file('card', 400), file('gallery', 1600), file('zoom', 2000)],
	dominantColor: null,
	thumbHash: null,
	visibility: 'public',
	processing: { state: 'ready', attempts: 1, error: null, processedAt: '2026-11-02T10:00:00.000Z' },
	warnings: [],
	servesAsPrimary: false,
	maxDisplayWidth: null,
	renditions: [],
	hlsPlaylistKey: null,
	durationSeconds: null,
	text: { alt: { en: 'Red Banarasi saree' }, title: {}, caption: {} },
	status: 'draft',
	uploadedBy: null,
	deletedAt: null,
	createdAt: '2026-11-01T10:00:00.000Z',
	...overrides,
});

const AT = '2026-11-16T00:00:00.000Z';
const byKey = new Map(SEEDED_MEDIA_PROFILES.map((profile) => [profile.key, profile]));

describe('the starting image profiles (F01 + the fills table, R4-1/R4-10; Banner keep shape, 16 Nov)', () => {
	it('are the twelve approved profiles, with unique keys', () => {
		expect(SEEDED_MEDIA_PROFILES.map((profile) => profile.name)).toEqual([
			'Product 3:4',
			'Category 3:4',
			'Hero 21:9',
			'Hero 16:9',
			'Phone banner 4:5',
			'Banner (keep shape)',
			'Blog cover 2:1',
			'Store photo 4:3',
			'Square 1:1',
			'Browser icon 1:1',
			'Logo (keep shape)',
			'Link preview 1.91:1',
		]);
		expect(new Set(SEEDED_MEDIA_PROFILES.map((profile) => profile.key)).size).toBe(12);
	});

	it('offer exactly the fills the approved table lists, and never a stretch', () => {
		const fills = Object.fromEntries(SEEDED_MEDIA_PROFILES.map((profile) => [profile.key, profile.fills]));
		expect(fills).toEqual({
			product_3x4: ['white', 'blur', 'crop'],
			category_3x4: ['white', 'blur', 'crop'],
			hero_21x9: ['crop', 'blur', 'colour'],
			hero_16x9: ['crop', 'blur', 'colour'],
			phone_banner_4x5: ['crop', 'blur'],
			banner_keep_shape: [],
			blog_cover_2x1: ['crop', 'blur'],
			store_photo_4x3: ['crop', 'blur', 'white'],
			square_1x1: ['white', 'colour', 'crop'],
			browser_icon_1x1: ['white', 'brand'],
			logo_keep_shape: [],
			link_preview: ['blur'],
		});
		const all = SEEDED_MEDIA_PROFILES.flatMap((profile) => profile.fills as string[]);
		expect(all.some((fill) => /stretch|squeeze/.test(fill))).toBe(false);
	});

	it('mark built-in exactly the ones F01 marks, plus Browser icon and Banner (keep shape)', () => {
		expect(SEEDED_MEDIA_PROFILES.filter((profile) => profile.builtIn).map((profile) => profile.key)).toEqual([
			'product_3x4',
			'category_3x4',
			'banner_keep_shape',
			'blog_cover_2x1',
			'store_photo_4x3',
			'browser_icon_1x1',
			'logo_keep_shape',
			'link_preview',
		]);
	});

	it('keep the photo’s own shape for logos and banners, and make banners at the banner sizes (480–2880 px)', () => {
		expect(byKey.get('banner_keep_shape')).toMatchObject({ shape: null, roles: ['banner'], minSize: null });
		expect(byKey.get('logo_keep_shape')?.shape).toBeNull();
		const banner = SEEDED_MEDIA_ROLES.find((role) => role.key === 'banner');
		expect([Math.min(...(banner?.widths ?? [])), Math.max(...(banner?.widths ?? []))]).toEqual([480, 2880]);
	});

	it('only name size families that exist, and never a picture made once per photo', () => {
		const roles = new Set(SEEDED_MEDIA_ROLES.map((role) => role.key));
		for (const profile of SEEDED_MEDIA_PROFILES) {
			for (const role of profile.roles) expect(roles.has(role)).toBe(true);
			if (!profile.mainPhotoOnly) expect(profile.roles.some((role) => PER_PHOTO_ROLES.has(role))).toBe(false);
		}
	});

	it('keep today’s floors: product and category refuse under 1600 px short side, the rest only warn', () => {
		expect(byKey.get('product_3x4')?.minSize).toEqual({ edge: 'short', px: 1600, mode: 'refuse' });
		expect(byKey.get('category_3x4')?.minSize).toEqual({ edge: 'short', px: 1600, mode: 'refuse' });
		const refusing = SEEDED_MEDIA_PROFILES.filter((profile) => profile.minSize?.mode === 'refuse');
		expect(refusing.map((profile) => profile.key)).toEqual(['product_3x4', 'category_3x4']);
		expect(SEEDED_MEDIA_PROFILES.every((profile) => profile.maxBytes === 25 * 1024 * 1024)).toBe(true);
	});
});

describe('version ids and folders', () => {
	it('are the profile and the fill, and the folder swaps dots and underscores for hyphens', () => {
		expect(versionIdOf('hero_21x9', 'crop')).toBe('hero_21x9.crop');
		expect(versionFolder('hero_21x9.crop')).toBe('hero-21x9-crop');
		expect(versionFolder('product_3x4.as_is')).toBe('product-3x4-as-is');
	});

	it('count a photo within 5% of the shape as the same shape, and anything with no shape as fitting', () => {
		expect(fitsProfileShape({ width: 3000, height: 4000 }, { width: 3, height: 4 })).toBe(true);
		expect(fitsProfileShape({ width: 3100, height: 4000 }, { width: 3, height: 4 })).toBe(true);
		expect(fitsProfileShape({ width: 3300, height: 4000 }, { width: 3, height: 4 })).toBe(false);
		expect(fitsProfileShape({ width: 2721, height: 805 }, null)).toBe(true);
	});
});

describe('assignExistingVersions: today’s photos become the version they already are', () => {
	it('names a 3:4 product photo “Product 3:4 · As is” without touching any file', () => {
		const before = photo();
		const { versions, derivatives } = assignExistingVersions(before, AT);
		expect(versions).toEqual([
			{
				id: 'product_3x4.as_is',
				profileKey: 'product_3x4',
				profileVersion: 1,
				fill: 'as_is',
				state: 'ready',
				createdAt: '2026-11-02T10:00:00.000Z',
			},
		]);
		expect(derivatives.map((row) => row.versionId)).toEqual(Array(4).fill('product_3x4.as_is'));
		expect(derivatives.map(({ versionId: _versionId, ...rest }) => rest)).toEqual(before.derivatives);
	});

	it('names a letterboxed product photo “Product 3:4 · White padding”', () => {
		const square = photo({ width: 4000, height: 4000, warnings: ['letterboxed'] });
		expect(assignExistingVersions(square, AT).versions.map((version) => version.id)).toEqual(['product_3x4.white']);
		// Old rows written before the warning existed: the stored size decides.
		const noWarning = photo({ width: 4000, height: 4000 });
		expect(assignExistingVersions(noWarning, AT).versions[0]?.id).toBe('product_3x4.white');
	});

	it('leaves pictures made once per photo outside every version', () => {
		const main = photo({
			servesAsPrimary: true,
			derivatives: [file('card', 400), file('share', 1200), file('story', 1080), file('email_thumb', 300)],
		});
		const { derivatives, versions } = assignExistingVersions(main, AT);
		expect(derivatives.filter((row) => row.versionId === null).map((row) => row.role)).toEqual([
			'share',
			'story',
			'email_thumb',
		]);
		expect(versions).toHaveLength(1);
	});

	it('names banners “Banner (keep shape) · As is”, whatever their shape', () => {
		const strip = photo({ purpose: 'banner', width: 2721, height: 805, derivatives: [file('banner', 1920)] });
		expect(assignExistingVersions(strip, AT).versions.map((version) => version.id)).toEqual([
			'banner_keep_shape.as_is',
		]);
	});

	it('splits a Brand Kit picture into the logo and the browser icon (always on white), and leaves the shop preview alone', () => {
		const brand = photo({
			purpose: 'brand',
			width: 1200,
			height: 400,
			derivatives: [file('brand_logo', 480), file('brand_icon', 512), file('site_share', 1200)],
		});
		const { versions, derivatives } = assignExistingVersions(brand, AT);
		expect(versions.map((version) => version.id)).toEqual(['logo_keep_shape.as_is', 'browser_icon_1x1.white']);
		expect(derivatives.map((row) => row.versionId)).toEqual([
			'logo_keep_shape.as_is',
			'browser_icon_1x1.white',
			null,
		]);
	});

	it('names an off-square avatar a crop, an off-square icon white, and the other purposes by their shape', () => {
		const avatar = photo({ purpose: 'avatar', width: 800, height: 600, derivatives: [file('avatar', 96)] });
		const icon = photo({ purpose: 'icon', width: 800, height: 600, derivatives: [file('category_icon', 256)] });
		const blog = photo({ purpose: 'blog', width: 2400, height: 1200, derivatives: [file('blog', 800)] });
		const store = photo({ purpose: 'store', width: 1600, height: 1600, derivatives: [file('store_photo', 800)] });
		const category = photo({ purpose: 'category', derivatives: [file('thumb', 150)] });
		expect(assignExistingVersions(avatar, AT).versions[0]?.id).toBe('square_1x1.crop');
		expect(assignExistingVersions(icon, AT).versions[0]?.id).toBe('square_1x1.white');
		expect(assignExistingVersions(blog, AT).versions[0]?.id).toBe('blog_cover_2x1.as_is');
		expect(assignExistingVersions(store, AT).versions[0]?.id).toBe('store_photo_4x3.white');
		expect(assignExistingVersions(category, AT).versions[0]?.id).toBe('category_3x4.as_is');
	});

	it('gives review photos, plain files and unprocessed photos no versions', () => {
		const review = photo({
			purpose: 'review',
			derivatives: [file('review_thumb', 150), file('review_full', 1600)],
		});
		expect(assignExistingVersions(review, AT).versions).toEqual([]);
		const pdf = photo({ kind: 'file', originalFormat: 'application/pdf', derivatives: [] });
		expect(assignExistingVersions(pdf, AT)).toEqual({ versions: [], derivatives: [] });
		expect(assignExistingVersions(photo({ derivatives: [] }), AT).versions).toEqual([]);
	});

	it('changes nothing the second time, keeping each version’s date', () => {
		const first = assignExistingVersions(photo(), AT);
		const second = assignExistingVersions(
			photo({ versions: first.versions, derivatives: first.derivatives }),
			'2027-01-01T00:00:00.000Z',
		);
		expect(second).toEqual(first);
	});

	it('records the profile’s current version, and falls back to the creation date, then the run date', () => {
		const versions = new Map([['product_3x4', 4]]);
		const unprocessed = photo({ processing: { state: 'ready', attempts: 1, error: null, processedAt: null } });
		expect(assignExistingVersions(unprocessed, AT, versions).versions[0]).toMatchObject({
			profileVersion: 4,
			createdAt: '2026-11-01T10:00:00.000Z',
		});
		const undated = photo({
			createdAt: undefined,
			processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
		});
		expect(assignExistingVersions(undated, AT).versions[0]?.createdAt).toBe(AT);
	});
});

describe('reconcileBuiltInProfiles', () => {
	it('puts back only built-in profiles, never one an admin may have deleted', async () => {
		const insertMissing = vi.fn(async (rows: readonly MediaProfile[]) => rows.length);
		await expect(reconcileBuiltInProfiles({ insertMissing })).resolves.toBe(8);
		const keys = (insertMissing.mock.calls[0]?.[0] ?? []).map((profile) => profile.key);
		expect(keys).not.toContain('hero_21x9');
		expect(keys).not.toContain('square_1x1');
		expect(keys).toContain('banner_keep_shape');
	});
});
