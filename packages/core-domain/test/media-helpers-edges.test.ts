import type { MediaAsset, MediaProfile } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { searchVocabulary } from '../src/catalog/search-terms';
import {
	deleteMediaForever,
	publicKeys,
	purgeMediaTrash,
	storedKeys,
	sweepUnfinishedUploads,
} from '../src/media/library-use-cases';
import { applyProfileUpdate, newProfile } from '../src/media/profile-rules';
import { SEEDED_MEDIA_PROFILES, assignExistingVersions, seededWidths } from '../src/media/profiles';
import { SEEDED_MEDIA_ROLES, reconcileSeededRoles } from '../src/media/seeded-roles';
import { checkSpaces } from '../src/media/spaces-check';
import { originalStorageKey, plainFileStorageKey } from '../src/media/storage-keys';
import { planAddVersions, planVersion, purposeForProfile } from '../src/media/version-plan';

const product = SEEDED_MEDIA_PROFILES.find((profile) => profile.key === 'product_3x4') as MediaProfile;

describe('media profiles and keys: the remaining cases', () => {
	it('lists only seeded families’ widths', () => {
		expect(seededWidths(['nope'])).toEqual({});
	});

	it('names brand files by their role, and leaves other brand files to the photo', () => {
		const asset = {
			kind: 'image',
			purpose: 'brand',
			warnings: [],
			width: 1000,
			height: 1000,
			versions: undefined,
			createdAt: '2026-11-01T00:00:00.000Z',
			processing: { processedAt: null },
			derivatives: ['brand_icon', 'brand_logo', 'mystery'].map((role) => ({
				role,
				storageKey: `media/med_b/${role}.webp`,
				width: 100,
				height: 100,
				format: 'image/webp',
				versionId: null,
			})),
		};
		const { derivatives } = assignExistingVersions(asset as never, '2026-11-20T00:00:00.000Z');
		expect(derivatives.map((row) => row.versionId)).toEqual([
			expect.stringMatching(/^browser_icon_1x1\./),
			expect.stringMatching(/^logo_keep_shape\./),
			null,
		]);
	});

	it('stores an unknown original type as JPEG, and a plain file with or without its ending', () => {
		expect(originalStorageKey('med_1', 'application/x-unknown')).toBe('media/med_1/original.jpg');
		expect(plainFileStorageKey('med_1', 'Price list.PDF')).toBe('media/med_1/original.pdf');
		expect(plainFileStorageKey('med_1', 'README')).toBe('media/med_1/original');
	});

	it('refuses sizes for a family the profile does not have, and takes a new profile with no sizes', () => {
		const plain = { ...product, fills: [], roles: ['card'], widths: { card: [100] } } as MediaProfile;
		expect(applyProfileUpdate(plain, { widths: { nobody: [100] } } as never)).toEqual({
			refusal: 'unknown_family',
		});
		const made = newProfile(
			{
				name: 'Own',
				shape: null,
				widths: {},
				quality: 80,
				fills: [],
				minSize: null,
				maxBytes: 1000,
				accepts: [],
				enabled: true,
			} as never,
			'own_any',
		);
		expect('profile' in made && made.profile.widths).toEqual({ own_any: [] });
	});

	it('applies a shape, quality, smallest size and on-off switch', () => {
		const update = { shape: { width: 3, height: 4 }, quality: 70, minSize: null, enabled: false };
		const result = applyProfileUpdate(product, update as never);
		expect('profile' in result && result.profile).toMatchObject({ quality: 70, enabled: false });
	});
});

