import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Product, ProductDraftWrite, ProductVariant, ShopEvent } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { CatalogService } from '../src/catalog/catalog.service';
import { ProductBulkService } from '../src/catalog/product-bulk.service';
import { ProductDraftsService } from '../src/catalog/product-drafts.service';
import { EventProductsService } from '../src/events/event-products.service';

const both = { en: 'Maroon Saree', bn: 'মেরুন শাড়ি' };
const product = (id: string, over: Record<string, unknown> = {}) =>
	Product.parse({
		id,
		type: 'simple',
		sku: `S-${id}`,
		title: both,
		slug: `saree-${id}`,
		categoryIds: ['c'],
		basePriceINR: 1000,
		media: { gallery: [`img-${id}`], compound: [], altOverrides: {} },
		status: 'disabled',
		...over,
	});
const variant = (productId: string, over: Record<string, unknown> = {}) =>
	ProductVariant.parse({
		id: `var_${productId}`,
		productId,
		sku: `S-${productId}`,
		status: 'live',
		optionSelections: [{ attributeCode: 'base', termCode: 'base' }],
		optionSelectionHash: 'h',
		isBaseVariant: true,
		priceINR: 1000,
		barcode: '890000',
		stock: { tracked: true, quantity: 4, lowStockThreshold: null, allowBackorder: false, held: 1 },
		...over,
	});
const event = (over: Record<string, unknown> = {}) =>
	ShopEvent.parse({ id: 'evt_1', type: 'sale', name: 'Winter', status: 'draft', ...over });

const bulk = (
	rows: Product[],
	options: { events?: ShopEvent[]; facts?: Record<string, boolean>; gaps?: unknown[] } = {},
) => {
	const catalog = {
		takeOff: vi.fn(async () => undefined),
		discontinue: vi.fn(async () => undefined),
		liveReplacement: vi.fn(async (path: string) => {
			if (path === '/product/gone') throw new BadRequestException('no');
			return { kind: 'product', path };
		}),
		deletionFacts: vi.fn(async () => ({
			hasStock: false,
			hasMovements: false,
			hasOrders: false,
			...options.facts,
		})),
		removeNeverLive: vi.fn(async () => undefined),
		inTransaction: vi.fn(async (write: () => Promise<void>) => write()),
		copyExtras: vi.fn(async () => undefined),
		record: vi.fn(async () => undefined),
	};
	const builder = {
		gapsFor: vi.fn(async () => options.gaps ?? []),
		goLive: vi.fn(async () => ({ live: true, gaps: [] })),
		freeSlug: vi.fn(async (base: string) => base),
	};
	const products = {
		findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
		save: vi.fn(async (row: unknown) => row),
	};
	const taken = new Set(['S-p1-C1']);
	const variants = {
		listForProduct: vi.fn(async (id: string) => [variant(id)]),
		findBySku: vi.fn(async (sku: string) => (taken.has(sku) ? variant('x') : null)),
		save: vi.fn(async (row: unknown) => row),
	};
	const bundles = {
		findByProductId: vi.fn(async () => ({
			id: 'bnd_1',
			productId: 'p3',
			bundleType: 'fixed_kit',
			pricePolicy: 'sum_components',
			fixedPriceINR: null,
			groups: [{ code: 'g', label: { en: 'Saree' }, maxSelections: 1, components: [{ productId: 'p1' }] }],
			status: 'live',
		})),
		save: vi.fn(async (row: unknown) => row),
	};
	const events = {
		list: vi.fn(async () => ({ items: options.events ?? [], total: 0, page: 1, pageSize: 1000 })),
		listPublished: vi.fn(async () => []),
	};
	const drafts = { removeForProduct: vi.fn(async () => 1) };
	const service = new ProductBulkService(
		catalog as never,
		builder as never,
		products as never,
		variants as never,
		bundles as never,
		events as never,
		drafts as never,
	);
	return { service, catalog, builder, products, variants, bundles, drafts };
};

