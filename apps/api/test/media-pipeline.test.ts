import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ContentBlock, MediaAsset } from '@saha-textile/contracts';
import type { MediaAssetRepository, StoragePort } from '@saha-textile/core-domain';

import { loadConfig } from '../src/config/app-config';
import { ContentBlocksService } from '../src/media/content-blocks.service';
import { MediaService } from '../src/media/media.service';
import { YouTubeService } from '../src/media/youtube.service';

const config = loadConfig({
	JWT_ACCESS_SECRET: 'a'.repeat(32),
	JWT_REFRESH_SECRET: 'b'.repeat(32),
	CSRF_SECRET: 'c'.repeat(32),
});

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	id: 'med_1',
	kind: 'image',
	purpose: 'banner',
	originalStorageKey: 'media/med_1/original.jpg',
	originalFormat: 'image/jpeg',
	originalByteSize: 10,
	width: 2880,
	height: 864,
	slug: 'festive',
	derivatives: [
		{
			role: 'banner',
			storageKey: 'media/med_1/festive-banner-480w-aaaaaaaa.webp',
			width: 480,
			height: 144,
			byteSize: 1,
			format: 'image/webp',
			roleVersion: 1,
		},
	],
	dominantColor: '#aa0000',
	thumbHash: null,
	visibility: 'public',
	processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
	warnings: [],
	servesAsPrimary: false,
	maxDisplayWidth: null,
	renditions: [],
	hlsPlaylistKey: null,
	durationSeconds: null,
	text: { alt: {}, title: {}, caption: {} },
	status: 'draft',
	uploadedBy: { type: 'admin', id: 'adm_1' },
	deletedAt: null,
	...overrides,
});

const storage = {
	getUrl: (key: string) => `https://cdn.test/${key}`,
	createSignedUploadUrl: vi.fn(async ({ key }: { key: string }) => ({
		url: `https://upload.test/${key}`,
		headers: { 'x-amz-acl': 'private' },
	})),
	createSignedDownloadUrl: vi.fn(async ({ key }: { key: string }) => `https://signed.test/${key}`),
} as unknown as StoragePort;

const assetsOf = (rows: MediaAsset[]) =>
	({
		findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
		findManyByIds: vi.fn(async (ids: string[]) => rows.filter((row) => ids.includes(row.id))),
		create: vi.fn(async (row: MediaAsset) => row),
		update: vi.fn(async (row: MediaAsset) => row),
		countReferences: vi.fn(async () => 0),
		restore: vi.fn(),
	}) as unknown as MediaAssetRepository;

const mediaService = (rows: MediaAsset[] = []) =>
	new MediaService(
		assetsOf(rows),
		{ list: async () => [], insertMissing: async () => 0 } as never,
		storage,
		{ enqueue: vi.fn() } as never,
		{ append: vi.fn() } as never,
		config,
	);

