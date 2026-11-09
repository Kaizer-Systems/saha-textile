import { BadRequestException } from '@nestjs/common';
import { type Category, type Product, type ProductVariant, ShopEvent } from '@saha-textile/contracts';
import type { ShopEventRepository } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventCatalog } from '../src/events/event-catalog';
import { EventClock } from '../src/events/event-clock';
import { EventsAdminService } from '../src/events/events-admin.service';
import { EventsPublicService } from '../src/events/events-public.service';
import { SaleAwareVariantRepository } from '../src/events/sale-aware-variant.repository';
import { SalePriceBook, descendants } from '../src/events/sale-price-book';

const config = { locales: ['en', 'bn'] } as never;
const HOUR = 3_600_000;

const category = (id: string, parentId: string | null = null): Category =>
	({
		id,
		name: { en: id },
		slug: id,
		parentId,
		path: parentId ? [parentId, id] : [id],
		ancestors: parentId ? [parentId] : [],
		depth: parentId ? 1 : 0,
	}) as never;

const product = (id: string, categoryIds: string[], status = 'live'): Product =>
	({ id, sku: id.toUpperCase(), title: { en: `Saree ${id}` }, categoryIds, status }) as never;

const variant = (
	productId: string,
	sku: string,
	priceINR: number,
	salePriceINR: number | null = null,
): ProductVariant => ({ id: `v_${sku}`, productId, sku, priceINR, salePriceINR, compareAtPriceINR: null }) as never;

class MemoryEvents implements ShopEventRepository {
	readonly rows = new Map<string, ShopEvent>();
	async findById(id: string) {
		return this.rows.get(id) ?? null;
	}
	async list() {
		const items = [...this.rows.values()];
		return { items, total: items.length, page: 1, pageSize: 20 };
	}
	async listPublished() {
		return [...this.rows.values()].filter((row) => row.status === 'scheduled' || row.status === 'live');
	}
	async save(event: ShopEvent) {
		this.rows.set(event.id, ShopEvent.parse(event));
		return this.rows.get(event.id) as ShopEvent;
	}
	async transition(id: string, from: ShopEvent['status'], patch: Partial<ShopEvent>) {
		const row = this.rows.get(id);
		if (!row || row.status !== from) return null;
		return this.save({ ...row, ...patch });
	}
	async remove(id: string) {
		this.rows.delete(id);
	}
	readonly previews = new Map<string, { id: string; expiresAt: string }>();
	async setPreview(id: string, tokenHash: string, expiresAt: string) {
		for (const [hash, row] of this.previews) if (row.id === id) this.previews.delete(hash);
		this.previews.set(tokenHash, { id, expiresAt });
	}
	async findByPreview(tokenHash: string, now: string) {
		const row = this.previews.get(tokenHash);
		return row && row.expiresAt > now ? (this.rows.get(row.id) ?? null) : null;
	}
}

