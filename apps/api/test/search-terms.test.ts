import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SearchTerm } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
	AdminSearchTermsController,
	AdminStorefrontSettingsController,
} from '../src/catalog/admin-search-terms.controller';
import { CatalogService } from '../src/catalog/catalog.service';
import { SearchTermsService } from '../src/catalog/search-terms.service';
import { SearchVocabularyService } from '../src/catalog/search-vocabulary.service';
import { TaxonomyService } from '../src/catalog/taxonomy.service';

const tree = [
	{ id: 'cat_sarees', name: { en: 'Sarees' }, ancestors: [] },
	{ id: 'cat_red_white', name: { en: 'Red & White' }, ancestors: ['cat_sarees'] },
	{ id: 'cat_suits', name: { en: 'Suits' }, ancestors: [] },
];
const product = (id: string, categoryIds: string[], status = 'live') => ({
	id,
	categoryIds,
	status,
	title: { en: id },
});
const catalogue = [
	product('prd_1', ['cat_red_white']),
	product('prd_2', ['cat_suits']),
	product('prd_3', ['cat_sarees']),
];

function setup(options: { audit?: boolean } = {}) {
	const stored = new Map<string, SearchTerm>();
	const terms = {
		list: vi.fn(async () => ({ items: [...stored.values()], total: stored.size, page: 1, pageSize: 20 })),
		listLive: vi.fn(async () => [...stored.values()].filter((term) => term.status === 'live')),
		findById: vi.fn(async (id: string) => stored.get(id) ?? null),
		findManyByIds: vi.fn(async (ids: readonly string[]) => ids.flatMap((id) => stored.get(id) ?? [])),
		save: vi.fn(async (term: SearchTerm) => (stored.set(term.id, term), term)),
		remove: vi.fn(async (id: string) => void stored.delete(id)),
	};
	const categories = { tree: vi.fn(async () => tree) };
	const products = {
		findById: vi.fn(async (id: string) => catalogue.find((row) => row.id === id) ?? null),
		list: vi.fn(async (filter: { categoryIds?: string[] }) => {
			const items = catalogue.filter(
				(row) => !filter.categoryIds || row.categoryIds.some((id) => filter.categoryIds?.includes(id)),
			);
			return { items, total: items.length, page: 1, pageSize: 200 };
		}),
	};
	let saved: unknown = null;
	const settings = {
		get: vi.fn(async () => saved),
		set: vi.fn(async (_key: string, value: unknown) => void (saved = value)),
	};
	const catalog = { syncSearchMany: vi.fn(async (rows: unknown[]) => rows.length) };
	const cards = {
		cardsForIds: vi.fn(async () => [
			{ id: 'prd_1', title: 'Laal Paar', image: { roles: { card: [{ url: 'u' }] } } },
		]),
	};
	const search = { updateSynonyms: vi.fn(async () => undefined) };
	const audit = { append: vi.fn(async () => undefined) };
	const vocabulary = new SearchVocabularyService(terms as never, categories as never, settings as never);
	const service = new SearchTermsService(
		terms as never,
		categories as never,
		products as never,
		settings as never,
		{ locales: ['en', 'bn'] } as never,
		catalog as never,
		cards as never,
		vocabulary,
		search as never,
		options.audit === false ? null : (audit as never),
	);
	return { service, stored, catalog, search, audit, settings, products, terms, cards, vocabulary };
}

const body = (over: Record<string, unknown> = {}) => ({
	name: { en: ' Puja ', bn: 'পুজো' },
	spellings: { en: ['Pujo', 'puja'], bn: [] },
	categoryIds: ['cat_red_white'],
	productIds: [],
	status: 'live' as const,
	...over,
});

const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((row) => row.id).sort();

