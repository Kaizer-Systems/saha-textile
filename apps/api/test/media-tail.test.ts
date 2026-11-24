import { GIB } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AdminMediaLibraryController } from '../src/media/admin-media-library.controller';
import { checkAppLink } from '../src/media/app-link-check';
import { BrandService } from '../src/media/brand.service';
import { MediaProfilesService } from '../src/media/media-profiles.service';
import { MediaStorageService } from '../src/media/media-storage.service';
import { MediaService } from '../src/media/media.service';
import { ReviewsService } from '../src/media/reviews.service';
import { ShareController } from '../src/media/share.controller';

/** An instance holding only the parts this test reads. */
const withParts = <T extends object>(type: { prototype: T }, parts: object): T =>
	Object.assign(Object.create(type.prototype), parts) as T;

const NOW = new Date('2026-11-24T10:00:00.000Z');
const SUPER = 'adm_owner';

function storage(usedGib: number, zips?: number) {
	const reserved: unknown[] = [];
	const service = new MediaStorageService(
		{ usage: async () => ({ originals: usedGib * GIB, versions: 0, files: 0, trash: 0 }) } as never,
		{
			reserve: async (hold: unknown) => void reserved.push(hold),
			reservedBytes: async () => 0,
			findReservation: async () => null,
		} as never,
		{
			get: async (key: string) =>
				key === 'media_nightly_check' ? { checkedAt: '2026-11-24T00:00:00.000Z', problems: 0 } : null,
			set: async () => undefined,
		} as never,
		{ findByKey: async () => ({ id: 'role_admin' }) } as never,
		{ findActive: async (userId: string) => (userId === SUPER ? { userId } : null) } as never,
		{ append: async (entry: unknown) => entry } as never,
		zips === undefined ? undefined : { storedBytes: async () => zips },
	);
	return { service, reserved };
}

describe('the storage box: the last cases', () => {
	it('reads the last nightly check, and counts kept .zip downloads apart', async () => {
		const { service } = storage(10, 3 * GIB);
		expect(await service.nightlyCheck()).toEqual({ checkedAt: '2026-11-24T00:00:00.000Z', problems: 0 });
		const summary = await service.summary('adm_1', NOW);
		expect(summary.breakdown.find((row) => row.key === 'zips')?.bytes).toBe(3 * GIB);
		expect(summary.usedBytes).toBe(10 * GIB);
	});

	it('holds nothing for work that adds no bytes, and keeps the others’ switch when the super admin says nothing of it', async () => {
		const { service } = storage(260);
		const empty = await service.check(SUPER, { operation: 'upload', bytes: 0, approve: true } as never, NOW);
		expect(empty).toMatchObject({ decision: 'go', reservationId: null });
		const roomy = storage(10);
		await roomy.service.admit('adm_1', 0, undefined, 'hold_1', NOW);
		expect(roomy.reserved).toEqual([]);
	});
});

describe('uploads: the last cases', () => {
	const media = () =>
		withParts(MediaService, {
			folders: { findById: async () => null },
			browse: { namesIn: async () => ['saree.jpg'] },
		}) as unknown as {
			mediaPagePlace(request: { folderId?: string | null; fileName: string; sha256?: string }): Promise<unknown>;
		};

	it('places a Media page upload at the top level, with no checksum when none was sent', async () => {
		expect(await media().mediaPagePlace({ folderId: null, fileName: 'saree.jpg' })).toMatchObject({
			folderId: null,
			displayName: 'saree (1).jpg',
			sha256: null,
		});
	});

	it('refuses a file name that cannot be used', async () => {
		await expect(media().mediaPagePlace({ folderId: null, fileName: '   ' })).rejects.toMatchObject({
			response: { issues: [{ code: 'bad_name' }] },
		});
	});

	it('queues a shopper’s finished upload without touching the admins’ storage holds', async () => {
		const release = vi.fn();
		const asset = { id: 'med_1', processing: { state: 'awaiting_upload' } };
		const svc = withParts(MediaService, {
			assets: { update: vi.fn(async () => undefined) },
			queue: { enqueue: vi.fn(async () => undefined) },
			storageCheck: { release },
			ownedAsset: async () => asset,
			status: async () => ({ assetId: 'med_1', state: 'queued' }),
		});
		expect(await svc.finalize({ type: 'customer', id: 'cus_1' } as never, 'med_1')).toEqual({
			assetId: 'med_1',
			state: 'queued',
		});
		expect(release).not.toHaveBeenCalled();
	});
});

