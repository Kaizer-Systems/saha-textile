import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type Category, type Product, type ProductVariant, ShopEvent } from '@saha-textile/contracts';
import type { ShopEventRepository } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminEventsController } from '../src/events/admin-events.controller';
import { EventCatalog } from '../src/events/event-catalog';
import { EVENT_SWEEP_MS, EventClock } from '../src/events/event-clock';
import { EVENT_TEMPLATE_KEY, EventMessenger } from '../src/events/event-messenger';
import { EventsAdminService } from '../src/events/events-admin.service';
import { EventsPublicController } from '../src/events/events-public.controller';
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
	return {
		now,
		events,
		book,
		variantRepo,
		admin,
		clock,
		builder,
		catalogService,
		placements,
		messenger,
		products,
		catalog,
		productRepo,
		categoryRepo,
		orders,
		variants,
	};
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

const launchBody = (
	h: ReturnType<typeof harness>,
	launch = { categoryIds: ['cat_new'], productIds: ['p1'], heldProductIds: [] as string[] },
) => ({
	...saleBody(h.now + HOUR, h.now + 2 * HOUR),
	type: 'launch' as const,
	endsAt: null,
	launch,
});

const audit = () => ({ append: vi.fn(async (_entry: { action: string }) => undefined) });

describe('the admin and shop controllers', () => {
	it('hands every admin route to the service, and the test message to the signed-in admin', async () => {
		const service = new Proxy({} as Record<string, unknown>, {
			get: (target, key: string) => (target[key] ??= vi.fn(async (...args: unknown[]) => ({ key, args }))),
		});
		const admins = { findById: vi.fn(async () => ({ email: 'owner@sahatextile.com' })) };
		const controller = new AdminEventsController(service as never, admins as never);
		const principal = { userId: 'admin_1' } as never;
		const body = saleBody(Date.now() + HOUR, Date.now() + 2 * HOUR);
		expect(await controller.list({ page: 1, pageSize: 20, direction: 'desc' })).toMatchObject({ key: 'list' });
		expect(await controller.categoryProducts('cat_saree')).toMatchObject({ key: 'categoryProducts' });
		expect(await controller.detail('evt_1')).toMatchObject({ key: 'detail' });
		expect(await controller.review('evt_1')).toMatchObject({ key: 'review' });
		expect(await controller.create(body, principal)).toMatchObject({ args: [body, 'admin_1'] });
		expect(await controller.create(body, undefined)).toMatchObject({ args: [body, null] });
		expect(await controller.publish('evt_1', principal)).toMatchObject({ key: 'publish' });
		expect(await controller.unpublish('evt_1', principal)).toMatchObject({ key: 'unpublish' });
		expect(await controller.cancel('evt_1', principal)).toMatchObject({ key: 'cancel' });
		expect(await controller.endNow('evt_1', principal)).toMatchObject({ key: 'endNow' });
		expect(await controller.preview('evt_1')).toMatchObject({ key: 'previewLink' });
		expect(await controller.update('evt_1', body, principal)).toMatchObject({ key: 'update' });
		expect(await controller.remove('evt_1', principal)).toMatchObject({ key: 'remove' });
		expect(await controller.test('evt_1', principal)).toMatchObject({ args: ['evt_1', 'owner@sahatextile.com'] });
		admins.findById.mockResolvedValueOnce(null as never);
		expect(await controller.test('evt_1', principal)).toMatchObject({ args: ['evt_1', null] });
		expect(await controller.test('evt_1', undefined)).toMatchObject({ args: ['evt_1', null] });
	});

	it('reads published events and previews for the shop', async () => {
		const shop = { list: vi.fn(async () => 'list'), preview: vi.fn(async () => 'preview') };
		const controller = new EventsPublicController(shop as never);
		expect(await controller.list({ locale: 'bn' })).toBe('list');
		expect(await controller.preview({ token: 'x'.repeat(43), locale: 'en' })).toBe('preview');
		expect(shop.preview).toHaveBeenCalledWith('x'.repeat(43), 'en');
	});
});

