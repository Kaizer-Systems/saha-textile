import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminContentController } from '../src/media/admin-content.controller';
import { AdminMediaController } from '../src/media/admin-media.controller';
import { AdminReviewsController } from '../src/media/admin-reviews.controller';
import { ContentBlocksService } from '../src/media/content-blocks.service';
import { MediaService } from '../src/media/media.service';
import { ReviewsService } from '../src/media/reviews.service';
import { StorefrontMediaController, StorefrontReviewsController } from '../src/media/storefront-media.controller';
import { YouTubeService } from '../src/media/youtube.service';

const derivative = (role: string, width = 100) => ({
	role,
	storageKey: `k/${role}/${width}`,
	width,
	height: 100,
	byteSize: 1,
	format: 'image/webp',
	roleVersion: 1,
});

const asset = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'med_1',
		kind: 'image',
		purpose: 'product',
		originalStorageKey: 'media/med_1/original.jpg',
		slug: 'red',
		width: 300,
		height: 400,
		derivatives: [],
		visibility: 'public',
		processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
		warnings: [],
		text: { alt: {}, title: {}, caption: {} },
		dominantColor: null,
		thumbHash: null,
		uploadedBy: { type: 'admin', id: 'a1' },
		deletedAt: null,
		...overrides,
	}) as never;

const mediaDeps = (found: unknown = asset()) => {
	const assets = {
		findById: vi.fn(async () => found),
		findManyByIds: vi.fn(async () => []),
		create: vi.fn(async (row: unknown) => row),
		update: vi.fn(async (row: unknown) => row),
		list: vi.fn(async () => ({ items: [found], total: 1, page: 1, pageSize: 24 })),
		countReferences: vi.fn(async () => 0),
		softDelete: vi.fn(async () => {}),
	};
	const roles = {
		list: vi.fn(async () => [{ key: 'card', version: 2 }]),
		findByKey: vi.fn(async () => null as unknown),
		save: vi.fn(async (row: unknown) => row),
		insertMissing: vi.fn(async () => 0),
	};
	const storage = {
		getUrl: (key: string) => `https://cdn.test/${key}`,
		createSignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.test', headers: { a: 'b' } })),
		createSignedDownloadUrl: vi.fn(async () => 'https://signed.test'),
	};
	const queue = { enqueue: vi.fn(async () => {}) };
	const audit = { append: vi.fn(async () => {}) };
	const service = new MediaService(
		assets as never,
		roles as never,
		storage as never,
		queue as never,
		audit as never,
		{ locales: ['en', 'fr'] } as never,
	);
	return { service, assets, roles, storage, queue, audit };
};

const admin = { type: 'admin', id: 'a1' } as const;
const customer = { type: 'customer', id: 'c1' } as const;
const upload = {
	purpose: 'product',
	contentType: 'image/jpeg',
	byteSize: 1000,
	fileName: 'Red Saree.jpg',
	width: 1600,
	height: 2133,
} as never;

const statusOf = async (work: Promise<unknown>) => {
	const error = (await work.catch((caught: unknown) => caught)) as HttpException;
	return { status: error.getStatus(), body: error.getResponse() };
};