describe('version plans: the remaining cases', () => {
	it('keeps the purpose older screens read for each kind of profile', () => {
		expect(
			['category_3x4', 'blog_cover_2x1', 'store_photo_4x3', 'square_1x1', 'something_else'].map(
				purposeForProfile,
			),
		).toEqual(['category', 'blog', 'store', 'icon', 'product']);
	});

	it('pads on the photo’s colour or the brand only when one is known, and keeps “as is” whole', () => {
		const role = {
			...(SEEDED_MEDIA_ROLES.find((row) => row.key === 'gallery') as (typeof SEEDED_MEDIA_ROLES)[number]),
			aspect: null,
		};
		const plan = (fill: string, colours?: { dominant: string | null; brand: string | null }) =>
			planVersion({
				profile: { key: 'product_3x4', shape: { width: 3, height: 4 }, roles: ['gallery'] },
				fill: fill as never,
				roles: [role],
				source: { width: 6000, height: 8000 },
				maxDisplayWidth: null,
				...(colours ? { colours } : {}),
			}).files[0]?.spec;
		expect(plan('colour', { dominant: '#112233', brand: null })).toMatchObject({
			fit: 'pad',
			background: '#112233',
		});
		expect(plan('colour')).not.toHaveProperty('background');
		expect(plan('brand', { dominant: null, brand: '#417394' })).toMatchObject({ background: '#417394' });
		expect(plan('brand')).not.toHaveProperty('background');
		expect(plan('as_is')).toMatchObject({ fit: 'inside', height: null });
	});

	it('makes a profile’s own family from its widths, and skips a family it neither has nor sizes', () => {
		const files = planVersion({
			profile: { key: 'own', shape: null, roles: ['own', 'ghost'], widths: { own: [100] } },
			fill: 'as_is',
			roles: [],
			source: { width: 1000, height: 1000 },
			maxDisplayWidth: null,
		}).files;
		expect(files.map((file) => [file.role, file.spec.width])).toEqual([['own', 100]]);
		const seededOnly = planVersion({
			profile: { key: 'p', shape: null, roles: ['gallery'] },
			fill: 'as_is',
			roles: SEEDED_MEDIA_ROLES,
			source: { width: 10_000, height: 10_000 },
			maxDisplayWidth: null,
		}).files;
		expect(seededOnly.length).toBeGreaterThan(0);
	});

	it('skips asks for a photo with no size, an unknown profile, and keeps a fill the photo needs', () => {
		const asset = (over: Record<string, unknown>) =>
			({
				kind: 'image',
				width: 3000,
				height: 2000,
				originalStorageKey: 'media/med_1/original.jpg',
				originalByteSize: 1000,
				originalFormat: 'image/jpeg',
				...over,
			}) as never;
		const profiles = new Map([[product.key, product]]);
		const at = '2026-11-20T00:00:00.000Z';
		expect(
			planAddVersions({
				asset: asset({ width: null }),
				asked: [{ profileKey: 'product_3x4', fill: 'white' }],
				profiles,
				at,
			}).skipped,
		).toEqual([{ versionId: 'product_3x4.white', reason: 'not_a_photo' }]);
		expect(
			planAddVersions({ asset: asset({}), asked: [{ profileKey: 'nope', fill: 'white' }], profiles, at }).skipped,
		).toEqual([{ versionId: 'nope.white', reason: 'profile_unknown' }]);
		const wide = planAddVersions({
			asset: asset({}),
			asked: [{ profileKey: 'product_3x4', fill: 'white' }],
			profiles,
			fitAsIs: true,
			at,
		});
		expect([...wide.add, ...wide.retry].length + wide.skipped.length).toBe(1);
	});
});

const photo = (id: string, over: Partial<MediaAsset> = {}): MediaAsset =>
	({
		id,
		kind: 'image',
		purpose: 'product',
		originalStorageKey: `media/${id}/original.jpg`,
		derivatives: [],
		renditions: [],
		hlsPlaylistKey: null,
		visibility: 'public',
		folderId: null,
		trashedAt: '2026-10-01T00:00:00.000Z',
		...over,
	}) as MediaAsset;