describe('the event message', () => {
	const event = (patch: Partial<ShopEvent> = {}) =>
		ShopEvent.parse({
			id: 'evt_1',
			type: 'sale',
			name: 'Puja Sale',
			title: { en: 'Puja Sale', bn: 'পুজোর সেল' },
			message: { en: '<p>Up to 30% off</p>' },
			startsAt: '2027-09-20T04:30:00.000Z',
			endsAt: '2027-09-27T18:29:00.000Z',
			linkHref: '/collections/sarees',
			...patch,
		});
	const customer = (id: string, email: string | null, preferredLocale: string | null = null) => ({
		id,
		email,
		preferredLocale,
	});

	function messenger(withConsents = true, withNotifications = true) {
		const pages = [
			[customer('c1', 'a@example.com', 'bn'), customer('c2', null), customer('c3', 'c@example.com', 'fr')],
			[customer('c4', 'd@example.com')],
		];
		const customers = {
			list: vi.fn(async ({ page }: { page: number }) => ({ items: pages[page - 1] ?? [], meta: { total: 201 } })),
		};
		const consents = {
			findLatestForUser: vi.fn(async (id: string) =>
				id === 'c4' ? null : { categories: { marketing: id !== 'c3' || true } },
			),
		};
		const notifications = {
			send: vi.fn(async ({ destination }: { destination: string }) => {
				if (destination === 'c@example.com') throw new Error('provider down');
				return undefined;
			}),
		};
		const sender = new EventMessenger(
			customers as never,
			config,
			withConsents ? (consents as never) : null,
			withNotifications ? (notifications as never) : null,
		);
		return { sender, customers, consents, notifications };
	}

	it('counts customers with an email and marketing consent, page by page', async () => {
		const { sender, customers } = messenger();
		expect(await sender.count()).toBe(2);
		expect(customers.list).toHaveBeenCalledTimes(2);
		expect(await messenger(false).sender.count()).toBe(0);
	});

	it('sends each customer the message in their language and keeps going past a failure', async () => {
		const { sender, notifications } = messenger();
		expect(await sender.announce(event())).toBe(1);
		expect(notifications.send).toHaveBeenCalledTimes(2);
		expect(notifications.send).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				templateKey: EVENT_TEMPLATE_KEY,
				category: 'marketing',
				destination: 'a@example.com',
				idempotencyKey: 'event:evt_1:c1',
				variables: expect.objectContaining({
					title: 'পুজোর সেল',
					message: '<p>Up to 30% off</p>',
					link: '/bn/collections/sarees',
				}),
			}),
		);
		// A language the shop doesn't have falls back to English.
		expect(notifications.send).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				destination: 'c@example.com',
				variables: expect.objectContaining({ title: 'Puja Sale', link: '/collections/sarees' }),
			}),
		);
		expect(await messenger(true, false).sender.announce(event())).toBe(0);
	});

	it('sends the test in every language, with empty times and the home page when unset', async () => {
		const { sender, notifications } = messenger();
		await sender.test(
			event({ startsAt: null, endsAt: null, linkHref: null, title: {}, message: {} }),
			'owner@sahatextile.com',
		);
		expect(notifications.send).toHaveBeenCalledTimes(2);
		expect(notifications.send).toHaveBeenLastCalledWith(
			expect.objectContaining({
				category: 'transactional',
				variables: { title: '', message: '', when: '', ends: '', link: '/bn/' },
			}),
		);
		await messenger(true, false).sender.test(event(), 'owner@sahatextile.com');
	});
});

describe('shop reads of variants during a sale', () => {
	it('lays the sale price over every public read and passes admin reads and writes straight through', async () => {
		const h = harness();
		const created = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await h.events.save({ ...created, status: 'live' });
		await h.book.refresh();
		const inner = {
			...h.variantRepo,
			findById: vi.fn(async (id: string) => h.variants.find((row) => row.id === id) ?? null),
		};
		const repo = new SaleAwareVariantRepository(inner as never, h.book);
		expect((await repo.findById('v_P3-A', 'public'))?.salePriceINR).toBe(1_600);
		expect((await repo.findById('v_P3-A', 'admin'))?.salePriceINR).toBeNull();
		expect(await repo.findById('missing', 'public')).toBeNull();
		expect((await repo.findBySku('P3-A', 'public'))?.salePriceINR).toBe(1_600);
		expect(await repo.findBySku('missing', 'public')).toBeNull();
		expect(await repo.findByOptionSelectionHash('p3', 'hash')).toBeNull();
		expect((await repo.listForProducts(['p3'], 'public'))[0]?.salePriceINR).toBe(1_600);
		const page = await repo.list({ audience: 'public' } as never);
		expect(page.items.find((row) => row.sku === 'P3-A')?.salePriceINR).toBe(1_600);
		await repo.saveMany([]);
		await repo.deleteById('v_P3-A');
		expect(h.variantRepo.saveMany).toHaveBeenCalled();
		expect(h.variantRepo.deleteById).toHaveBeenCalledWith('v_P3-A', undefined);
	});
});