describe('MediaService', () => {
	it('seeds roles on boot, skips for a docs build, and survives no database', async () => {
		const { service, roles } = mediaDeps();
		const before = process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
		process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = '1';
		await service.onApplicationBootstrap();
		expect(roles.list).not.toHaveBeenCalled();
		delete process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD;
		roles.list.mockResolvedValue([]);
		await service.onApplicationBootstrap();
		roles.list.mockRejectedValue(new Error('no mongo'));
		await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
		if (before !== undefined) process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD = before;
	});

	it('logs nothing when every role already matches', async () => {
		const { service, roles } = mediaDeps();
		const seeded = (await import('@saha-textile/core-domain')).SEEDED_MEDIA_ROLES;
		roles.list.mockResolvedValue(seeded as never);
		await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
	});

	it('states the upload rules and the active languages', () => {
		const { service } = mediaDeps();
		expect(service.uploadRules().acceptedTypes).toContain('image/jpeg');
		expect(service.activeLocales).toEqual(['en', 'fr']);
		expect(MediaService.ADMIN_PURPOSES).toContain('banner');
	});

	it('refuses an upload the policy rejects, with a message for each reason', async () => {
		const { service } = mediaDeps();
		const refused = await statusOf(
			service.presign(admin, { ...(upload as object), contentType: 'image/gif' } as never),
		);
		expect(refused.status).toBe(422);
	});

	it('starts an admin upload as public, with a slug from the file name', async () => {
		const { service, assets, storage } = mediaDeps();
		const response = await service.presign(admin, upload);
		expect(response).toMatchObject({ uploadUrl: 'https://upload.test', headers: { a: 'b' } });
		expect(assets.create).toHaveBeenCalledWith(
			expect.objectContaining({ visibility: 'public', slug: 'red-saree', maxDisplayWidth: null }),
		);
		expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
	});

	it('quarantines a customer upload, keeps a given slug, and copes with no headers', async () => {
		const { service, assets, storage } = mediaDeps();
		storage.createSignedUploadUrl.mockResolvedValue({ url: 'u' } as never);
		const response = await service.presign(customer, {
			...(upload as object),
			slug: 'given',
			maxDisplayWidth: 800,
		} as never);
		expect(response.headers).toEqual({});
		expect(assets.create).toHaveBeenCalledWith(
			expect.objectContaining({ visibility: 'private', slug: 'given', maxDisplayWidth: 800 }),
		);
	});

	it('queues processing once', async () => {
		const waiting = asset({
			processing: { state: 'awaiting_upload', attempts: 0, error: null, processedAt: null },
		});
		const { service, queue, assets } = mediaDeps(waiting);
		await service.finalize(admin, 'med_1');
		expect(queue.enqueue).toHaveBeenCalledWith({ type: 'process', assetId: 'med_1' });
		expect(assets.update).toHaveBeenCalledTimes(1);
		const done = mediaDeps();
		await done.service.finalize(admin, 'med_1');
		expect(done.queue.enqueue).not.toHaveBeenCalled();
	});

	it('picks the best preview: known roles first, widest within a role', async () => {
		const rows = [
			derivative('zoom', 900),
			derivative('card', 200),
			derivative('card', 400),
			derivative('thumb', 50),
		];
		const { service } = mediaDeps(asset({ derivatives: rows }));
		expect((await service.status(admin, 'med_1')).previewUrl).toBe('https://cdn.test/k/thumb/50');
		const unknown = mediaDeps(asset({ derivatives: [derivative('zoom', 100), derivative('other', 900)] }));
		expect((await unknown.service.status(admin, 'med_1')).previewUrl).toBe('https://cdn.test/k/other/900');
		const none = mediaDeps();
		expect((await none.service.status(admin, 'med_1')).previewUrl).toBeNull();
	});

	it('signs a preview of a private photo', async () => {
		const owned = asset({
			visibility: 'private',
			derivatives: [derivative('card')],
			uploadedBy: { type: 'customer', id: 'c1' },
		});
		const { service } = mediaDeps(owned);
		expect((await service.status(customer, 'med_1')).previewUrl).toBe('https://signed.test');
	});

	it('keeps one customer out of another customer upload, and admins out of customer uploads', async () => {
		const theirs = asset({ uploadedBy: { type: 'customer', id: 'other' } });
		await expect(mediaDeps(theirs).service.status(customer, 'med_1')).rejects.toBeInstanceOf(NotFoundException);
		await expect(mediaDeps(theirs).service.status(admin, 'med_1')).rejects.toBeInstanceOf(NotFoundException);
		await expect(mediaDeps().service.status(customer, 'med_1')).rejects.toBeInstanceOf(NotFoundException);
		await expect(mediaDeps(null).service.status(admin, 'med_1')).rejects.toBeInstanceOf(NotFoundException);
		await expect(mediaDeps(asset({ uploadedBy: null })).service.status(customer, 'med_1')).rejects.toBeInstanceOf(
			NotFoundException,
		);
		expect((await mediaDeps(asset({ uploadedBy: null })).service.status(admin, 'med_1')).assetId).toBe('med_1');
	});

	it('lists the library with stale roles and usage', async () => {
		const { service, assets } = mediaDeps(asset({ derivatives: [derivative('card')] }));
		assets.countReferences.mockResolvedValue(2);
		const page = await service.library({ page: 1, pageSize: 24 } as never);
		expect(page.items[0]).toMatchObject({ usageCount: 2, staleRoles: ['card'] });
		expect(page.items[0]?.preview?.roles['card']?.[0]?.url).toContain('cdn.test');
	});

	it('hides a deleted asset', async () => {
		await expect(mediaDeps(asset({ deletedAt: 'x' })).service.get('med_1')).rejects.toBeInstanceOf(
			NotFoundException,
		);
		await expect(mediaDeps(null).service.get('med_1')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('edits text, and reprocesses only for a new slug on a ready asset', async () => {
		const { service, assets, queue, audit } = mediaDeps();
		await service.updateText('a1', 'med_1', {
			alt: { en: 'A' },
			title: { en: 'T' },
			caption: { en: 'C' },
		} as never);
		expect(assets.update).toHaveBeenCalledWith(
			expect.objectContaining({
				slug: 'red',
				text: { alt: { en: 'A' }, title: { en: 'T' }, caption: { en: 'C' } },
			}),
		);
		expect(queue.enqueue).not.toHaveBeenCalled();
		await service.updateText('a1', 'med_1', { slug: 'red' } as never);
		expect(queue.enqueue).not.toHaveBeenCalled();
		await service.updateText('a1', 'med_1', { slug: 'new' } as never);
		expect(queue.enqueue).toHaveBeenCalledWith({ type: 'reprocess', assetId: 'med_1', reason: 'slug' });
		expect(audit.append).toHaveBeenCalledTimes(3);
		const busy = mediaDeps(asset({ processing: { state: 'queued', attempts: 0, error: null, processedAt: null } }));
		await busy.service.updateText('a1', 'med_1', { slug: 'new' } as never);
		expect(busy.queue.enqueue).not.toHaveBeenCalled();
	});

	it('reprocesses only with an original', async () => {
		const { service, queue } = mediaDeps();
		await service.reprocess('a1', 'med_1');
		expect(queue.enqueue).toHaveBeenCalledWith({ type: 'reprocess', assetId: 'med_1', reason: 'manual' });
		const refused = await statusOf(mediaDeps(asset({ originalStorageKey: null })).service.reprocess('a1', 'med_1'));
		expect(refused.status).toBe(409);
	});

	it('refuses to delete what is in use', async () => {
		const { service, assets } = mediaDeps();
		await service.remove('a1', 'med_1');
		expect(assets.softDelete).toHaveBeenCalledTimes(1);
		assets.countReferences.mockResolvedValue(3);
		const refused = await statusOf(service.remove('a1', 'med_1'));
		expect(refused.status).toBe(409);
		expect(JSON.stringify(refused.body)).toContain('3 place');
	});

	it('lists roles', async () => {
		expect(await mediaDeps().service.listRoles()).toEqual([{ key: 'card', version: 2 }]);
	});

	it('bumps a role version only when its output changes', async () => {
		const role = { key: 'card', label: 'Card', widths: [400, 200], quality: 80, version: 3 };
		const { service, roles } = mediaDeps();
		await expect(service.updateRole('a1', 'nope', {} as never)).rejects.toBeInstanceOf(NotFoundException);
		roles.findByKey.mockResolvedValue(role);
		expect(await service.updateRole('a1', 'card', { label: 'New' } as never)).toMatchObject({
			label: 'New',
			version: 3,
		});
		expect((await service.updateRole('a1', 'card', { widths: [200, 400], quality: 80 } as never)).version).toBe(3);
		expect(await service.updateRole('a1', 'card', { widths: [600, 600, 300] } as never)).toMatchObject({
			widths: [300, 600],
			version: 4,
		});
		expect(await service.updateRole('a1', 'card', { quality: 70 } as never)).toMatchObject({
			quality: 70,
			version: 4,
		});
	});
});

describe('ReviewsService', () => {
	const product = { id: 'p1', title: { en: 'Red', fr: 'Rouge' } };
	const order = { id: 'o1', userId: 'c1', status: 'delivered', lines: [{ productId: 'p1' }] };
	const review = { id: 'r1', productId: 'p1', userId: 'c1', imageAssetIds: ['m1'] };
	const build = (
		overrides: {
			order?: unknown;
			product?: unknown;
			verified?: boolean;
			review?: unknown;
			moderated?: unknown;
			locales?: string[];
		} = {},
	) => {
		const reviews = {
			hasVerifiedPurchase: vi.fn(async () => overrides.verified ?? true),
			create: vi.fn(async (row: unknown) => row),
			list: vi.fn(async () => ({ items: [review], total: 1, page: 1, pageSize: 20 })),
			findById: vi.fn(async () => (overrides.review === undefined ? review : overrides.review)),
			moderate: vi.fn(async () => (overrides.moderated === undefined ? { id: 'r1' } : overrides.moderated)),
			recomputeAggregate: vi.fn(async () => {}),
		};
		const assets = {
			findManyByIds: vi.fn(async () => [] as unknown[]),
			update: vi.fn(async (row: unknown) => row),
			hardDelete: vi.fn(async () => {}),
		};
		const products = {
			findById: vi.fn(async () => (overrides.product === undefined ? product : overrides.product)),
		};
		const orders = { findById: vi.fn(async () => (overrides.order === undefined ? order : overrides.order)) };
		const customers = {
			findById: vi.fn(async () => ({ displayName: 'Asha', email: 'a@example.test' }) as unknown),
		};
		const storage = {
			getUrl: (key: string) => `https://cdn.test/${key}`,
			createSignedDownloadUrl: vi.fn(async () => 'https://signed.test'),
			setVisibility: vi.fn(async () => {}),
		};
		const queue = { enqueue: vi.fn(async () => {}) };
		const media = { presign: vi.fn(async () => 'presigned') };
		const service = new ReviewsService(
			reviews as never,
			assets as never,
			products as never,
			orders as never,
			customers as never,
			storage as never,
			queue as never,
			media as never,
			{ locales: overrides.locales ?? ['en', 'fr'] } as never,
		);
		return { service, reviews, assets, products, customers, storage, media };
	};
	const submit = { orderId: 'o1', productId: 'p1', rating: 5, title: 'T', body: 'B', imageAssetIds: [] } as never;

	it('lets only a verified buyer upload', async () => {
		const request = {
			productId: 'p1',
			contentType: 'image/jpeg',
			byteSize: 1,
			fileName: 'a.jpg',
			width: 1,
			height: 1,
		} as never;
		await expect(build({ product: null }).service.presignPhoto('c1', request)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		expect((await statusOf(build({ verified: false }).service.presignPhoto('c1', request))).status).toBe(403);
		const { service, media } = build();
		expect(await service.presignPhoto('c1', request)).toBe('presigned');
		expect(media.presign).toHaveBeenCalledWith(
			{ type: 'customer', id: 'c1' },
			expect.objectContaining({ purpose: 'review' }),
		);
	});

	it.each([
		['no order', null],
		['someone else’s order', { ...order, userId: 'x' }],
		['an undelivered order', { ...order, status: 'paid' }],
		['another product', { ...order, lines: [{ productId: 'other' }] }],
	])('refuses a review from %s', async (_label, found) => {
		expect((await statusOf(build({ order: found }).service.submit('c1', submit))).status).toBe(403);
	});

	it('refuses a photo it cannot attach', async () => {
		const refused = await statusOf(
			build().service.submit('c1', { ...(submit as object), imageAssetIds: ['m1', 'm1', 'm2'] } as never),
		);
		expect(refused.status).toBe(422);
	});

	it('stores a pending review and names photos after the product in each language', async () => {
		const { service, assets, reviews } = build({ locales: ['en', 'fr', 'de'] });
		const photo = {
			id: 'm1',
			purpose: 'review',
			uploadedBy: { type: 'customer', id: 'c1' },
			processing: { state: 'ready' },
			text: { alt: {}, title: {}, caption: {} },
		};
		assets.findManyByIds.mockResolvedValue([photo]);
		const saved = await service.submit('c1', { ...(submit as object), imageAssetIds: ['m1', 'm1'] } as never);
		expect(saved).toMatchObject({ status: 'pending', imageAssetIds: ['m1'] });
		expect(assets.update).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.objectContaining({
					alt: { en: 'Red — customer photo', fr: 'Rouge — photo client', de: 'Red — customer photo' },
				}),
			}),
		);
		expect(reviews.create).toHaveBeenCalledTimes(1);
	});

	it('still writes alt text when the product has gone', async () => {
		const { service, assets } = build({ product: null });
		const photo = {
			id: 'm1',
			purpose: 'review',
			uploadedBy: { type: 'customer', id: 'c1' },
			processing: { state: 'ready' },
			text: { alt: {}, title: {}, caption: {} },
		};
		assets.findManyByIds.mockResolvedValue([photo]);
		await service.submit('c1', { ...(submit as object), imageAssetIds: ['m1'] } as never);
		expect(assets.update).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.objectContaining({ alt: { en: 'customer photo', fr: 'photo client' } }),
			}),
		);
	});

	it('shows moderators photo previews, public or signed', async () => {
		const { service, assets } = build();
		assets.findManyByIds.mockResolvedValue([
			{
				id: 'm1',
				visibility: 'public',
				derivatives: [
					derivative('review_thumb', 100),
					derivative('review_thumb', 200),
					derivative('review_full'),
				],
			},
			{ id: 'm2', visibility: 'private', derivatives: [derivative('review_full')] },
		]);
		const page = await service.adminList({ page: 1, pageSize: 20 } as never);
		expect(page.items[0]).toMatchObject({ productName: 'Red', customerName: 'Asha' });
		expect(page.items[0]?.photos).toEqual([
			{
				assetId: 'm1',
				thumbUrl: 'https://cdn.test/k/review_thumb/200',
				fullUrl: 'https://cdn.test/k/review_full/100',
			},
			{ assetId: 'm2', thumbUrl: null, fullUrl: 'https://signed.test' },
		]);
	});

	it('falls back to the email, then to nothing', async () => {
		const email = build({ product: null });
		email.customers.findById.mockResolvedValue({ email: 'a@example.test' });
		expect((await email.service.adminList({} as never)).items[0]).toMatchObject({
			productName: null,
			customerName: 'a@example.test',
		});
		const gone = build();
		gone.customers.findById.mockResolvedValue(null);
		expect((await gone.service.adminList({} as never)).items[0]?.customerName).toBeNull();
	});

	it('approves, keeping the photos', async () => {
		const { service, reviews } = build();
		await service.moderate('a1', 'r1', { decision: 'approve', note: 'Good' } as never);
		expect(reviews.moderate).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', note: 'Good' }));
		expect(reviews.moderate.mock.calls[0]?.[0 as never]).not.toHaveProperty('imageAssetIds');
		expect(reviews.recomputeAggregate).toHaveBeenCalledWith('p1');
	});

	it('rejects, dropping the photos', async () => {
		const { service, reviews } = build();
		await service.moderate('a1', 'r1', { decision: 'reject' } as never);
		expect(reviews.moderate).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'rejected', note: undefined, imageAssetIds: [] }),
		);
	});

	it('refuses an unknown review, or one that vanished mid-way', async () => {
		await expect(
			build({ review: null }).service.moderate('a1', 'r1', { decision: 'approve' } as never),
		).rejects.toBeInstanceOf(NotFoundException);
		await expect(
			build({ moderated: null }).service.moderate('a1', 'r1', { decision: 'approve' } as never),
		).rejects.toBeInstanceOf(NotFoundException);
	});
});