describe('ProductBulkService', () => {
	it('puts ready products live and names the rest', async () => {
		const rows = [product('p1'), product('p2', { status: 'live' }), product('p3', { status: 'discontinued' })];
		const { service, builder } = bulk(rows);
		const result = await service.goLive({ ids: ['p1', 'p2', 'p3', 'nope'], dryRun: false }, 'adm');
		expect(result.rows.map((row) => [row.id, row.outcome, row.reason])).toEqual([
			['p1', 'done', null],
			['p2', 'skipped', 'already_live'],
			['p3', 'refused', 'discontinued'],
			['nope', 'refused', 'not_found'],
		]);
		expect(builder.goLive).toHaveBeenCalledTimes(1);
	});

	it('names the gaps, and a dry run changes nothing', async () => {
		const gaps = [{ field: 'name', locale: 'bn' }];
		const needs = bulk([product('p1')], { gaps });
		const refused = await needs.service.goLive({ ids: ['p1'], dryRun: false }, null);
		expect(refused.rows[0]).toMatchObject({ outcome: 'refused', reason: 'needs_work', gaps });
		const ready = bulk([product('p1')]);
		const dry = await ready.service.goLive({ ids: ['p1'], dryRun: true }, null);
		expect(dry).toMatchObject({ dryRun: true, rows: [{ outcome: 'done' }] });
		expect(ready.builder.goLive).not.toHaveBeenCalled();
		ready.builder.goLive.mockResolvedValueOnce({ live: false, gaps } as never);
		expect((await ready.service.goLive({ ids: ['p1'], dryRun: false }, null)).rows[0]).toMatchObject({
			reason: 'needs_work',
		});
	});

	it('takes live products off and leaves the rest', async () => {
		const rows = [product('p1', { status: 'live' }), product('p2'), product('p3', { status: 'discontinued' })];
		const { service, catalog } = bulk(rows);
		const result = await service.takeOff({ ids: ['p1', 'p2', 'p3'], dryRun: false }, 'adm');
		expect(result.rows.map((row) => row.reason)).toEqual([null, 'not_live', 'discontinued']);
		expect(catalog.takeOff).toHaveBeenCalledTimes(1);
	});

	it('discontinues with one redirect, never to a product in the same batch', async () => {
		const rows = [product('p1', { status: 'live' }), product('p2', { status: 'discontinued' })];
		const { service, catalog } = bulk(rows);
		const done = await service.discontinue(
			{ ids: ['p1', 'p2'], dryRun: false, replacementPath: '/collections/sarees' },
			'adm',
		);
		expect(done.rows.map((row) => row.outcome)).toEqual(['done', 'skipped']);
		expect(catalog.discontinue).toHaveBeenCalledWith('p1', '/collections/sarees', 'adm');
		const own = await service.discontinue(
			{ ids: ['p1'], dryRun: false, replacementPath: '/product/saree-p1' },
			'adm',
		);
		expect(own.rows[0]).toMatchObject({ outcome: 'refused', reason: 'replacement_in_batch' });
		const gone = await service.discontinue({ ids: ['p1'], dryRun: true, replacementPath: '/product/gone' }, null);
		expect(gone.rows[0]).toMatchObject({ outcome: 'refused', reason: 'failed' });
	});

	it('copies a product as not live yet, with fresh codes and no stock', async () => {
		const { service, products, variants, catalog } = bulk([product('p1', { status: 'live', featured: true })]);
		const dry = await service.duplicate({ ids: ['p1'], dryRun: true }, null);
		expect(dry.rows[0]).toMatchObject({ outcome: 'done', copySku: 'S-p1-C2', copyId: null });
		const result = await service.duplicate({ ids: ['p1'], dryRun: false }, 'adm');
		const saved = products.save.mock.calls[0]?.[0] as Product;
		expect(saved).toMatchObject({
			sku: 'S-p1-C2',
			status: 'disabled',
			title: { en: 'Copy of Maroon Saree', bn: 'মেরুন শাড়ি (কপি)' },
			slug: 'copy-of-maroon-saree',
			lifetimeUnitsReceived: 0,
		});
		expect(saved.lifecycle.liveAt).toBeNull();
		const row = variants.save.mock.calls[0]?.[0] as ProductVariant;
		expect(row).toMatchObject({ sku: 'S-p1-C2', productId: saved.id, barcode: null });
		expect(row.stock).toMatchObject({ quantity: 0, held: 0 });
		expect(result.rows[0]).toMatchObject({ copyId: saved.id, copySku: 'S-p1-C2' });
		expect(catalog.copyExtras).toHaveBeenCalledWith('p1', saved.id);
		const gone = await service.duplicate({ ids: ['p1'], dryRun: true }, null);
		expect(gone.rows[0]?.outcome).toBe('done');
	});

	it('copies a bundle’s groups and refuses a discontinued product', async () => {
		const { service, bundles } = bulk([
			product('p3', { type: 'bundle' }),
			product('p4', { status: 'discontinued' }),
		]);
		const result = await service.duplicate({ ids: ['p3', 'p4'], dryRun: false }, null);
		expect(result.rows.map((row) => row.reason)).toEqual([null, 'discontinued']);
		expect(bundles.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
	});

	it('deletes only products that were never live, stocked, ordered or named in an event', async () => {
		const rows = [
			product('p1'),
			product('p2', { status: 'live' }),
			product('p3', { lifecycle: { liveAt: '2026-11-01T00:00:00.000Z' } }),
		];
		const { service, catalog, drafts } = bulk(rows);
		const result = await service.delete({ ids: ['p1', 'p2', 'p3'], dryRun: false }, 'adm');
		expect(result.rows.map((row) => [row.outcome, row.reason])).toEqual([
			['done', null],
			['refused', 'was_live'],
			['refused', 'was_live'],
		]);
		expect(catalog.removeNeverLive).toHaveBeenCalledTimes(1);
		expect(drafts.removeForProduct).toHaveBeenCalledWith('p1');
		const ordered = bulk([product('p1')], { facts: { hasOrders: true } });
		expect((await ordered.service.delete({ ids: ['p1'], dryRun: true }, null)).rows[0]?.reason).toBe('has_orders');
		const stocked = bulk([product('p1')], { facts: { hasMovements: true } });
		expect((await stocked.service.delete({ ids: ['p1'], dryRun: true }, null)).rows[0]?.reason).toBe('has_stock');
		const named = bulk([product('p1')], {
			events: [event({ sale: { products: [{ productId: 'p1', rule: { kind: 'percent', value: 10 } }] } })],
		});
		expect((await named.service.delete({ ids: ['p1'], dryRun: true }, null)).rows[0]?.reason).toBe('in_event');
	});
});

describe('CatalogService bulk helpers', () => {
	const build = () => {
		const products = { save: vi.fn(async (row: unknown) => row), deleteById: vi.fn(async () => undefined) };
		const variants = {
			listForProduct: vi.fn(async () => [variant('p1')]),
			deleteById: vi.fn(async () => undefined),
		};
		const audit = { append: vi.fn(async () => undefined) };
		const relations = {
			listForProduct: vi.fn(async (filter: { relationType: string }) =>
				filter.relationType === 'related'
					? [{ id: 'rel_1', source: 'manual', targetId: 'p9' }]
					: [{ id: `rel_${filter.relationType}`, source: 'insight', targetId: 'p8' }],
			),
			save: vi.fn(async (row: unknown) => row),
			deleteById: vi.fn(async () => undefined),
			disableForTarget: vi.fn(async () => 0),
		};
		const faqs = {
			listForProduct: vi.fn(async () => [
				{
					id: 'faq_1',
					question: { en: 'Silk?' },
					answer: { en: 'Yes' },
					scope: 'product',
					categoryIds: [],
					productIds: ['p1'],
					displayOrder: 0,
					status: 'live',
					createdAt: '2026-11-01T00:00:00.000Z',
				},
			]),
			save: vi.fn(async (row: unknown) => row),
			deleteById: vi.fn(async () => undefined),
		};
		const outbox = { request: vi.fn(async () => undefined) };
		const service = new CatalogService(
			products as never,
			{} as never,
			variants as never,
			{} as never,
			undefined,
			audit as never,
			undefined,
			relations as never,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			faqs as never,
			undefined,
			outbox as never,
		);
		return { service, products, variants, audit, relations, faqs, outbox };
	};

	it('takes a product off the shop and records it', async () => {
		const { service, products, audit, outbox } = build();
		const next = await service.takeOff(product('p1', { status: 'live' }), 'adm');
		expect(next.status).toBe('disabled');
		expect(next.lifecycle.disabledAt).toBeTruthy();
		expect(products.save).toHaveBeenCalled();
		expect(outbox.request).toHaveBeenCalledWith(['p1'], expect.any(Date));
		expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog.product.take-off' }));
	});

	it('removes a never-live product with its rows, links and own questions', async () => {
		const { service, products, variants, relations, faqs } = build();
		await service.removeNeverLive(product('p1'), 'adm');
		expect(variants.deleteById).toHaveBeenCalledWith('var_p1');
		expect(relations.deleteById).toHaveBeenCalledTimes(3);
		expect(relations.disableForTarget).toHaveBeenCalledWith('p1');
		expect(products.deleteById).toHaveBeenCalledWith('p1');
		expect(faqs.deleteById).toHaveBeenCalledWith('faq_1');
	});

	it('copies the offered products and the questions', async () => {
		const { service, relations, faqs } = build();
		await service.copyExtras('p1', 'p2');
		expect(relations.save).toHaveBeenCalledWith(
			expect.objectContaining({ sourceProductId: 'p2', targetId: 'p9', relationType: 'related' }),
		);
		expect(faqs.save).toHaveBeenCalledWith(expect.objectContaining({ productIds: ['p2'] }));
		expect((faqs.save.mock.calls[0]?.[0] as { id: string }).id).not.toBe('faq_1');
	});

	it('answers no picture without a media library', async () => {
		const { service } = build();
		expect([...(await service.thumbnailsFor(['a']))]).toEqual([['a', null]]);
	});
});

describe('ProductDraftsService', () => {
	const principal = (permissions = ['product.index', 'product.create', 'product.edit']) =>
		({ userId: 'adm_1', permissions }) as never;
	const write = (over: Record<string, unknown> = {}) =>
		ProductDraftWrite.parse({ kind: 'new', title: 'Kantha', form: { raw: { name: 'Kantha' } }, ...over });
	const build = () => {
		const stored = new Map<string, unknown>();
		const drafts = {
			findById: vi.fn(async (id: string) => stored.get(id) ?? null),
			findEdit: vi.fn(
				async (productId: string, by: string) =>
					[...stored.values()].find(
						(row) =>
							(row as { productId: string }).productId === productId &&
							(row as { createdBy: string }).createdBy === by,
					) ?? null,
			),
			list: vi.fn(async () => ({ items: [...stored.values()], total: stored.size, page: 1, pageSize: 30 })),
			countBy: vi.fn(async () => stored.size),
			save: vi.fn(async (row: { id: string }) => {
				stored.set(row.id, row);
				return row;
			}),
			remove: vi.fn(async (id: string) => void stored.delete(id)),
		};
		const products = {
			findById: vi.fn(async (id: string) =>
				id === 'p1'
					? product('p1', { status: 'live', lifecycle: { liveAt: '2026-11-01T00:00:00.000Z' } })
					: id === 'p2'
						? product('p2', { status: 'discontinued' })
						: null,
			),
		};
		const catalog = {
			record: vi.fn(async () => undefined),
			thumbnailsFor: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `https://cdn/${id}.jpg`]))),
		};
		const admins = { findById: vi.fn(async () => ({ displayName: 'Mou' })) };
		const service = new ProductDraftsService(drafts as never, products as never, catalog as never, admins as never);
		return { service, drafts, catalog };
	};

	it('saves a new-product draft unchecked, and saves over it', async () => {
		const { service, catalog } = build();
		const first = await service.save(null, write(), principal());
		expect(first).toMatchObject({ kind: 'new', createdBy: 'adm_1', title: 'Kantha' });
		const again = await service.save(first.id, write({ title: 'Kantha Silk' }), principal());
		expect(again).toMatchObject({ id: first.id, title: 'Kantha Silk', createdAt: first.createdAt });
		expect(catalog.record).toHaveBeenCalledWith('adm_1', 'catalog.product-draft.save', first.id, expect.anything());
	});

	it('keeps one draft of changes per product per person, and its start', async () => {
		const { service } = build();
		const body = write({ kind: 'edit', productId: 'p1', baseSavedAt: '2026-11-19T09:00:00.000Z' });
		const first = await service.save(null, body, principal());
		const second = await service.save(
			null,
			write({ kind: 'edit', productId: 'p1', baseSavedAt: '2026-11-19T10:00:00.000Z' }),
			principal(),
		);
		expect(second.id).toBe(first.id);
		expect(second.baseSavedAt).toBe('2026-11-19T09:00:00.000Z');
	});

	it('refuses without the right, a changed kind, a missing or discontinued product', async () => {
		const { service } = build();
		await expect(service.save(null, write(), principal(['product.index', 'product.edit']))).rejects.toThrow(
			ForbiddenException,
		);
		await expect(
			service.save(
				null,
				write({ kind: 'edit', productId: 'p1' }),
				principal(['product.index', 'product.create']),
			),
		).rejects.toThrow(ForbiddenException);
		const draft = await service.save(null, write(), principal());
		await expect(service.save(draft.id, write({ kind: 'edit', productId: 'p1' }), principal())).rejects.toThrow(
			BadRequestException,
		);
		await expect(service.save(null, write({ kind: 'edit', productId: 'p2' }), principal())).rejects.toThrow(
			BadRequestException,
		);
		await expect(service.save(null, write({ kind: 'edit', productId: 'p9' }), principal())).rejects.toThrow(
			NotFoundException,
		);
		await expect(service.get('missing')).rejects.toThrow(NotFoundException);
	});

	it('lists drafts with their product, picture and who saved them', async () => {
		const { service } = build();
		await service.save(null, write({ imageAssetId: 'a1' }), principal());
		await service.save(
			null,
			write({ kind: 'edit', productId: 'p1', changes: [{ path: 'raw.name', from: 'x' }] }),
			principal(),
		);
		const list = await service.list({ scope: 'mine', page: 1, pageSize: 30 }, principal());
		expect(list.mine).toBe(2);
		expect(list.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'new',
					thumbnailUrl: 'https://cdn/a1.jpg',
					mine: true,
					updatedByName: 'Mou',
				}),
				expect.objectContaining({
					kind: 'edit',
					productStatus: 'live',
					productWasLive: true,
					changedCount: 1,
					thumbnailUrl: 'https://cdn/img-p1.jpg',
				}),
			]),
		);
	});

	it('discards a draft only with the right', async () => {
		const { service, drafts } = build();
		const draft = await service.save(null, write(), principal());
		await expect(service.remove(draft.id, principal(['product.index']))).rejects.toThrow(ForbiddenException);
		await service.remove(draft.id, principal());
		expect(drafts.remove).toHaveBeenCalledWith(draft.id);
	});

	it('refuses a draft too large to keep, and a new draft naming a product', () => {
		expect(() => write({ form: { text: 'x'.repeat(600 * 1024) } })).toThrow();
		expect(() => write({ productId: 'p1' })).toThrow();
		expect(() => write({ kind: 'edit' })).toThrow();
	});
});