describe('MediaService', () => {
	it('refuses an under-floor product photo before any upload URL exists', async () => {
		await expect(
			mediaService().presign(
				{ type: 'admin', id: 'adm_1' },
				{
					purpose: 'product',
					contentType: 'image/jpeg',
					byteSize: 1000,
					fileName: 'a.jpg',
					width: 1200,
					height: 1600,
				},
			),
		).rejects.toBeInstanceOf(UnprocessableEntityException);
		expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
	});

	it('presigns a private original and warns on an off-3:4 photo', async () => {
		const result = await mediaService().presign(
			{ type: 'admin', id: 'adm_1' },
			{
				purpose: 'product',
				contentType: 'image/jpeg',
				byteSize: 1000,
				fileName: 'Red Saree.jpg',
				width: 2400,
				height: 2400,
			},
		);
		expect(result.warnings).toEqual(['aspect_off_target']);
		expect(storage.createSignedUploadUrl).toHaveBeenLastCalledWith(
			expect.objectContaining({ visibility: 'private' }),
		);
	});

	it('quarantines customer uploads', async () => {
		const assets = assetsOf([]);
		const service = new MediaService(
			assets,
			{} as never,
			storage,
			{ enqueue: vi.fn() } as never,
			{ append: vi.fn() } as never,
			config,
		);
		await service.presign(
			{ type: 'customer', id: 'cus_1' },
			{
				purpose: 'review',
				contentType: 'image/jpeg',
				byteSize: 1000,
				fileName: 'x.jpg',
				width: 1000,
				height: 1000,
			},
		);
		expect(vi.mocked(assets.create).mock.calls[0]?.[0]).toMatchObject({
			visibility: 'private',
			uploadedBy: { type: 'customer', id: 'cus_1' },
		});
	});

	it('hides another customer’s upload (BOLA → 404)', async () => {
		const service = mediaService([asset({ purpose: 'review', uploadedBy: { type: 'customer', id: 'cus_2' } })]);
		await expect(service.status({ type: 'customer', id: 'cus_1' }, 'med_1')).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('signs previews of private photos', async () => {
		const service = mediaService([
			asset({ purpose: 'review', visibility: 'private', uploadedBy: { type: 'customer', id: 'cus_1' } }),
		]);
		expect((await service.status({ type: 'customer', id: 'cus_1' }, 'med_1')).previewUrl).toMatch(
			/^https:\/\/signed\.test\//,
		);
	});
});

describe('ContentBlocksService', () => {
	const blocksRepo = (rows: ContentBlock[] = []) => ({
		findByKey: vi.fn(async (key: string) => rows.find((row) => row.key === key) ?? null),
		save: vi.fn(async (row: ContentBlock) => row),
		listLive: vi.fn(async () => rows),
		list: vi.fn(),
		deleteByKey: vi.fn(),
	});
	const settings = { get: vi.fn(async () => null), set: vi.fn() };
	const input = {
		ownerType: 'home' as const,
		ownerId: null,
		position: 'hero' as const,
		slot: 'main',
		images: { desktop: 'med_1', tablet: null, phone: null },
		containsText: false,
		localeImages: {},
		heading: { en: 'Festive edit' },
		subheading: {},
		ctaLabel: {},
		link: null,
		alt: { en: 'Festive sarees' },
		status: 'draft' as const,
		startsAt: null,
		endsAt: null,
	};

	it('refuses an image that is not a processed banner upload', async () => {
		const service = new ContentBlocksService(
			blocksRepo() as never,
			assetsOf([asset({ purpose: 'product' })]),
			settings as never,
			storage,
			config,
		);
		await expect(service.upsert(input)).rejects.toBeInstanceOf(UnprocessableEntityException);
	});

	it('requires alt in every active locale before going live', async () => {
		const service = new ContentBlocksService(
			blocksRepo() as never,
			assetsOf([asset()]),
			settings as never,
			storage,
			config,
		);
		await expect(service.upsert({ ...input, status: 'active' })).rejects.toMatchObject({
			response: { code: 'alt_missing', locales: ['fr'] },
		});
		const saved = await service.upsert({
			...input,
			status: 'active',
			alt: { en: 'Festive sarees', fr: 'Saris de fête' },
		});
		expect(saved.key).toBe('home:-:hero:main');
	});

	it('resolves live banners for the locale, falling back to the default art', async () => {
		const block: ContentBlock = {
			...input,
			id: 'cbk_1',
			key: 'home:-:hero:main',
			status: 'active',
			alt: { en: 'Festive', fr: 'Fête' },
			heading: { en: 'Festive edit', fr: 'Édition festive' },
		};
		const service = new ContentBlocksService(
			blocksRepo([block]) as never,
			assetsOf([asset()]),
			settings as never,
			storage,
			config,
		);
		const { heroLayout, banners } = await service.storefront({ ownerType: 'home', locale: 'fr' });
		expect(heroLayout).toBe('hero_full');
		expect(banners[0]).toMatchObject({ heading: 'Édition festive', alt: 'Fête' });
		expect(banners[0]?.images.desktop.roles.banner?.[0]?.url).toBe(
			'https://cdn.test/media/med_1/festive-banner-480w-aaaaaaaa.webp',
		);
	});
});

describe('YouTubeService', () => {
	it('rejects a non-YouTube link before calling the API', async () => {
		const youtube = { findVideo: vi.fn() };
		await expect(
			new YouTubeService(youtube as never, {} as never).validate('https://vimeo.com/1'),
		).rejects.toBeInstanceOf(UnprocessableEntityException);
		expect(youtube.findVideo).not.toHaveBeenCalled();
	});

	it('serves at most displayCount cached videos, and nothing for a placement that is off', async () => {
		const videos = Array.from({ length: 10 }, (_, index) => ({
			videoId: `vid${String(index).padStart(8, '0')}`,
			title: 't',
			publishedAt: 'p',
			thumbnailUrl: 'u',
		}));
		const settings = {
			get: vi.fn(async (key: string) => (key === 'youtube.feed' ? { videos, fetchedAt: null } : null)),
		};
		const service = new YouTubeService({} as never, settings as never);
		expect((await service.rail('home')).videos).toHaveLength(8);
		expect((await service.rail('pdp')).videos).toHaveLength(0);
	});
});