describe('ContentBlocksService', () => {
	const banner = (overrides: Record<string, unknown> = {}) => ({
		id: 'm1',
		purpose: 'banner',
		visibility: 'public',
		width: 100,
		height: 50,
		deletedAt: null,
		processing: { state: 'ready' },
		text: { alt: {}, title: {}, caption: {} },
		derivatives: [derivative('banner')],
		dominantColor: null,
		thumbHash: null,
		...overrides,
	});
	const input = (overrides: Record<string, unknown> = {}) =>
		({
			ownerType: 'home',
			ownerId: null,
			position: 'hero',
			slot: 'main',
			images: { desktop: 'm1', tablet: null, phone: null },
			containsText: false,
			localeImages: {},
			heading: {},
			subheading: {},
			ctaLabel: {},
			link: null,
			alt: { en: 'A', fr: 'B' },
			status: 'draft',
			startsAt: null,
			endsAt: null,
			...overrides,
		}) as never;
	const build = (found: unknown[] = [banner()], existing: unknown = null) => {
		const blocks = {
			list: vi.fn(async () => ['block']),
			findByKey: vi.fn(async () => existing),
			save: vi.fn(async () => {}),
			deleteByKey: vi.fn(async () => {}),
			listLive: vi.fn(async () => [] as unknown[]),
		};
		const assets = { findManyByIds: vi.fn(async () => found), restore: vi.fn(async () => {}) };
		const settings = { get: vi.fn(async () => null as unknown), set: vi.fn(async () => {}) };
		const storage = { getUrl: (key: string) => `https://cdn.test/${key}` };
		const service = new ContentBlocksService(
			blocks as never,
			assets as never,
			settings as never,
			storage as never,
			{
				locales: ['en', 'fr'],
			} as never,
		);
		return { service, blocks, assets, settings };
	};

	it('lists by owner', async () => {
		expect(await build().service.list({ ownerType: 'home' } as never)).toEqual(['block']);
	});

	it.each([
		['missing', []],
		['deleted but not by the banner rule', [banner({ purpose: 'product' })]],
		['not ready', [banner({ processing: { state: 'queued' } })]],
		['deleted', [banner({ deletedAt: 'x' })]],
	])('refuses an image that is %s', async (_label, found) => {
		expect((await statusOf(build(found).service.upsert(input()))).status).toBe(422);
	});

	it('needs alt text in every language to go live', async () => {
		const refused = await statusOf(build().service.upsert(input({ status: 'active', alt: { en: 'A', fr: ' ' } })));
		expect(JSON.stringify(refused.body)).toContain('fr');
		await expect(build().service.upsert(input({ status: 'active' }))).resolves.toMatchObject({
			key: expect.any(String),
		});
		expect((await statusOf(build().service.upsert(input({ status: 'active', alt: {} })))).status).toBe(422);
	});

	it('keeps the id of the block it replaces', async () => {
		const saved = await build([banner()], { id: 'cbk_old' }).service.upsert(input());
		expect(saved.id).toBe('cbk_old');
		expect((await build().service.upsert(input())).id).toMatch(/^cbk_/);
	});

	it('removes, and refuses a stranger', async () => {
		await expect(build().service.remove('k')).rejects.toBeInstanceOf(NotFoundException);
		const { service, blocks } = build([], { id: 'x' });
		await service.remove('k');
		expect(blocks.deleteByKey).toHaveBeenCalledWith('k');
	});

	it('reads and sets the hero layout', async () => {
		const { service, settings } = build();
		expect(await service.heroLayout()).toBe('hero_full');
		settings.get.mockResolvedValue({ heroLayout: 'hero_split' });
		expect(await service.heroLayout()).toBe('hero_split');
		expect(await service.setHeroLayout('hero_full' as never)).toBe('hero_full');
		expect(settings.set).toHaveBeenCalledWith('storefront.home', { heroLayout: 'hero_full' });
	});

	const block = (overrides: Record<string, unknown> = {}) => ({
		key: 'k',
		position: 'hero',
		slot: 'main',
		containsText: false,
		images: { desktop: 'm1', tablet: 'm1', phone: null },
		localeImages: {},
		heading: { en: 'H', fr: 'T' },
		subheading: { en: 'S' },
		ctaLabel: {},
		link: null,
		alt: { en: 'A', fr: 'B' },
		...overrides,
	});

	it('resolves live banners for a language, with fallbacks', async () => {
		const { service, blocks } = build();
		blocks.listLive.mockResolvedValue([block()]);
		const response = await service.storefront({ ownerType: 'home', locale: 'fr' } as never);
		expect(response.heroLayout).toBe('hero_full');
		expect(response.banners[0]).toMatchObject({ heading: 'T', subheading: 'S', ctaLabel: null, alt: 'B' });
		expect(response.banners[0]?.images.tablet).not.toBeNull();
		expect(response.banners[0]?.images.phone).toBeNull();
		expect(blocks.listLive).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null }));
	});

	it('drops a banner with no desktop image, and uses the English alt', async () => {
		const { service, blocks } = build();
		blocks.listLive.mockResolvedValue([
			block({ images: { desktop: 'gone', tablet: null, phone: null } }),
			block({ alt: { en: 'A' }, key: 'k2' }),
			block({ alt: {}, key: 'k3' }),
		]);
		const response = await service.storefront({ ownerType: 'category', ownerId: 'c1', locale: 'fr' } as never);
		expect(response.banners.map((row) => row.alt)).toEqual(['A', '']);
	});

	it('uses the art for the language and drops live text when the art carries it', async () => {
		const { service, blocks } = build([banner(), banner({ id: 'm2' })]);
		blocks.listLive.mockResolvedValue([
			block({ containsText: true, localeImages: { fr: { desktop: 'm2', tablet: null, phone: null } } }),
		]);
		const fr = await service.storefront({ ownerType: 'home', locale: 'fr' } as never);
		expect(fr.banners[0]).toMatchObject({ heading: null, subheading: null });
		expect(fr.banners[0]?.images.desktop.assetId).toBe('m2');
		const en = await service.storefront({ ownerType: 'home', locale: 'en' } as never);
		expect(en.banners[0]?.images.desktop.assetId).toBe('m1');
	});
});