function harness() {
	const now = Date.now();
	const tree = [category('cat_saree'), category('cat_silk', 'cat_saree'), category('cat_cotton')];
	const products = new Map<string, Product>([
		['p1', product('p1', ['cat_silk'])],
		['p2', product('p2', ['cat_saree', 'cat_cotton'])],
		['p3', product('p3', ['cat_cotton'])],
		['d1', product('d1', ['cat_new'], 'draft')],
		['d2', product('d2', ['cat_new'], 'draft')],
	]);
	const variants = [
		variant('p1', 'P1-A', 5_000),
		variant('p1', 'P1-B', 6_000, 5_500),
		variant('p2', 'P2-A', 10_000),
		variant('p3', 'P3-A', 2_000),
	];
	const productRepo = {
		findById: async (id: string) => products.get(id) ?? null,
		list: async (filter: { categoryIds?: string[]; page: number }) => {
			const items = [...products.values()].filter((row) =>
				row.categoryIds.some((id) => filter.categoryIds?.includes(id)),
			);
			return { items: filter.page === 1 ? items : [], total: items.length, page: filter.page, pageSize: 500 };
		},
		save: vi.fn(async (row: Product) => {
			products.set(row.id, row);
			return row;
		}),
	};
	const categoryRepo = { tree: async () => [...tree, category('cat_new')] };
	const variantRepo = {
		findById: async () => null,
		findBySku: async (sku: string) => variants.find((row) => row.sku === sku) ?? null,
		findByOptionSelectionHash: async () => null,
		listForProduct: async (id: string) => variants.filter((row) => row.productId === id),
		listForProducts: async (ids: readonly string[]) => variants.filter((row) => ids.includes(row.productId)),
		list: async () => ({ items: variants, total: variants.length, page: 1, pageSize: 50 }),
		save: vi.fn(async (row: ProductVariant) => row),
		saveMany: vi.fn(async (rows: readonly ProductVariant[]) => [...rows]),
		deleteById: vi.fn(async () => undefined),
	};
	const placements = {
		listForCategory: async (id: string) =>
			id === 'cat_new' ? [{ id: 'plc_new', categoryId: id, status: 'draft' }] : [],
		save: vi.fn(async (row: unknown) => row),
	};
	const events = new MemoryEvents();
	const book = new SalePriceBook(events, productRepo as never, categoryRepo as never);
	const builder = {
		gapsFor: vi.fn(async (row: Product) => (row.id === 'd2' ? [{ field: 'description', locale: 'bn' }] : [])),
		goLive: vi.fn(async (id: string) => {
			if (id === 'd2') return { live: false, gaps: [{ field: 'description', locale: 'bn' }] };
			products.set(id, { ...(products.get(id) as Product), status: 'live' });
			return { live: true, gaps: [] };
		}),
	};
	const catalogService = { syncSearchMany: vi.fn(async (rows: readonly Product[]) => rows.length) };
	const orders = {
		listPaidLinesBetween: vi.fn(async () => [
			{ orderId: 'o1', productId: 'p3', sku: 'P3-A', quantity: 2, unitPriceINR: 1_600 },
		]),
	};
	const catalog = new EventCatalog(
		productRepo as never,
		variantRepo as never,
		categoryRepo as never,
		placements as never,
		events,
		builder as never,
	);
	const clock = new EventClock(
		events,
		book,
		productRepo as never,
		catalog,
		builder as never,
		catalogService as never,
		orders as never,
		null,
	);
	const messenger = { count: vi.fn(async () => 7), announce: vi.fn(async () => 7), test: vi.fn() };
	const admin = new EventsAdminService(events, config, catalog, clock, messenger as never, null);
	return { now, events, book, variantRepo, admin, clock, builder, catalogService, placements, messenger, products };
}

const saleBody = (startsAt: number, endsAt: number) => ({
	type: 'sale' as const,
	name: 'Puja Sale',
	title: { en: 'Puja Sale', bn: 'পুজোর সেল' },
	message: { en: 'Up to 30% off', bn: '৩০% পর্যন্ত ছাড়' },
	startsAt: new Date(startsAt).toISOString(),
	endsAt: new Date(endsAt).toISOString(),
	linkHref: '/collections/saree',
	showCountdown: true,
	showPopup: true,
	popupAssetId: null,
	nowLiveDays: 3,
	launch: { categoryIds: [], productIds: [], heldProductIds: [] },
	sale: {
		categories: [
			{
				categoryId: 'cat_saree',
				rule: { kind: 'percent' as const, value: 20, skuPrices: {} },
				exceptions: [{ productId: 'p2', mode: 'held' as const, rule: null }],
			},
			{ categoryId: 'cat_cotton', rule: { kind: 'amount' as const, value: 400, skuPrices: {} }, exceptions: [] },
		],
		products: [],
	},
});

describe('descendants', () => {
	it('puts every category under its ancestors', () => {
		const below = descendants([category('a'), category('b', 'a')]);
		expect([...(below.get('a') ?? [])]).toEqual(['a', 'b']);
		expect([...(below.get('b') ?? [])]).toEqual(['b']);
	});
});