describe('the sale price book', () => {
	it('re-reads on a timer until stopped, and keeps the last good book when a read fails', async () => {
		vi.useFakeTimers();
		try {
			const h = harness();
			const refresh = vi.spyOn(h.book, 'refresh');
			h.book.start();
			h.book.start();
			expect(refresh).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(refresh).toHaveBeenCalledTimes(2);
			h.book.stop();
			h.book.stop();
			await vi.advanceTimersByTimeAsync(120_000);
			expect(refresh).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
		const h = harness();
		const created = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await h.events.save({ ...created, status: 'live' });
		await h.book.refresh();
		vi.spyOn(h.events, 'listPublished').mockRejectedValueOnce(new Error('down'));
		vi.spyOn(h.events, 'listPublished').mockRejectedValueOnce('down');
		await h.book.refresh();
		await h.book.refresh();
		expect(h.book.priceFor(variant('p3', 'P3-A', 2_000))?.saleINR).toBe(1_600);
	});

	it('reads every page of a category, uses the lowest of two sales, and knows a product with none', async () => {
		const h = harness();
		const list = h.productRepo.list;
		h.productRepo.list = vi.fn(async (filter: { categoryIds?: string[]; page: number }) => {
			const page = await list({ ...filter, page: 1 });
			return { ...page, items: filter.page === 1 ? page.items.slice(0, 1) : page.items.slice(1), total: 1_000 };
		}) as never;
		const first = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await h.events.save({ ...first, status: 'live' });
		const second = await h.admin.create(
			{
				...saleBody(h.now - HOUR, h.now + 2 * HOUR),
				sale: {
					categories: [],
					products: [{ productId: 'p3', rule: { kind: 'fixed', value: 1_000, skuPrices: {} } }],
				},
			},
			null,
		);
		await h.events.save({ ...second, status: 'live' });
		await h.book.refresh();
		expect(h.book.priceFor(variant('p3', 'P3-A', 2_000))).toMatchObject({ saleINR: 1_000, eventId: second.id });
		expect(h.book.priceFor(variant('p1', 'P1-A', 5_000))?.saleINR).toBe(4_000);
		expect(h.book.endsAtFor('p3')).toBe(new Date(h.now + HOUR).toISOString());
		expect(h.book.endsAtFor('nothing')).toBeNull();
		// A product held back everywhere has no entry.
		expect(h.book.productsIn(first.id)).not.toContain('p2');
	});

	it('maps a category with no stored path to itself', () => {
		expect([...(descendants([{ id: 'solo', path: [] } as never]).get('solo') ?? [])]).toEqual(['solo']);
	});
});

describe('the event catalogue', () => {
	it('lists a launch with its readiness, a category’s products, and unknown items', async () => {
		const h = harness();
		h.products.set('t1', { ...product('t1', ['cat_new'], 'draft'), title: {} } as never);
		h.products.set('x1', product('x1', ['cat_new'], 'discontinued'));
		const created = await h.admin.create(
			launchBody(h, { categoryIds: ['cat_new'], productIds: ['p1', 'gone'], heldProductIds: ['d1'] }),
			null,
		);
		const review = await h.admin.review(created.id);
		expect(review.items.map((row) => [row.productId, row.held, row.gaps.length])).toEqual([
			['d1', true, 0],
			['d2', false, 1],
			['t1', false, 0],
			['p1', false, 0],
		]);
		expect(review.items.find((row) => row.productId === 't1')?.title).toBe('T1');
		expect(review.problems.map((row) => row.code)).toEqual(expect.arrayContaining(['unknown_item', 'not_ready']));
		expect(await h.catalog.inCategories([])).toEqual([]);
		const products = await h.catalog.categoryProducts('cat_saree');
		expect(products.products.find((row) => row.productId === 'p1')?.skus).toEqual([
			{ sku: 'P1-A', normalINR: 5_000 },
			{ sku: 'P1-B', normalINR: 5_500 },
		]);
		expect(await h.admin.categoryProducts('cat_cotton')).toMatchObject({ categoryId: 'cat_cotton' });
		const sale = await h.admin.create(
			{
				...saleBody(h.now + HOUR, h.now + 2 * HOUR),
				sale: {
					categories: [
						{ categoryId: 'cat_gone', rule: { kind: 'percent', value: 10, skuPrices: {} }, exceptions: [] },
					],
					products: [],
				},
			},
			null,
		);
		expect(await h.catalog.unknownItems(sale)).toEqual([expect.objectContaining({ target: 'cat_gone' })]);
	});

	it('ignores other events that cannot clash, and leaves live placements alone', async () => {
		const h = harness();
		const mine = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		const later = await h.admin.create(saleBody(h.now + 3 * HOUR, h.now + 4 * HOUR), null);
		await h.events.save({ ...later, status: 'scheduled' });
		const launch = await h.admin.create(launchBody(h), null);
		await h.events.save({ ...launch, status: 'scheduled' });
		await h.events.save({ ...mine, status: 'scheduled' });
		expect(await h.catalog.overlaps(mine, ['p1', 'p3'])).toEqual([]);
		expect(await h.catalog.overlaps(launch, ['p1'])).toEqual([]);
		expect(await h.catalog.overlaps({ ...mine, endsAt: null }, ['p1'])).toEqual([]);
		h.placements.listForCategory = (async () => [
			{ id: 'plc_live', categoryId: 'cat_new', status: 'live' },
		]) as never;
		expect(await h.catalog.liveCategories(['cat_new'])).toEqual([]);
	});

	it('marks a SKU whose rule cannot apply as refused', async () => {
		const h = harness();
		const created = await h.admin.create(
			{
				...saleBody(h.now + HOUR, h.now + 2 * HOUR),
				sale: {
					categories: [],
					products: [{ productId: 'p3', rule: { kind: 'fixed', value: 5_000, skuPrices: {} } }],
				},
			},
			null,
		);
		const review = await h.admin.review(created.id);
		expect(review.prices).toEqual([
			expect.objectContaining({ sku: 'P3-A', saleINR: null, refused: true, source: 'product' }),
		]);
	});
});

describe('the admin service edges', () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it('lists, refuses an unknown event, and records every change in the audit log', async () => {
		const log = audit();
		const admin = new EventsAdminService(h.events, config, h.catalog, h.clock, h.messenger as never, log as never);
		const created = await admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), 'admin_1');
		expect((await admin.list({ page: 1, pageSize: 20, direction: 'desc' })).items).toHaveLength(1);
		await expect(admin.detail('nope')).rejects.toBeInstanceOf(NotFoundException);
		await admin.remove(created.id, 'admin_1');
		expect(log.append.mock.calls.map(([entry]) => entry.action)).toEqual([
			'event.sale.create',
			'event.sale.delete',
		]);
	});

	it('keeps a scheduled event publishable on save, and moves a running sale’s end only forward', async () => {
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		await h.admin.publish(created.id, null);
		const body = saleBody(h.now + HOUR, h.now + 2 * HOUR);
		await expect(h.admin.update(created.id, { ...body, title: { en: 'Puja Sale' } }, null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		const poke = vi.spyOn(h.clock, 'poke');
		expect((await h.admin.update(created.id, body, null)).status).toBe('scheduled');
		expect(poke).toHaveBeenCalled();

		await h.events.save({ ...(await h.admin.detail(created.id)), status: 'live' });
		await expect(h.admin.update(created.id, { ...body, endsAt: null }, null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(
			h.admin.update(created.id, { ...body, endsAt: new Date(h.now - HOUR).toISOString() }, null),
		).rejects.toBeInstanceOf(BadRequestException);
		const moved = await h.admin.update(
			created.id,
			{ ...body, endsAt: new Date(h.now + 5 * HOUR).toISOString() },
			null,
		);
		expect(moved.endsAt).toBe(new Date(h.now + 5 * HOUR).toISOString());

		await h.events.save({ ...moved, status: 'ended' });
		await expect(h.admin.update(created.id, body, null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(h.admin.update(created.id, { ...body, name: ' ' } as never, null)).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});

	it('keeps a launch without an end, and refuses Publish while a product is not ready', async () => {
		const created = await h.admin.create(launchBody(h), null);
		expect(created.endsAt).toBeNull();
		const saved = await h.admin.update(
			created.id,
			{ ...launchBody(h), endsAt: new Date(h.now + 9 * HOUR).toISOString() },
			null,
		);
		expect(saved.endsAt).toBeNull();
		const result = await h.admin.publish(created.id, null);
		expect(result.problems.map((row) => row.code)).toEqual(['not_ready']);
	});

	it('loses Publish and Unpublish races gracefully', async () => {
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		vi.spyOn(h.events, 'transition').mockResolvedValueOnce(null);
		expect(await h.admin.publish(created.id, null)).toMatchObject({
			published: false,
			problems: [{ code: 'not_draft' }],
		});
		await expect(h.admin.unpublish(created.id, null)).rejects.toBeInstanceOf(BadRequestException);
	});

	it('cancels a launch without taking items back, ends a running sale now, and refuses both otherwise', async () => {
		const launch = await h.admin.create(launchBody(h), null);
		await expect(h.admin.cancel(launch.id, null)).rejects.toBeInstanceOf(BadRequestException);
		await h.events.save({ ...launch, status: 'scheduled' });
		expect((await h.admin.cancel(launch.id, null)).status).toBe('cancelled');

		const sale = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await expect(h.admin.endNow(sale.id, null)).rejects.toBeInstanceOf(BadRequestException);
		await expect(h.admin.endNow(launch.id, null)).rejects.toBeInstanceOf(BadRequestException);
		await h.events.save({ ...sale, status: 'live' });
		await h.book.refresh();
		const ended = await h.admin.endNow(sale.id, null);
		expect(ended.status).toBe('ended');
		expect(ended.saleRecord).not.toBeNull();
	});

	it('sends a test only to an admin with an email', async () => {
		const created = await h.admin.create(saleBody(h.now + HOUR, h.now + 2 * HOUR), null);
		await expect(h.admin.sendTest(created.id, null)).rejects.toBeInstanceOf(BadRequestException);
		expect(await h.admin.sendTest(created.id, 'owner@sahatextile.com')).toEqual({ sent: true });
		expect(h.messenger.test).toHaveBeenCalledWith(
			expect.objectContaining({ id: created.id }),
			'owner@sahatextile.com',
		);
	});
});

describe('the clock edges', () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it('starts its timers outside tests and stops them on shutdown', async () => {
		const vitest = process.env.VITEST;
		const start = vi.spyOn(h.book, 'start').mockImplementation(() => undefined);
		const stop = vi.spyOn(h.book, 'stop');
		const sweep = vi.spyOn(h.clock, 'sweep').mockResolvedValue(undefined);
		h.clock.onApplicationBootstrap();
		expect(start).not.toHaveBeenCalled();
		delete process.env.VITEST;
		try {
			h.clock.onApplicationBootstrap();
		} finally {
			process.env.VITEST = vitest;
		}
		expect(start).toHaveBeenCalled();
		expect(sweep).toHaveBeenCalled();
		h.clock.onApplicationShutdown();
		expect(stop).toHaveBeenCalled();
		h.clock.onApplicationShutdown();
	});

	it('logs a failed pass, and aims a timer at a boundary inside the next minute', async () => {
		vi.spyOn(h.events, 'listPublished').mockRejectedValueOnce(new Error('down'));
		await h.clock.sweep();
		vi.spyOn(h.events, 'listPublished').mockRejectedValueOnce('down');
		await h.clock.sweep();
		vi.useFakeTimers();
		try {
			const soon = await h.admin.create(saleBody(Date.now() + 5_000, Date.now() + HOUR), null);
			await h.events.save({ ...soon, status: 'scheduled' });
			const far = await h.admin.create(saleBody(Date.now() + 2 * EVENT_SWEEP_MS, Date.now() + HOUR), null);
			await h.events.save({ ...far, status: 'scheduled' });
			await h.clock.sweep();
			await h.clock.sweep();
			await vi.advanceTimersByTimeAsync(6_000);
			expect(h.events.rows.get(soon.id)?.status).toBe('live');
		} finally {
			h.clock.onApplicationShutdown();
			vi.useRealTimers();
		}
		await h.events.save({
			...(await h.admin.create(saleBody(Date.now() + 10 * EVENT_SWEEP_MS, Date.now() + HOUR), null)),
			status: 'scheduled',
		});
		h.events.rows.clear();
		await h.clock.sweep();
	});

	it('runs a step once when two servers race, skips missing products, and lists a crashed item', async () => {
		const launch = await h.admin.create(
			launchBody(h, { categoryIds: ['cat_new'], productIds: ['gone', 'x1'], heldProductIds: [] }),
			null,
		);
		h.products.set('x1', product('x1', [], 'discontinued'));
		await h.events.save({ ...launch, status: 'scheduled' });
		vi.spyOn(h.events, 'transition').mockResolvedValueOnce(null);
		await h.clock.start(launch, new Date(h.now + HOUR));
		expect(h.events.rows.get(launch.id)?.status).toBe('scheduled');
		h.builder.goLive.mockRejectedValueOnce(new Error('boom'));
		h.builder.goLive.mockRejectedValueOnce('boom');
		await h.clock.start(launch, new Date(h.now + HOUR));
		const report = h.events.rows.get(launch.id)?.launchReport;
		expect(report?.failed.map((row) => row.productId)).toEqual(['d1', 'd2']);
		expect(report?.failed[0]?.gaps).toEqual([{ field: 'error', locale: null }]);

		const sale = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await h.events.save({ ...sale, status: 'live' });
		vi.spyOn(h.events, 'transition').mockResolvedValueOnce(null);
		await h.clock.end(sale, new Date(h.now + HOUR));
		expect(h.events.rows.get(sale.id)?.status).toBe('live');
		await h.clock.reindex([]);
	});

	it('writes a record without order data, and audits the steps it runs', async () => {
		const log = audit();
		const clock = new EventClock(
			h.events,
			h.book,
			h.productRepo as never,
			h.catalog,
			h.builder as never,
			h.catalogService as never,
			null,
			log as never,
		);
		const sale = await h.admin.create(saleBody(h.now - HOUR, h.now + HOUR), null);
		await h.events.save({ ...sale, status: 'scheduled' });
		await clock.start(sale, new Date(h.now));
		await clock.end((await h.events.findById(sale.id)) as ShopEvent, new Date(h.now + HOUR));
		expect(h.events.rows.get(sale.id)?.saleRecord).toMatchObject({ orders: 0, unitsSold: 0 });
		expect(log.append.mock.calls.map(([entry]) => entry.action)).toEqual([
			'event.sale.start',
			'event.sale.end',
		]);
	});
});

describe('the shop’s event pictures', () => {
	it('sends the popup picture when shown, and nothing for a deleted one or without storage', async () => {
		const h = harness();
		const created = await h.admin.create(
			{ ...saleBody(h.now + HOUR, h.now + 2 * HOUR), popupAssetId: 'asset_1' },
			null,
		);
		await h.admin.publish(created.id, null);
		const asset = { id: 'asset_1', deletedAt: null, renditions: [], alt: {}, width: 1200, height: 1600 };
		const media = { findById: vi.fn(async () => asset) };
		const storage = { getUrl: vi.fn((key: string) => `https://cdn.example.com/${key}`) };
		const shop = new EventsPublicService(h.events, media as never, storage as never);
		const shown = await shop.list('en', new Date(h.now));
		expect(media.findById).toHaveBeenCalledWith('asset_1');
		expect(shown.items[0]).toHaveProperty('popupImage');
		media.findById.mockResolvedValueOnce({ ...asset, deletedAt: '2026-11-01T00:00:00.000Z' } as never);
		expect((await shop.list('en', new Date(h.now))).items[0]?.popupImage).toBeNull();
		media.findById.mockResolvedValueOnce(null as never);
		expect((await shop.list('en', new Date(h.now))).items[0]?.popupImage).toBeNull();
		expect(
			(await new EventsPublicService(h.events, media as never, null).list('en', new Date(h.now))).items[0]
				?.popupImage,
		).toBeNull();
		await h.events.save({ ...(await h.admin.detail(created.id)), showPopup: false });
		expect((await new EventsPublicService(h.events).list('en', new Date(h.now))).items[0]?.popupImage).toBeNull();
		const link = await h.admin.previewLink(created.id);
		expect((await shop.preview(link.token, 'en', new Date(h.now))).items).toHaveLength(1);
		await h.events.save({ ...(await h.admin.detail(created.id)), showPopup: true });
		expect((await shop.preview(link.token, 'en', new Date(h.now))).items).toHaveLength(1);
		await h.events.save({ ...(await h.admin.detail(created.id)), endsAt: new Date(h.now - 1).toISOString() });
		expect((await shop.preview(link.token, 'en', new Date(h.now))).items).toHaveLength(0);
	});
});

describe('the remaining event branches', () => {
	it('skips categories missing from the tree, reads every page, and lists products picked twice once', async () => {
		const h = harness();
		h.products.set('g1', product('g1', ['cat_ghost']));
		const list = h.productRepo.list;
		h.productRepo.list = vi.fn(async (filter: { categoryIds?: string[]; page: number }) => {
			const page = await list({ ...filter, page: 1 });
			return {
				...page,
				items: filter.page <= page.items.length ? [page.items[filter.page - 1]] : [],
				total: 1_000,
			};
		}) as never;
		const sale = await h.admin.create(
			{
				...saleBody(h.now + HOUR, h.now + 2 * HOUR),
				sale: {
					categories: [
						{
							categoryId: 'cat_ghost',
							rule: { kind: 'percent', value: 10, skuPrices: {} },
							exceptions: [],
						},
					],
					products: [],
				},
			},
			null,
		);
		h.variants.push(variant('g1', 'G1-A', 3_000));
		expect(await h.catalog.salePrices(sale)).toEqual([
			expect.objectContaining({ productId: 'g1', saleINR: null, source: 'held', refused: false }),
		]);
		await h.events.save({ ...sale, status: 'live', startsAt: new Date(h.now - HOUR).toISOString() });
		await h.book.refresh();
		expect(h.book.priceFor(variant('g1', 'G1-A', 3_000))).toBeNull();

		const launch = await h.admin.create(
			launchBody(h, { categoryIds: ['cat_new'], productIds: ['d1'], heldProductIds: [] }),
			null,
		);
		expect((await h.catalog.launchTargets(launch)).map((row) => row.product.id)).toEqual(['d1', 'd2']);
		h.placements.listForCategory = (async () => [
			{ id: 'plc_a', categoryId: 'cat_new', status: 'draft' },
			{ id: 'plc_b', categoryId: 'cat_new', status: 'draft' },
		]) as never;
		expect(await h.catalog.liveCategories(['cat_new'])).toEqual(['cat_new']);
		await h.events.save({ ...launch, status: 'scheduled' });
		await h.clock.start(launch, new Date(h.now + HOUR));
		expect(h.events.rows.get(launch.id)?.launchReport?.liveProductIds).toEqual(['d1']);
	});

	it('finds no clash with a sale on other products, and keeps the better of two prices', async () => {
		const h = harness();
		const other = await h.admin.create(
			{
				...saleBody(h.now + HOUR, h.now + 2 * HOUR),
				sale: {
					categories: [],
					products: [
						{ productId: 'p1', rule: { kind: 'percent', value: 50, skuPrices: {} } },
						{ productId: 'p3', rule: { kind: 'fixed', value: 9_000, skuPrices: {} } },
					],
				},
			},
			null,
		);
		await h.events.save({ ...other, status: 'live', startsAt: new Date(h.now - HOUR).toISOString() });
		const mine = await h.admin.create(saleBody(h.now - HOUR / 2, h.now + 2 * HOUR), null);
		expect((await h.catalog.overlaps(mine, ['p3'])).map((row) => row.target)).toEqual(['p3']);
		expect(await h.catalog.overlaps(mine, ['p2'])).toEqual([]);
		await h.events.save({ ...mine, status: 'live' });
		await h.book.refresh();
		// p1: 50% off in one sale beats 20% off in the other; p3's fixed 9,000 can't apply, so 1,600 stays.
		expect(h.book.priceFor(variant('p1', 'P1-A', 5_000))?.saleINR).toBe(2_500);
		expect(h.book.priceFor(variant('p3', 'P3-A', 2_000))?.saleINR).toBe(1_600);
		expect(h.book.productsIn(other.id)).toEqual(expect.arrayContaining(['p1', 'p3']));
		expect(h.book.productsIn(other.id)).not.toContain('p2');
	});

	it('sweeps on its own minute, clears a waiting timer on shutdown, and reviews a published event without problems', async () => {
		vi.useFakeTimers();
		const h = harness();
		const vitest = process.env.VITEST;
		vi.spyOn(h.book, 'start').mockImplementation(() => undefined);
		const sweep = vi.spyOn(h.clock, 'sweep');
		delete process.env.VITEST;
		try {
			const soon = await h.admin.create(saleBody(Date.now() + 5_000, Date.now() + HOUR), null);
			await h.events.save({ ...soon, status: 'scheduled' });
			h.clock.onApplicationBootstrap();
			await vi.advanceTimersByTimeAsync(EVENT_SWEEP_MS);
			expect(sweep.mock.calls.length).toBeGreaterThanOrEqual(2);
			const later = await h.admin.create(saleBody(Date.now() + 30_000, Date.now() + HOUR), null);
			await h.events.save({ ...later, status: 'scheduled' });
			await h.clock.sweep();
			h.clock.onApplicationShutdown();
			const review = await h.admin.review(later.id);
			expect(review.problems).toEqual([]);
		} finally {
			process.env.VITEST = vitest;
			vi.useRealTimers();
		}
	});

	it('logs a send that fails with something other than an error', async () => {
		const customers = {
			list: vi.fn(async () => ({
				items: [{ id: 'c1', email: 'a@example.com', preferredLocale: null }],
				meta: { total: 1 },
			})),
		};
		const consents = { findLatestForUser: vi.fn(async () => ({ categories: { marketing: true } })) };
		const notifications = { send: vi.fn(async () => Promise.reject('down')) };
		const sender = new EventMessenger(customers as never, config, consents as never, notifications as never);
		expect(await sender.announce(ShopEvent.parse({ id: 'evt_1', type: 'sale', name: 'Sale' }))).toBe(0);
	});

	it('leaves out a published sale already past its end, and resolves a picture through storage', async () => {
		const h = harness();
		const created = await h.admin.create(
			{ ...saleBody(h.now + HOUR, h.now + 2 * HOUR), popupAssetId: 'asset_1' },
			null,
		);
		await h.admin.publish(created.id, null);
		const asset = {
			id: 'asset_1',
			visibility: 'public',
			width: 1200,
			height: 1600,
			dominantColor: null,
			thumbHash: null,
			deletedAt: null,
			text: { alt: { en: 'Red silk saree' } },
			derivatives: [{ role: 'banner', storageKey: 'banner/a.webp', width: 1200, height: 1600, format: 'webp' }],
		};
		const shop = new EventsPublicService(
			h.events,
			{ findById: async () => asset } as never,
			{
				getUrl: (key: string) => `https://cdn.example.com/${key}`,
			} as never,
		);
		const shown = await shop.list('en', new Date(h.now));
		expect(shown.items[0]?.popupImage?.roles['banner']?.[0]?.url).toBe('https://cdn.example.com/banner/a.webp');
		expect((await shop.list('en', new Date(h.now + 3 * HOUR))).items).toEqual([]);
	});
});

describe('the sale price book’s membership', () => {
	it('names only the products each sale touches, past a category missing from the tree', async () => {
		const h = harness();
		const rule = { kind: 'percent' as const, value: 10, skuPrices: {} };
		const first = await h.admin.create(
			{
				...saleBody(h.now - HOUR, h.now + HOUR),
				sale: {
					categories: [
						{ categoryId: 'cat_silk', rule, exceptions: [] },
						{ categoryId: 'cat_ghost', rule, exceptions: [] },
					],
					products: [],
				},
			},
			null,
		);
		const second = await h.admin.create(
			{
				...saleBody(h.now - HOUR, h.now + HOUR),
				sale: { categories: [], products: [{ productId: 'p3', rule }] },
			},
			null,
		);
		await h.events.save({ ...first, status: 'live' });
		await h.events.save({ ...second, status: 'live' });
		await h.book.refresh();
		expect(h.book.productsIn(first.id)).toEqual(['p1']);
		expect(h.book.productsIn(second.id)).toEqual(['p3']);
	});
});
