import type { LegalPage } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { LegalPagesService } from '../src/legal/legal-pages.service';

const stored = (over: Partial<LegalPage> = {}): LegalPage => ({
	slug: 'privacy-policy',
	title: { en: 'Privacy Policy', bn: 'গোপনীয়তা নীতি' },
	content: { en: '<p>We keep</p>', bn: '<p>আমরা রাখি</p>' },
	metaTitle: {},
	metaDescription: {},
	metaImageAssetId: null,
	metaImageVersionId: null,
	version: 1,
	updatedAt: '2026-11-15T00:00:00.000Z',
	updatedBy: null,
	...over,
});
const photo = (id: string, roles: Array<{ role: string; width: number }>, over: Record<string, unknown> = {}) => ({
	id,
	visibility: 'public',
	width: 1200,
	height: 628,
	dominantColor: null,
	thumbHash: null,
	deletedAt: null,
	text: { alt: {}, caption: {} },
	versions: [{ id: 'ver_a', state: 'ready' }],
	derivatives: roles.map(({ role, width }) => ({
		role,
		storageKey: `${id}-${role}-${width}.jpg`,
		width,
		height: 400,
		byteSize: 1,
		format: 'image/jpeg',
		roleVersion: 1,
		versionId: 'ver_a',
	})),
	...over,
});

function harness(
	options: { pages?: LegalPage[]; admins?: unknown; photos?: unknown[]; audit?: boolean; failPhotos?: boolean } = {},
) {
	const pages = new Map<string, LegalPage>((options.pages ?? [stored()]).map((page) => [page.slug, page]));
	const audit = { append: vi.fn(async () => undefined) };
	const photos = (options.photos ?? []) as Array<{ id: string }>;
	const service = new LegalPagesService(
		{
			list: async () => [...pages.values()],
			find: async (slug: string) => pages.get(slug) ?? null,
			save: async (page: LegalPage) => void pages.set(page.slug, page),
		} as never,
		LanguageStore.fixed(['en', 'bn']),
		(options.admins ?? { findById: async () => null }) as never,
		{
			findById: async (id: string) =>
				options.failPhotos ? Promise.reject(new Error('down')) : (photos.find((row) => row.id === id) ?? null),
		} as never,
		{ getUrl: (key: string) => key } as never,
		(options.audit === false ? null : audit) as never,
	);
	return { service, audit };
}

describe('legal pages: the remaining cases', () => {
	it('lists the stored pages in their fixed order, leaving out ones not made yet', async () => {
		const { service } = harness({
			pages: [stored({ slug: 'terms-conditions' }), stored({ slug: 'privacy-policy' })],
		});
		const rows = await service.list();
		expect(rows.map((row) => row.page.slug)).toEqual(['privacy-policy', 'terms-conditions']);
		expect(rows).toHaveLength(2);
	});

	it('names who saved last by any name they have, or nobody when unknown or unreadable', async () => {
		const findById = vi
			.fn()
			.mockResolvedValueOnce({ displayName: null, username: 'rina' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: 'rina@example.test' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: null })
			.mockRejectedValueOnce(new Error('down'));
		const { service } = harness({ pages: [stored({ updatedBy: 'adm_9' })], admins: { findById } });
		const names = [];
		for (let index = 0; index < 4; index += 1) names.push((await service.get('privacy-policy')).updatedByName);
		expect(names).toEqual(['rina', 'rina@example.test', null, null]);
	});

	it('shares the largest picture when the photo has no link-preview size, and nothing for a photo gone, deleted or unreadable', async () => {
		const page = (metaImageAssetId: string) => [stored({ metaImageAssetId })];
		const photos = [
			photo('med_wide', [
				{ role: 'banner', width: 800 },
				{ role: 'banner', width: 1600 },
			]),
			photo('med_bare', []),
			photo('med_deleted', [{ role: 'share', width: 1200 }], { deletedAt: '2026-11-20T00:00:00.000Z' }),
		];
		const share = async (assetId: string, failPhotos = false) =>
			(await harness({ pages: page(assetId), photos, failPhotos }).service.publicPage('privacy-policy', 'en'))
				.shareImageUrl;
		expect(await share('med_wide')).toBe('med_wide-banner-1600.jpg');
		expect(await share('med_bare')).toBeNull();
		expect(await share('med_deleted')).toBeNull();
		expect(await share('med_none')).toBeNull();
		expect(await share('med_wide', true)).toBeNull();
	});

	it('records nothing when there is no audit store', async () => {
		const { service, audit } = harness({ audit: false });
		await service.save('adm_1', 'privacy-policy', {
			title: { en: 'Privacy Policy', bn: 'গোপনীয়তা নীতি' },
			content: { en: '<p>We keep</p>', bn: '<p>আমরা রাখি</p>' },
			metaTitle: {},
			metaDescription: {},
			metaImageAssetId: null,
			metaImageVersionId: null,
		} as never);
		expect(audit.append).not.toHaveBeenCalled();
	});
});