describe('search words', () => {
	it('saves a live word, cleans it, records it and re-indexes what it tags', async () => {
		const { service, stored, catalog, search, audit } = setup();
		const { id } = await service.save(null, body(), 'admin_1');
		await service.pending;
		expect(stored.get(id)).toMatchObject({
			name: { en: 'Puja', bn: 'পুজো' },
			spellings: { en: ['pujo'] },
			status: 'live',
		});
		expect(search.updateSynonyms).toHaveBeenCalledWith(expect.objectContaining({ pujo: ['puja', 'পুজো'] }));
		expect(ids(catalog.syncSearchMany.mock.calls[0]?.[0])).toEqual(['prd_1']);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'catalog.search_term.save', actorUserId: 'admin_1' }),
		);
	});

	it('refuses Live with the gaps, and refuses unknown tags and a missing English name', async () => {
		const { service, stored } = setup();
		await expect(service.save(null, body({ name: { en: 'Puja' }, categoryIds: [] }), null)).rejects.toMatchObject({
			response: {
				issues: [
					expect.objectContaining({ path: ['name', 'bn'] }),
					expect.objectContaining({ path: ['tags', ''] }),
				],
			},
		});
		await expect(service.save(null, body({ categoryIds: ['nope'] }), null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(service.save(null, body({ productIds: ['nope'] }), null)).rejects.toThrow('Unknown product');
		await expect(service.save(null, body({ name: { bn: 'পুজো' } }), null)).rejects.toThrow('English');
		await expect(service.save('missing', body(), null)).rejects.toBeInstanceOf(NotFoundException);
		expect(stored.size).toBe(0);
		await expect(
			service.save(null, body({ status: 'draft', name: { en: 'Puja' }, categoryIds: [] }), null),
		).resolves.toMatchObject({
			id: expect.stringMatching(/^sterm_/),
		});
	});

	it('re-indexes the products a word used to tag as well as the new ones', async () => {
		const { service, catalog } = setup();
		const { id } = await service.save(null, body(), null);
		await service.save(id, body({ categoryIds: [], productIds: ['prd_2'] }), null);
		await service.pending;
		expect(ids(catalog.syncSearchMany.mock.calls[1]?.[0])).toEqual(['prd_1', 'prd_2']);
	});

	it('switches status in bulk, reporting words that cannot go live', async () => {
		const { service, stored } = setup();
		const good = await service.save(null, body({ status: 'draft' }), null);
		const bad = await service.save(null, body({ status: 'draft', name: { en: 'Bare' }, categoryIds: [] }), null);
		expect(await service.setStatus([good.id, bad.id, 'gone'], 'live', null)).toEqual({
			updated: [good.id],
			refused: [
				{
					id: bad.id,
					gaps: [
						{ field: 'name', locale: 'bn' },
						{ field: 'tags', locale: null },
					],
				},
			],
		});
		expect(stored.get(good.id)?.status).toBe('live');
		expect(await service.setStatus([good.id], 'live', null)).toEqual({ updated: [], refused: [] });
		expect((await service.setStatus([good.id], 'draft', null)).updated).toEqual([good.id]);
	});

	it('lists, shows a word with its products, and deletes it', async () => {
		const { service, stored } = setup();
		const { id } = await service.save(null, body({ productIds: ['prd_1', 'prd_3'] }), null);
		expect((await service.list({ page: 1, pageSize: 20 })).total).toBe(1);
		expect((await service.detail(id)).products).toEqual([
			{ id: 'prd_1', name: 'Laal Paar', image: 'u' },
			{ id: 'prd_3', name: 'prd_3', image: null },
		]);
		await service.remove(id, null);
		expect(stored.size).toBe(0);
		await expect(service.remove(id, null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('logs, and does not throw, when the index cannot be refreshed', async () => {
		const { service, search } = setup();
		search.updateSynonyms.mockRejectedValueOnce(new Error('down'));
		await service.save(null, body(), null);
		await expect(service.pending).resolves.toBeUndefined();
	});
});

describe('search word edges', () => {
	it('skips a tagged product deleted before the re-index, and pages through a long category', async () => {
		const { service, catalog, products } = setup();
		const { id } = await service.save(null, body({ productIds: ['prd_2'] }), null);
		await service.pending;
		products.findById.mockResolvedValueOnce(null);
		products.list
			.mockResolvedValueOnce({ items: [catalogue[0]!], total: 5, page: 1, pageSize: 200 })
			.mockResolvedValueOnce({ items: [], total: 5, page: 2, pageSize: 200 });
		await service.remove(id, null);
		await service.pending;
		expect(ids(catalog.syncSearchMany.mock.calls.at(-1)?.[0])).toEqual(['prd_1']);
		expect(products.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
	});

	it('shows a tagged product with no photo, an untitled one by its id, and drops one that is gone', async () => {
		const { service, cards, products } = setup();
		const { id } = await service.save(null, body({ productIds: ['prd_1', 'prd_2', 'prd_3'] }), null);
		cards.cardsForIds.mockResolvedValueOnce([{ id: 'prd_1', title: 'Laal Paar', image: null }] as never);
		products.findById.mockResolvedValueOnce({ ...catalogue[1]!, title: {} } as never).mockResolvedValueOnce(null);
		expect((await service.detail(id)).products).toEqual([
			{ id: 'prd_1', name: 'Laal Paar', image: null },
			{ id: 'prd_2', name: 'prd_2', image: null },
		]);
	});

	it('saves without an audit log wired in', async () => {
		const { service, stored, audit } = setup({ audit: false });
		await service.save(null, body(), null);
		expect(stored.size).toBe(1);
		expect(audit.append).not.toHaveBeenCalled();
	});

	it('loads the vocabulary again after a failed read', async () => {
		const { vocabulary, terms } = setup();
		terms.listLive.mockRejectedValueOnce(new Error('db down'));
		await expect(vocabulary.current()).rejects.toThrow('db down');
		await expect(vocabulary.current()).resolves.toMatchObject({ synonyms: {} });
		expect(terms.listLive).toHaveBeenCalledTimes(2);
	});
});

describe('storefront settings › search', () => {
	it('starts empty, saves the show-first categories and re-indexes the whole shop', async () => {
		const { service, catalog, settings } = setup();
		expect(await service.getSearchSettings()).toEqual({ showFirstCategoryIds: [] });
		await service.saveSearchSettings({ showFirstCategoryIds: ['cat_sarees', 'cat_sarees'] }, 'admin_1');
		await service.pending;
		expect(settings.set).toHaveBeenCalledWith('storefront.search', { showFirstCategoryIds: ['cat_sarees'] });
		expect(ids(catalog.syncSearchMany.mock.calls[0]?.[0])).toEqual(['prd_1', 'prd_2', 'prd_3']);
		expect(await service.getSearchSettings()).toEqual({ showFirstCategoryIds: ['cat_sarees'] });
		await expect(service.saveSearchSettings({ showFirstCategoryIds: ['nope'] }, null)).rejects.toThrow(
			'Unknown category',
		);
	});

	it('keeps the saved settings and logs when the shop cannot be re-indexed', async () => {
		const { service, search, settings } = setup();
		search.updateSynonyms.mockRejectedValueOnce(new Error('down'));
		await service.saveSearchSettings({ showFirstCategoryIds: ['cat_suits'] }, null);
		await expect(service.pending).resolves.toBeUndefined();
		expect(settings.set).toHaveBeenCalledWith('storefront.search', { showFirstCategoryIds: ['cat_suits'] });
	});
});

describe('search word routes', () => {
	it('pass the signed-in admin through', async () => {
		const service = {
			list: vi.fn(async () => 'list'),
			detail: vi.fn(async () => 'detail'),
			save: vi.fn(async () => 'saved'),
			setStatus: vi.fn(async () => 'status'),
			remove: vi.fn(async () => undefined),
			getSearchSettings: vi.fn(async () => 'settings'),
			saveSearchSettings: vi.fn(async () => 'saved settings'),
		};
		const terms = new AdminSearchTermsController(service as never);
		const admin = { userId: 'a1' } as never;
		expect(await terms.list({ page: 1, pageSize: 20 })).toBe('list');
		expect(await terms.detail('t1')).toBe('detail');
		expect(await terms.create(body(), admin)).toBe('saved');
		expect(await terms.update('t1', body(), undefined)).toBe('saved');
		expect(service.save).toHaveBeenLastCalledWith('t1', expect.anything(), null);
		expect(await terms.status({ ids: ['t1'], status: 'live' }, admin)).toBe('status');
		await terms.remove('t1', admin);
		expect(service.remove).toHaveBeenCalledWith('t1', 'a1');
		const share = { get: vi.fn(async () => 'share'), save: vi.fn(async () => 'saved share') };
		const settings = new AdminStorefrontSettingsController(service as never, share as never);
		expect(await settings.search()).toBe('settings');
		expect(await settings.saveSearch({ showFirstCategoryIds: [] }, admin)).toBe('saved settings');
		expect(await settings.sharing()).toBe('share');
		const sharing = { xHandle: '', hashtags: true, stripText: '', apps: [] };
		expect(await settings.saveSharing(sharing, admin)).toBe('saved share');
		expect(share.save).toHaveBeenCalledWith(sharing, 'a1');
	});
});

describe('search word wiring', () => {
	it('names the vocabulary outright, so Nest injects it into the services that index', () => {
		for (const type of [CatalogService, TaxonomyService]) {
			const injected = (Reflect.getMetadata('self:paramtypes', type) ?? []) as Array<{ param: unknown }>;
			expect(injected.map((row) => row.param)).toContain(SearchVocabularyService);
		}
	});
});