describe('EventProductsService', () => {
	const principal = (permissions = ['event.index', 'event.edit', 'event.create']) =>
		({ userId: 'adm_1', permissions }) as never;
	const build = (current: ShopEvent = event(), clash = false) => {
		const admin = {
			detail: vi.fn(async () => current),
			update: vi.fn(async (_id: string, body: unknown) => ({ ...current, ...(body as object) })),
			create: vi.fn(async (body: unknown) => ({ ...event({ id: 'evt_new' }), ...(body as object) })),
		};
		const catalog = {
			salePrices: vi.fn(async (sale: ShopEvent) =>
				sale.sale.products.map((line) => ({
					productId: line.productId,
					productTitle: '',
					sku: `S-${line.productId}`,
					normalINR: 1000,
					saleINR: line.rule.kind === 'amount' && line.rule.value >= 1000 ? null : 900,
					source: 'product',
					categoryId: null,
					warning: false,
					refused: line.rule.kind === 'amount' && line.rule.value >= 1000,
				})),
			),
			overlaps: vi.fn(async () =>
				clash ? [{ code: 'overlap', target: 'p2', locale: null, gaps: [], detail: 'Saree · Puja Sale' }] : [],
			),
		};
		const products = { thumbnailsFor: vi.fn(async () => new Map()) };
		const rows = [product('p1'), product('p2'), product('p3', { status: 'discontinued' })];
		const repo = { findById: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null) };
		const variants = { listForProducts: vi.fn(async () => [variant('p1'), variant('p2')]) };
		const service = new EventProductsService(
			admin as never,
			catalog as never,
			products as never,
			repo as never,
			variants as never,
		);
		return { service, admin, catalog };
	};
	const line = (productId: string, value = 10, kind = 'percent') => ({
		productId,
		rule: { kind, value, skuPrices: {} } as never,
	});

	it('previews every price and names what is left out', async () => {
		const { service, admin } = build(event(), true);
		const result = await service.addProducts(
			{
				eventId: 'evt_1',
				dryRun: true,
				lines: [line('p1'), line('p2'), line('p3'), line('p4'), line('p5', 0)],
			},
			principal(),
		);
		expect(result.rows.map((row) => [row.productId, row.outcome, row.reason])).toEqual([
			['p1', 'done', null],
			['p2', 'refused', 'overlap'],
			['p3', 'refused', 'discontinued'],
			['p4', 'refused', 'not_found'],
			['p5', 'refused', 'not_found'],
		]);
		expect(result.rows[0]?.prices[0]).toMatchObject({ normalINR: 1000, saleINR: 900, label: '' });
		expect(result.rows[1]?.detail).toBe('Saree · Puja Sale');
		expect(admin.update).not.toHaveBeenCalled();
	});

	it('adds the accepted products to the sale as their own lines', async () => {
		const current = event({ status: 'live', sale: { products: [line('p9')] } });
		const { service, admin } = build(current);
		const result = await service.addProducts(
			{ eventId: 'evt_1', dryRun: false, lines: [line('p1'), line('p2', 5000, 'amount')] },
			principal(),
		);
		expect(result.rows.map((row) => row.reason)).toEqual([null, 'bad_rule']);
		const body = admin.update.mock.calls[0]?.[1] as { sale: { products: { productId: string }[] } };
		expect(body.sale.products.map((row) => row.productId)).toEqual(['p9', 'p1']);
		expect(result).toMatchObject({ eventId: 'evt_1', eventStatus: 'live' });
	});

	it('makes a new draft sale, needing the right to add events', async () => {
		const { service, admin } = build();
		await expect(
			service.addProducts(
				{ eventId: null, dryRun: false, lines: [line('p1')] },
				principal(['event.index', 'event.edit']),
			),
		).rejects.toThrow(ForbiddenException);
		const result = await service.addProducts({ eventId: null, dryRun: false, lines: [line('p1')] }, principal());
		expect(admin.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'sale' }), 'adm_1');
		expect(result.eventId).toBe('evt_new');
		const dry = await service.addProducts({ eventId: null, dryRun: true, lines: [line('p1')] }, principal());
		expect(dry).toMatchObject({ eventId: null, eventStatus: null });
	});

	it('refuses an ended sale or a launch', async () => {
		const ended = build(event({ status: 'ended' }));
		await expect(
			ended.service.addProducts({ eventId: 'evt_1', dryRun: true, lines: [line('p1')] }, principal()),
		).rejects.toThrow(BadRequestException);
		const launch = build(event({ type: 'launch' }));
		await expect(
			launch.service.addProducts({ eventId: 'evt_1', dryRun: true, lines: [line('p1')] }, principal()),
		).rejects.toThrow(BadRequestException);
	});
});