describe('YouTubeService', () => {
	const video = { videoId: 'dQw4w9WgXcQ', title: 'T', thumbnailUrl: 'u', publishedAt: 'p' };
	const build = (stored: unknown = null, feed: unknown = null) => {
		const youtube = { findVideo: vi.fn(async () => video as unknown) };
		const settings = {
			get: vi.fn(async (key: string) => (key === 'youtube' ? stored : feed)),
			set: vi.fn(async () => {}),
		};
		return { service: new YouTubeService(youtube as never, settings as never), youtube, settings };
	};
	const stored = {
		channelHandle: '@a',
		channelId: 'UC',
		uploadsPlaylistId: 'UU',
		displayCount: 2,
		railPlacements: ['home'],
	};

	it('validates a pasted link', async () => {
		const { service, youtube } = build();
		expect(await service.validate('https://youtu.be/dQw4w9WgXcQ')).toEqual({
			videoId: 'dQw4w9WgXcQ',
			title: 'T',
			thumbnailUrl: 'u',
		});
		expect((await statusOf(service.validate('not a link at all'))).status).toBe(422);
		youtube.findVideo.mockResolvedValue(null);
		expect((await statusOf(service.validate('dQw4w9WgXcQ'))).status).toBe(404);
	});

	it('reads defaults, and forgets the playlist when the handle changes', async () => {
		expect((await build().service.getSettings()).channelHandle).toBe('@SahaTextile');
		const { service } = build(stored);
		expect(await service.updateSettings({ channelHandle: '@b' } as never)).toMatchObject({
			channelId: null,
			uploadsPlaylistId: null,
		});
		expect(await service.updateSettings({ channelHandle: '@a', displayCount: 3 } as never)).toMatchObject({
			channelId: 'UC',
			displayCount: 3,
		});
		expect((await service.updateSettings({ displayCount: 4 } as never)).uploadsPlaylistId).toBe('UU');
	});

	it('serves the rail only where it is switched on, and cut to the display count', async () => {
		expect(await build(stored).service.rail('product')).toEqual({ videos: [] });
		expect(await build(stored).service.rail('home')).toEqual({ videos: [] });
		const { service } = build(stored, { videos: [1, 2, 3] });
		expect((await service.rail('home')).videos).toEqual([1, 2]);
	});
});

