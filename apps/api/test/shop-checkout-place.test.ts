import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { OrderSettings, type CheckoutPlace, type Order } from '@saha-textile/contracts';
import { DuplicateOrderKeyError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { ShopCheckoutService } from '../src/shop-checkout/shop-checkout.service';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const address = (countryCode: string, over: Record<string, unknown> = {}) => ({
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: countryCode === 'IN' ? 'Kolkata' : 'London',
	postalCode: countryCode === 'IN' ? '700029' : 'E1 6AN',
	countryCode,
	mobile: {
		countryCallingCode: countryCode === 'IN' ? '91' : '44',
		number: countryCode === 'IN' ? '9830012345' : '7700900123',
	},
	...over,
});
const cartLine = {
	id: 'l1',
	productId: 'p1',
	variationId: null,
	title: 'Kanjivaram saree',
	sku: '',
	quantity: 2,
	soldBy: 'piece',
	image: { assetId: 'med_1', roles: { card: [{ url: 'https://cdn.example/card.webp' }] } },
	options: [
		{ group: 'Blouse', code: 'blouse', value: 'Stitched', priceDeltaINR: 500 },
		{ group: '', code: 'fall', value: 'Yes', priceDeltaINR: 0 },
	],
	measurements: [{ code: 'bust', label: 'Bust', value: 34, unit: 'in' }],
	basePriceINR: 10_000,
	unitPriceINR: 10_000,
	mrpINR: 12_000,
	lineTotalINR: 20_000,
	problem: null,
	setHeading: null,
	children: [],
};

interface Options {
	currency?: string;
	existing?: Partial<Order> | null;
	create?: (order: Order) => Promise<Order>;
	findExisting?: (calls: number) => Partial<Order> | null;
	handoff?: boolean;
	cantShip?: boolean;
	groups?: unknown[];
	current?: Partial<Order> | null;
}

function harness(options: Options = {}) {
	const calls: string[] = [];
	let lookups = 0;
	const svc = new ShopCheckoutService(
		{ current: async () => ({ lines: [cartLine] }) } as never,
		{
			check: async (input: { countryCode: string }) => ({ ...input, country: input.countryCode, state: '' }),
			add: async (_customerId: string, saved: { label: string }) => void calls.push(`save:${saved.label}`),
		} as never,
		{
			tryCart: async () => ({
				status: options.cantShip ? 'cantShip' : 'priced',
				zone: 'domestic',
				amountINR: 200,
				lines: [
					{ lineId: 'l1', units: 2, discounted: false, route: options.cantShip ? 'cantShip' : 'ruleSet' },
				],
				groups: options.groups ?? [
					{ ruleSetId: 'rs_1', version: 2, trace: [] },
					{ ruleSetId: null, version: null, trace: [] },
				],
			}),
		} as never,
		{
			convert: async (_amount: number, code: string) => ({
				currency: code,
				rateFromINR: code === 'INR' ? 1 : 0.0094,
				markupPercent: code === 'INR' ? 0 : 6,
				amount: 0,
			}),
			listEnabled: async () => [{ code: 'INR' }, { code: 'GBP' }],
		} as never,
		{
			factsFor: async () => [
				{
					facts: {
						categoryPaths: [['cat_silk', 'cat_saree']],
						currentSaleINR: 9_500,
						regularSellingINR: 10_000,
					},
				},
			],
		} as never,
		{ orderNumber: async () => 'ST-2611-000001' } as never,
		{
			route: async () => 'loc_main',
			reserve: async () => void calls.push('reserve'),
		} as never,
		{
			start: async (order: Order, locale: string) => {
				calls.push(`start:${locale}`);
				return {
					handoff: options.handoff === false ? null : { kind: 'redirect', url: 'https://gateway.test' },
				};
			},
		} as never,
		{ findById: async () => ({ id: 'cus_1', addresses: [], displayName: null, email: null }) } as never,
		{ findByCode: async () => null } as never,
		{
			findByIdempotencyKey: async () => {
				lookups += 1;
				return options.findExisting ? options.findExisting(lookups) : (options.existing ?? null);
			},
			findById: async () => (options.current === undefined ? null : options.current),
			countPlacedByCustomer: async () => 0,
			create: options.create ?? (async (order: Order) => order),
			update: async (order: Order) => order,
		} as never,
		{ get: async () => OrderSettings.parse({}) } as never,
		{ getSettings: async () => null } as never,
		new Map([
			['ccavenue', {}],
			['paypal', {}],
		]) as never,
		{ withTransaction: async <T>(work: (context: object) => Promise<T>) => work({}) } as never,
	);
	return { svc, calls };
}

const principal = { userId: 'cus_1', sessionId: 's', audience: 'storefront', role: null, permissions: [] } as never;
const place = (currency = 'INR', saveAs: string | null = 'Home'): CheckoutPlace =>
	({
		delivery: { kind: 'new', address: address('IN'), saveAs },
		billing: { kind: 'new', address: address('IN'), saveAs: null },
		addressInIndia: null,
		currency,
		couponCodes: [],
		idempotencyKey: 'key-0123456789abcdef',
	}) as never;

describe('shop checkout Pay: a new order', () => {
	it('refuses a shopper who is not signed in', async () => {
		await expect(harness().svc.place(place(), undefined, 'en', NOW)).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('saves a named address, freezes the cart as order lines, holds the pieces and starts the payment', async () => {
		let made: Order | null = null;
		const { svc, calls } = harness({
			create: async (order) => {
				made = order;
				return order;
			},
		});
		const handoff = await svc.place(place(), principal, 'bn', NOW);
		expect(handoff).toMatchObject({ orderNumber: 'ST-2611-000001', handoff: { kind: 'redirect' } });
		expect(calls).toEqual(['save:Home', 'reserve', 'start:bn']);
		const order = made as unknown as Order;
		expect(order).toMatchObject({
			gateway: 'ccavenue',
			shipsFromLocationId: 'loc_main',
			buyer: { name: 'Ananya Das', email: null },
		});
		expect(order.shipping?.ruleSets).toEqual([{ id: 'rs_1', version: 2, name: '' }]);
		expect(order.currencyRecord).toMatchObject({ source: 'home', inrPerUnit: 1 });
		expect(order.lines[0]).toMatchObject({
			sku: 'p1',
			attributes: { Blouse: 'Stitched', fall: 'Yes' },
			imageUrl: 'https://cdn.example/card.webp',
			pricing: { regularUnitINR: 10_000, mrpUnitINR: 12_000, saleUnitINR: 9_500, discounted: true },
			categoryIds: ['cat_silk', 'cat_saree'],
		});
		expect(order.lines[0]?.addons.map((addon) => addon.code)).toEqual(['blouse', 'bust']);
	});

	it('pays in pounds through PayPal, converting with the markup', async () => {
		let made: Order | null = null;
		const { svc } = harness({
			groups: [],
			create: async (order) => {
				made = order;
				return order;
			},
		});
		await svc.place(place('GBP', null), principal, 'en', NOW);
		const order = made as unknown as Order;
		expect(order).toMatchObject({ gateway: 'paypal', currencyRecord: { source: 'fetch' } });
		expect(order.currencyRecord?.inrPerUnit).toBeCloseTo(106.38, 1);
		expect(order.lines[0]?.unitPricePaid).toBe(Math.round(10_000 * 0.0094 * 1.06 * 100) / 100);
	});

	it('refuses Pay while a piece can’t go there, and when the gateway gives no way to pay', async () => {
		await expect(harness({ cantShip: true }).svc.place(place(), principal, 'en', NOW)).rejects.toBeInstanceOf(
			ConflictException,
		);
		await expect(harness({ handoff: false }).svc.place(place(), principal, 'en', NOW)).rejects.toBeInstanceOf(
			ConflictException,
		);
	});

	it('takes another number when the one it took is already used', async () => {
		let tries = 0;
		const { svc } = harness({
			create: async (order) => {
				tries += 1;
				if (tries === 1) throw new DuplicateOrderKeyError('orderNumber');
				return order;
			},
		});
		await svc.place(place(), principal, 'en', NOW);
		expect(tries).toBe(2);
	});

	it('answers a double press with the order the first press made, and gives up when there is none', async () => {
		const first = {
			id: 'ord_1',
			orderNumber: 'ST-1',
			status: 'awaiting_payment',
			holdUntil: '2026-11-20T10:10:00.000Z',
			locale: null,
			lines: [{ held: true }],
			history: [],
			revision: 1,
		};
		const twice = harness({
			findExisting: (calls) => (calls === 1 ? null : (first as never)),
			create: async () => {
				throw new DuplicateOrderKeyError('idempotencyKey');
			},
		});
		expect((await twice.svc.place(place(), principal, 'en', NOW)).orderNumber).toBe('ST-1');
		const gone = harness({
			create: async () => {
				throw new DuplicateOrderKeyError('idempotencyKey');
			},
		});
		await expect(gone.svc.place(place(), principal, 'en', NOW)).rejects.toBeInstanceOf(DuplicateOrderKeyError);
		const broken = harness({
			create: async () => {
				throw new Error('database down');
			},
		});
		await expect(broken.svc.place(place(), principal, 'en', NOW)).rejects.toThrow('database down');
	});
});

describe('shop checkout Pay: an order already made', () => {
	const existing = (over: Record<string, unknown>) =>
		({
			id: 'ord_1',
			orderNumber: 'ST-1',
			status: 'awaiting_payment',
			holdUntil: null,
			locale: 'en',
			lines: [{ held: false, soldBy: 'piece' }],
			history: [],
			revision: 1,
			...over,
		}) as never;

	it('refuses an order that no longer waits for payment', async () => {
		await expect(
			harness({ existing: existing({ status: 'placed' }) }).svc.place(place(), principal, 'en', NOW),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it('holds the pieces again on the order as it reads now, or as it was when it can’t be read', async () => {
		const reread = harness({ existing: existing({}), current: existing({ revision: 2 }) });
		await reread.svc.place(place(), principal, 'en', NOW);
		expect(reread.calls).toContain('reserve');
		const unread = harness({ existing: existing({}), current: null });
		await unread.svc.place(place(), principal, 'en', NOW);
		expect(unread.calls).toContain('reserve');
		const held = harness({
			existing: existing({}),
			current: existing({ lines: [{ held: true, soldBy: 'piece' }] }),
		});
		await held.svc.place(place(), principal, 'en', NOW);
		expect(held.calls).not.toContain('reserve');
	});

	it('pays at the time given, or now', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const live = harness({
			existing: existing({ holdUntil: '2026-11-20T10:10:00.000Z', lines: [{ held: true }] }),
		});
		await expect(live.svc.place(place(), principal, 'en')).resolves.toMatchObject({ orderNumber: 'ST-1' });
		vi.useRealTimers();
	});
});