describe('sale prices', () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it('applies only between start and end, and never on admin reads or saves', async () => {
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 5 * HOUR), 'admin_1');
		await h.events.save({ ...created, status: 'scheduled' });
		await h.book.refresh();
		const repo = new SaleAwareVariantRepository(h.variantRepo as never, h.book);
		const before = await repo.listForProduct('p1', 'public');
		expect(before.map((row) => row.salePriceINR)).toEqual([null, 5_500]);

		const during = new Date(h.now + 2 * HOUR);
		const row = h.book.overlay(variant('p1', 'P1-A', 5_000), during);
		expect(row.salePriceINR).toBe(4_000);
		// A % off rule follows the normal selling price, here the admin's own 5,500.
		expect(h.book.priceFor(variant('p1', 'P1-B', 6_000, 5_500), during)?.saleINR).toBe(4_400);
		expect(h.book.endsAtFor('p1', during)).toBe(new Date(h.now + 5 * HOUR).toISOString());
		expect(h.book.overlay(variant('p1', 'P1-A', 5_000), new Date(h.now + 6 * HOUR)).salePriceINR).toBeNull();
		expect((await repo.listForProduct('p1', 'admin'))[0]?.salePriceINR).toBeNull();
		await repo.save(row);
		expect(h.variantRepo.save).toHaveBeenCalledWith(row, undefined);
	});

	it('holds a product back and gives the lower price across categories', async () => {
		const body = saleBody(h.now - HOUR, h.now + HOUR);
		body.sale.categories[0]!.exceptions = [];
		const created = await h.admin.create(body, null);
		await h.events.save({ ...created, status: 'live' });
		await h.book.refresh();
		// p2 sits in both: 20% off 10,000 is 8,000; ₹ 400 off is 9,600. The lower wins.
		expect(h.book.priceFor(variant('p2', 'P2-A', 10_000))?.saleINR).toBe(8_000);
		const held = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await h.events.save({ ...held, status: 'live' });
		await h.events.remove(created.id);
		await h.book.refresh();
		expect(h.book.priceFor(variant('p2', 'P2-A', 10_000))).toBeNull();
	});
});

