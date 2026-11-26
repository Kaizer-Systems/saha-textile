import type { LegalPage } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { LegalPagesService } from '../src/legal/legal-pages.service';

const stored = (): LegalPage => ({
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
});

/** A share photo with two ready versions, each with its own link-preview file. */
const sharePhoto = {
	id: 'med_share',
	visibility: 'public',
	width: 1200,
	height: 628,
	dominantColor: null,
	thumbHash: null,
	deletedAt: null,
	text: { alt: {}, caption: {} },
	versions: [
		{ id: 'ver_a', state: 'ready' },
		{ id: 'ver_b', state: 'ready' },
	],
	derivatives: ['ver_a', 'ver_b'].map((versionId) => ({
		role: 'share',
		storageKey: `share-${versionId}.jpg`,
		width: 1200,
		height: 628,
		byteSize: 1,
		format: 'image/jpeg',
		roleVersion: 1,
		versionId,
	})),
};

const harness = (page: LegalPage = stored()) => {
	const pages = new Map<string, LegalPage>([['privacy-policy', page]]);
	const repo = {
		list: async () => [...pages.values()],
		find: async (slug: string) => pages.get(slug) ?? null,
		save: vi.fn(async (page: LegalPage) => void pages.set(page.slug, page)),
		createIfMissing: async () => false,
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new LegalPagesService(
		repo as never,
		LanguageStore.fixed(['en', 'bn']),
		{ findById: async () => ({ displayName: 'Moulik' }) } as never,
		{ findById: async (id: string) => (id === sharePhoto.id ? sharePhoto : null) } as never,
		{ getUrl: (key: string) => key } as never,
		audit as never,
	);
	return { service, repo, audit };
};

describe('legal pages (Legal Pages brief)', () => {
	it('shares the version of the photo chosen in Admin › Pages, and the first ready one when none was stored', async () => {
		const chosen = harness({ ...stored(), metaImageAssetId: sharePhoto.id, metaImageVersionId: 'ver_b' });
		expect((await chosen.service.publicPage('privacy-policy', 'en')).shareImageUrl).toBe('share-ver_b.jpg');
		expect((await chosen.service.get('privacy-policy')).metaImageUrl).toBe('share-ver_b.jpg');
		const older = harness({ ...stored(), metaImageAssetId: sharePhoto.id, metaImageVersionId: null });
		expect((await older.service.publicPage('privacy-policy', 'en')).shareImageUrl).toBe('share-ver_a.jpg');
	});

	it('refuses a save missing Title or Content in a shop language, and says which', async () => {
		const { service, repo } = harness();
		await expect(
			service.save('adm_1', 'privacy-policy', {
				title: { en: 'Privacy Policy', bn: 'গোপনীয়তা নীতি' },
				content: { en: '<p>We keep</p>', bn: '<p></p>' },
				metaTitle: {},
				metaDescription: {},
				metaImageAssetId: null,
				metaImageVersionId: null,
			}),
		).rejects.toMatchObject({
			response: { issues: [{ path: ['content', 'bn'], code: 'legal_page_incomplete' }] },
		});
		expect(repo.save).not.toHaveBeenCalled();
	});

	it('saves a cleaned new version, keeps the one it replaces, audits, and the shop reads it with a date', async () => {
		const { service, repo, audit } = harness();
		const saved = await service.save(
			'adm_1',
			'privacy-policy',
			{
				title: { en: 'Privacy Policy', bn: 'গোপনীয়তা নীতি' },
				content: { en: '<p>New</p><script>x</script>', bn: '<p>নতুন</p>' },
				metaTitle: {},
				metaDescription: {},
				metaImageAssetId: null,
				metaImageVersionId: null,
			},
			new Date('2026-11-16T10:00:00.000Z'),
		);
		expect(saved.page.version).toBe(2);
		expect(saved.updatedByName).toBe('Moulik');
		expect(repo.save).toHaveBeenCalledWith(
			expect.objectContaining({ version: 2 }),
			expect.objectContaining({ version: 1 }),
		);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'legal_page.save', entityId: 'privacy-policy' }),
		);
		const shop = await service.publicPage('privacy-policy', 'bn');
		expect(shop).toMatchObject({
			title: 'গোপনীয়তা নীতি',
			content: '<p>নতুন</p>',
			updatedAt: '2026-11-16T10:00:00.000Z',
		});
		expect(shop.content).not.toContain('script');
		expect((await service.publicPage('privacy-policy', 'hi')).title).toBe('Privacy Policy');
	});

	it('answers not found for an address that is not one of the four pages', async () => {
		const { service } = harness();
		await expect(service.publicPage('size-guide', 'en')).rejects.toThrow('No such page');
		await expect(service.get('terms-conditions')).rejects.toThrow('No such page');
	});
});
