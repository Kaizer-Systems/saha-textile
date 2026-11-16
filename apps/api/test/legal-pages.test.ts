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
	version: 1,
	updatedAt: '2026-11-15T00:00:00.000Z',
	updatedBy: null,
});

const harness = () => {
	const pages = new Map<string, LegalPage>([['privacy-policy', stored()]]);
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
		{ findById: async () => null } as never,
		{ getUrl: (key: string) => key } as never,
		audit as never,
	);
	return { service, repo, audit };
};

describe('legal pages (Legal Pages brief)', () => {
	it('refuses a save missing Title or Content in a shop language, and says which', async () => {
		const { service, repo } = harness();
		await expect(
			service.save('adm_1', 'privacy-policy', {
				title: { en: 'Privacy Policy', bn: 'গোপনীয়তা নীতি' },
				content: { en: '<p>We keep</p>', bn: '<p></p>' },
				metaTitle: {},
				metaDescription: {},
				metaImageAssetId: null,
			}),
		).rejects.toMatchObject({
			response: { code: 'legal_page_incomplete', missing: [{ locale: 'bn', field: 'content' }] },
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