describe('media controllers', () => {
	const principal = { userId: 'a1' } as never;

	it('hands library work to the service as the signed-in operator', async () => {
		const media = {
			library: vi.fn(async () => 'library'),
			listRoles: vi.fn(async () => 'roles'),
			updateRole: vi.fn(async () => 'role'),
			presign: vi.fn(async () => 'signed'),
			finalize: vi.fn(async () => 'final'),
			status: vi.fn(async () => 'status'),
			get: vi.fn(async () => 'item'),
			updateText: vi.fn(async () => 'text'),
			reprocess: vi.fn(async () => 'again'),
			remove: vi.fn(async () => undefined),
		};
		const controller = new AdminMediaController(media as never);
		expect(await controller.list({} as never)).toBe('library');
		expect(await controller.roles()).toBe('roles');
		expect(await controller.updateRole(principal, 'card', {} as never)).toBe('role');
		expect(await controller.presign(principal, {} as never)).toBe('signed');
		expect(media.presign).toHaveBeenCalledWith({ type: 'admin', id: 'a1' }, {});
		expect(await controller.finalize(principal, 'm')).toBe('final');
		expect(await controller.status(principal, 'm')).toBe('status');
		expect(await controller.get('m')).toBe('item');
		expect(await controller.updateText(principal, 'm', {} as never)).toBe('text');
		expect(await controller.reprocess(principal, 'm')).toBe('again');
		await controller.remove(principal, 'm');
		expect(media.remove).toHaveBeenCalledWith('a1', 'm');
	});

	it('hands banner and video work to the services', async () => {
		const blocks = {
			list: vi.fn(async () => 'blocks'),
			upsert: vi.fn(async () => 'saved'),
			remove: vi.fn(async () => undefined),
			heroLayout: vi.fn(async () => 'hero_full'),
			setHeroLayout: vi.fn(async () => 'hero_split'),
		};
		const youtube = {
			validate: vi.fn(async () => 'valid'),
			getSettings: vi.fn(async () => 'settings'),
			updateSettings: vi.fn(async () => 'updated'),
		};
		const controller = new AdminContentController(blocks as never, youtube as never);
		expect(await controller.list({} as never)).toBe('blocks');
		expect(await controller.save({} as never)).toBe('saved');
		await controller.remove('k');
		expect(blocks.remove).toHaveBeenCalledWith('k');
		expect(await controller.heroLayout()).toEqual({ heroLayout: 'hero_full' });
		expect(await controller.setHeroLayout({ heroLayout: 'hero_split' } as never)).toEqual({
			heroLayout: 'hero_split',
		});
		expect(await controller.validate({ input: 'x' } as never)).toBe('valid');
		expect(await controller.settings()).toBe('settings');
		expect(await controller.updateSettings({} as never)).toBe('updated');
	});

	it('hands review moderation to the service', async () => {
		const reviews = { adminList: vi.fn(async () => 'list'), moderate: vi.fn(async () => 'done') };
		const controller = new AdminReviewsController(reviews as never);
		expect(await controller.list({} as never)).toBe('list');
		expect(await controller.moderate(principal, 'r', {} as never)).toBe('done');
		expect(reviews.moderate).toHaveBeenCalledWith('a1', 'r', {});
	});

	it('serves public media reads', async () => {
		const controller = new StorefrontMediaController(
			{ uploadRules: () => 'rules' } as never,
			{ storefront: async () => 'banners' } as never,
			{ rail: async () => 'rail' } as never,
		);
		expect(controller.rules()).toBe('rules');
		expect(await controller.banners({} as never)).toBe('banners');
		expect(await controller.rail({ placement: 'home' } as never)).toBe('rail');
	});

	it('uses the session as the review owner, and refuses a guest', async () => {
		const media = { finalize: vi.fn(async () => 'final'), status: vi.fn(async () => 'status') };
		const reviews = { presignPhoto: vi.fn(async () => 'signed'), submit: vi.fn(async () => 'saved') };
		const controller = new StorefrontReviewsController(media as never, reviews as never);
		const shopper = { userId: 'c1' } as never;
		expect(await controller.presign(shopper, {} as never)).toBe('signed');
		expect(await controller.finalize(shopper, 'm')).toBe('final');
		expect(media.finalize).toHaveBeenCalledWith({ type: 'customer', id: 'c1' }, 'm');
		expect(await controller.status(shopper, 'm')).toBe('status');
		expect(await controller.submit(shopper, {} as never)).toBe('saved');
		expect(() => controller.submit(undefined, {} as never)).toThrow(UnauthorizedException);
	});
});