describe('the event form and Publish', () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it('refuses a rule that can never apply on Save', async () => {
		const body = saleBody(h.now + HOUR, h.now + 2 * HOUR);
		body.sale.categories[0]!.rule = { kind: 'percent', value: 0, skuPrices: {} };
		await expect(h.admin.create(body, null)).rejects.toBeInstanceOf(BadRequestException);
	});

	it('lists what stops Publish, then publishes and messages once', async () => {
		const body = saleBody(h.now + HOUR, h.now + 2 * HOUR);
		const created = await h.admin.create({ ...body, message: { en: 'Up to 30% off' } }, null);
		const refused = await h.admin.publish(created.id, null);
		expect(refused.published).toBe(false);
		expect(refused.problems.map((row) => row.target)).toEqual(['message:bn']);

		await h.admin.update(created.id, body, null);
		const review = await h.admin.review(created.id);
		expect(review.recipients).toBe(7);
		expect(review.prices.find((row) => row.sku === 'P2-A')).toMatchObject({ source: 'held', saleINR: null });
		expect(review.prices.find((row) => row.sku === 'P3-A')).toMatchObject({ source: 'category', saleINR: 1_600 });

		const published = await h.admin.publish(created.id, 'admin_1');
		expect(published).toMatchObject({ published: true, recipients: 7 });
		expect(published.event?.status).toBe('scheduled');
		expect(published.event?.messageSentAt).not.toBeNull();

		await h.admin.unpublish(created.id, null);
		await h.admin.publish(created.id, null);
		expect(h.messenger.announce).toHaveBeenCalledTimes(1);
	});

	it('refuses a second sale on the same products over the same time', async () => {
		const first = await h.admin.create(saleBody(h.now + HOUR, h.now + 3 * HOUR), null);
		await h.admin.publish(first.id, null);
		const second = await h.admin.create(saleBody(h.now + 2 * HOUR, h.now + 4 * HOUR), null);
		const result = await h.admin.publish(second.id, null);
		expect(result.published).toBe(false);
		expect(new Set(result.problems.map((row) => row.code))).toEqual(new Set(['overlap']));
	});

	it('deletes drafts only', async () => {
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		await h.admin.publish(created.id, null);
		await expect(h.admin.remove(created.id, null)).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe('the clock', () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it('starts a sale once, re-reads search, then ends it with a record', async () => {
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		await h.events.save({ ...created, status: 'scheduled' });
		await h.book.refresh();
		await Promise.all([h.clock.sweep(new Date(h.now + HOUR)), h.clock.sweep(new Date(h.now + HOUR))]);
		expect(h.events.rows.get(created.id)?.status).toBe('live');
		expect(h.catalogService.syncSearchMany).toHaveBeenCalledTimes(1);

		await h.clock.sweep(new Date(h.now + 2 * HOUR));
		const ended = h.events.rows.get(created.id);
		expect(ended?.status).toBe('ended');
		expect(ended?.sale).toEqual({ categories: [], products: [] });
		expect(ended?.saleRecord).toMatchObject({ orders: 1, unitsSold: 2, revenueINR: 3_200, discountINR: 800 });
	});

	it('puts a launch live item by item and lists the one that is not ready', async () => {
		const created = await h.admin.create(
			{
				...saleBody(h.now + HOUR, h.now + 2 * HOUR),
				type: 'launch',
				endsAt: null,
				launch: { categoryIds: ['cat_new'], productIds: ['p1'], heldProductIds: [] },
			},
			null,
		);
		await h.events.save({ ...created, status: 'scheduled' });
		await h.clock.sweep(new Date(h.now + HOUR));
		const report = h.events.rows.get(created.id)?.launchReport;
		expect(report).toMatchObject({
			liveProductIds: ['d1'],
			liveCategoryIds: ['cat_new'],
			skippedProductIds: ['p1'],
			failed: [{ productId: 'd2' }],
		});
		expect(h.events.rows.get(created.id)?.status).toBe('live');
	});

	it('cancels a running sale and restores prices at once', async () => {
		const created = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await h.events.save({ ...created, status: 'live' });
		await h.book.refresh();
		expect(h.book.priceFor(variant('p3', 'P3-A', 2_000))?.saleINR).toBe(1_600);
		const cancelled = await h.admin.cancel(created.id, null);
		expect(cancelled.status).toBe('cancelled');
		expect(h.book.priceFor(variant('p3', 'P3-A', 2_000))).toBeNull();
	});
});

describe('what the shop reads', () => {
	it('lists published events with the server clock', async () => {
		const h = harness();
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		await h.admin.publish(created.id, null);
		const shop = new EventsPublicService(h.events, null, null);
		const at = new Date(h.now);
		const result = await shop.list('bn', at);
		expect(result.serverNow).toBe(at.toISOString());
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({ title: 'পুজোর সেল', phase: 'upcoming', popupImage: null });
	});

	it('shows a draft through its 30-minute preview link, and nothing once the link is old or wrong', async () => {
		const h = harness();
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		const link = await h.admin.previewLink(created.id);
		expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// Only the link's hash is kept.
		expect([...h.events.previews.keys()][0]).not.toBe(link.token);
		const shop = new EventsPublicService(h.events, null, null);
		const shown = await shop.preview(link.token, 'en', new Date(h.now));
		expect(shown.items).toHaveLength(1);
		expect(shown.items[0]).toMatchObject({ id: created.id, phase: 'upcoming', title: 'Puja Sale' });
		// The draft stays a draft and stays off the shop's normal list.
		expect((await h.events.findById(created.id))?.status).toBe('draft');
		expect((await shop.list('en', new Date(h.now))).items).toHaveLength(0);
		expect((await shop.preview(link.token, 'en', new Date(h.now + 31 * 60_000))).items).toHaveLength(0);
		expect((await shop.preview('x'.repeat(43), 'en', new Date(h.now))).items).toHaveLength(0);
		// A new link replaces the old one.
		await h.admin.previewLink(created.id);
		expect((await shop.preview(link.token, 'en', new Date(h.now))).items).toHaveLength(0);
	});
});

describe('the message', () => {
	it('keeps only the blog article markup', async () => {
		const h = harness();
		const body = saleBody(h.now + HOUR, h.now + 2 * HOUR);
		const created = await h.admin.create(
			{
				...body,
				message: {
					en: '<p onclick="steal()">Up to <strong>30%</strong> off<script>alert(1)</script></p>',
					bn: '<p>৩০% পর্যন্ত ছাড়</p>',
				},
			},
			null,
		);
		expect(created.message['en']).toBe('<p>Up to <strong>30%</strong> off</p>');
		expect(created.message['bn']).toBe('<p>৩০% পর্যন্ত ছাড়</p>');
	});
});