describe('reviews: the last cases', () => {
	const photo = (id: string) => ({
		id,
		purpose: 'review',
		uploadedBy: { type: 'customer', id: 'cus_1' },
		processing: { state: 'ready' },
		visibility: 'private',
		derivatives: [],
		text: { alt: { en: `Photo ${id}` } },
	});

	it('takes a new photo on an edit of a review still waiting, without recounting the public rating', async () => {
		const recomputeAggregate = vi.fn();
		const svc = withParts(ReviewsService, {
			reviews: {
				findById: async () => ({
					id: 'rev_1',
					userId: 'cus_1',
					imageAssetIds: ['a'],
					status: 'pending',
					productId: 'p1',
				}),
				updateByAuthor: async (row: Record<string, unknown>) => ({ id: 'rev_1', ...row }),
				recomputeAggregate,
			},
			assets: { findManyByIds: async (ids: string[]) => ids.map(photo) },
		});
		const saved = await svc.update('cus_1', 'rev_1', {
			rating: 5,
			title: 'Lovely',
			body: 'Soft silk',
			imageAssetIds: ['a', 'b'],
		} as never);
		expect(saved).toMatchObject({ imageAssetIds: ['a', 'b'] });
		expect(recomputeAggregate).not.toHaveBeenCalled();
	});

	it('shows the author their own photos still waiting, each with its alt text', async () => {
		const svc = withParts(ReviewsService, {
			reviews: {
				findByUserAndProduct: async () => ({
					id: 'rev_1',
					rating: 4,
					title: 'Nice',
					body: 'Good',
					status: 'pending',
					imageAssetIds: ['a'],
				}),
			},
			assets: { findManyByIds: async (ids: string[]) => ids.map(photo) },
		});
		const mine = await svc.mine('cus_1', 'p1');
		expect(mine).toMatchObject({
			state: 'reviewed',
			review: { createdAt: null, photos: [{ assetId: 'a', thumbUrl: null, fullUrl: null, alt: 'Photo a' }] },
		});
	});
});

describe('store links, image profiles, the Brand Kit and share links: the last cases', () => {
	const answer = (status: number, body: unknown) =>
		({
			ok: status >= 200 && status < 300,
			status,
			text: async () => String(body),
			json: async () => body,
		}) as Response;

	it('finds a Play app whose page has no title, or a title that is only the store’s, with no name', async () => {
		const play = { store: 'android' as const, url: 'https://play.google.com/store/apps/details?id=com.shop.app' };
		expect(await checkAppLink(play, async () => answer(200, '<html></html>'))).toEqual({ found: true, name: null });
		expect(await checkAppLink(play, async () => answer(200, '<title> - Apps on Google Play</title>'))).toEqual({
			found: true,
			name: null,
		});
	});

	it('finds an App Store app listed without its results', async () => {
		expect(
			await checkAppLink({ store: 'ios', url: 'https://apps.apple.com/in/app/shop/id1234567890' }, async () =>
				answer(200, { resultCount: 1 }),
			),
		).toEqual({ found: true, name: null });
	});

	it('checks the image profiles at start-up quietly when none were missing, and refuses a profile that cannot be made', async () => {
		const profiles = {
			list: vi.fn(async () => []),
			insertMissing: vi.fn(async () => 0),
			save: vi.fn(),
			countPhotosByProfile: vi.fn(async () => ({})),
		};
		const service = new MediaProfilesService(profiles as never, { append: vi.fn() } as never);
		await service.onApplicationBootstrap();
		await expect(
			service.create('adm_1', {
				name: 'Wide hero',
				shape: { width: 21, height: 9 },
				widths: { any: [1600] },
				quality: null,
				minSize: { edge: 'short', px: 600, mode: 'warn' },
				fills: ['brand'],
				maxBytes: 20 * 1024 * 1024,
				accepts: ['image/jpeg'],
				enabled: true,
			} as never),
		).rejects.toMatchObject({ response: { issues: [{ code: 'fill_for_icons_only' }] } });
		expect(profiles.save).not.toHaveBeenCalled();
	});

	it('drops the stored version of a picture the Brand Kit no longer uses', async () => {
		const set = vi.fn(async () => undefined);
		const brand = withParts(BrandService, {
			settings: { get: async () => null, set },
		});
		expect(
			(await brand.save({ logoAssetId: null, imageVersions: { med_old: 'v2' } } as never)).imageVersions,
		).toEqual({});
	});

	it('reads activity for one item named by a safe id', async () => {
		const activity = vi.fn(async () => []);
		const controller = withParts(AdminMediaLibraryController, { library: { activity } });
		await controller.activity('2', 'med_1');
		expect(activity).toHaveBeenCalledWith(2, 50, 'med_1');
	});

	it('opens a password link sent without a password as an empty one', async () => {
		const open = vi.fn(async () => ({ kind: 'password' }));
		await new ShareController({ open } as never).openWithPassword(
			'code1',
			{} as never,
			{ ip: '10.0.0.1' } as never,
		);
		expect(open).toHaveBeenCalledWith('code1', { password: '', signedInAdmin: false, ip: '10.0.0.1' });
	});
});