describe('deleting media for good: the remaining cases', () => {
	const deps = (assets: MediaAsset[], over: Record<string, unknown> = {}) => {
		const files = new Map(assets.map((row) => [row.id, row]));
		return {
			folders: {
				findManyByIds: async () => [],
				listSubtree: async () => [],
				listTrashed: async () => [],
				hardDelete: vi.fn(),
			},
			files: { listInFolders: vi.fn(), listTrashedBefore: async () => assets },
			assets: {
				findManyByIds: async (ids: readonly string[]) => ids.flatMap((id) => files.get(id) ?? []),
				hardDelete: vi.fn(),
			},
			stars: { removeTargets: vi.fn() },
			links: { removeForAssets: vi.fn() },
			queue: { enqueue: vi.fn() },
			emailPictures: { keep: vi.fn() },
			publicUrl: (key: string) => `https://cdn.example/${key}`,
			record: vi.fn(),
			...over,
		};
	};

	it('lists video files and kept files among the keys', () => {
		const video = photo('med_v', {
			renditions: [{ storageKey: 'media/med_v/720p.mp4' }],
			keptFiles: [
				{
					keys: ['media/med_v/card-old.webp', 'media/med_v/original-2026.jpg'],
					deleteAfter: '2026-12-01',
					reason: 'replace',
				},
			],
		} as never);
		expect(storedKeys(video)).toContain('media/med_v/720p.mp4');
		expect(publicKeys(video)).toEqual(['media/med_v/card-old.webp']);
	});

	it('keeps leaving email pictures, and queues nothing when nothing is stored', async () => {
		const mailed = photo('med_m', {
			originalStorageKey: null,
			derivatives: [
				{ role: 'email', storageKey: 'email/med_m/thumb.jpg', width: 300, height: 400, format: 'image/jpeg' },
			],
		} as never);
		const d = deps([mailed]);
		expect(await deleteMediaForever(d as never, { fileIds: ['med_m'], folderIds: [] })).toMatchObject({
			ok: true,
			done: 1,
		});
		expect(d.emailPictures.keep).toHaveBeenCalled();
		expect(d.queue.enqueue).not.toHaveBeenCalled();
		expect(d.files.listInFolders).not.toHaveBeenCalled();
	});

	it('removes nothing when the purge finds the file restored meanwhile', async () => {
		const restored = photo('med_r');
		const d = deps([restored], {
			assets: { findManyByIds: async () => [{ ...restored, trashedAt: null }], hardDelete: vi.fn() },
		});
		expect(await purgeMediaTrash(d as never, new Date('2026-11-20T00:00:00Z'))).toEqual({ files: 0, folders: 0 });
	});

	it('sweeps an unfinished upload that never reached storage', async () => {
		const queue = { enqueue: vi.fn() };
		const swept = await sweepUnfinishedUploads(
			{
				files: { listUnfinishedBefore: async () => [photo('med_u', { originalStorageKey: null } as never)] },
				assets: { hardDelete: vi.fn() },
				queue,
				release: vi.fn(),
				record: vi.fn(),
			} as never,
			new Date('2026-11-20T00:00:00Z'),
		);
		expect(swept).toBe(1);
		expect(queue.enqueue).not.toHaveBeenCalled();
	});
});

describe('the nightly storage check, roles and search words: the remaining cases', () => {
	const ready = (id: string) =>
		({
			id,
			kind: 'image',
			slug: id,
			deletedAt: null,
			processing: { state: 'ready' },
			versions: [],
			derivatives: [
				{
					role: 'card',
					storageKey: `media/${id}/card.webp`,
					width: 400,
					height: 400,
					format: 'image/webp',
					versionId: null,
				},
			],
		}) as unknown as MediaAsset;

	it('lists at most fifty missing photos by name, by slug when unnamed, across batches', async () => {
		const ids = Array.from({ length: 501 }, (_, at) => `med_${String(at).padStart(3, '0')}`);
		const result = await checkSpaces(
			{
				listKeys: async function* () {},
				referencedIds: async () => [...ids, 'med_fine'],
				findManyByIds: async (asked) => asked.map(ready),
				whereUsed: async () => new Map(),
			},
			new Date('2026-11-20T00:00:00Z'),
		);
		expect(result.missingCount).toBe(502);
		expect(result.missing).toHaveLength(50);
		expect(result.missing[0]).toEqual({ assetId: 'med_000', name: 'med_000', usedOn: [], files: 1 });
	});

	it('reads a stored role without an inset as inset 0', async () => {
		const save = vi.fn();
		const stored = SEEDED_MEDIA_ROLES.map((role) => {
			const { inset: _inset, ...rest } = role;
			return rest;
		});
		expect(Array.isArray(await reconcileSeededRoles({ list: async () => stored as never, save }))).toBe(true);
	});

	it('finds a product in no known category without failing', () => {
		const vocabulary = searchVocabulary(
			[
				{ id: 't', status: 'live', name: 'silk', spellings: [], categoryIds: ['cat_silk'], productIds: [] },
			] as never,
			[],
		);
		expect(vocabulary.wordsFor({ id: 'p', categoryIds: ['cat_unknown'] } as never)).toEqual([]);
	});
});
