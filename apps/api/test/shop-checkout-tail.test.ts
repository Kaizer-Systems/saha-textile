import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Coupon, OrderSettings, type CheckoutRequest, type Order } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { ShopCheckoutService } from '../src/shop-checkout/shop-checkout.service';

const NOW = new Date('2026-11-24T10:00:00.000Z');

const cartLine = (over: Record<string, unknown> = {}) => ({
	id: 'l1',
	productId: 'p1',
	variationId: null,
	title: 'Kanjivaram saree',
	sku: 'KAN-1',
	quantity: 1,
	soldBy: 'piece',
	image: null,
	options: [],
	measurements: [],
	basePriceINR: 10_000,
	unitPriceINR: 10_000,
	mrpINR: null,
	lineTotalINR: 10_000,
	problem: null,
	setHeading: null,
	children: [],
	...over,
});

/** A saved address from before every field was asked: no country code, state, pincode or phone. */
const savedLondon = {
	id: 'adr_ldn',
	label: 'Flat',
	isDefault: true,
	fullName: 'Ananya Das',
	line1: '1 High St',
	city: 'London',
	country: 'GB',
};
const savedKolkata = {
	id: 'adr_kol',
	label: 'Home',
	isDefault: false,
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: 'Kolkata',
	country: 'IN',
};
const typedAddress = (countryCode: string) => ({
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	city: countryCode === 'IN' ? 'Kolkata' : 'London',
	postalCode: countryCode === 'IN' ? '700029' : 'E1 6AN',
	countryCode,
	mobile: { countryCallingCode: '91', number: '9830012345' },
});
const indiaAddress = {
	fullName: 'Ananya Das',
	line1: '12 Lake Road',
	line2: '',
	city: 'Kolkata',
	state: 'West Bengal',
	postalCode: '700029',
};

const coupon = (code: string, over: Record<string, unknown> = {}) =>
	Coupon.parse({ id: `cpn_${code}`, code, title: code, kind: 'percentOff', value: 10, combines: true, ...over });

interface Options {
	lines?: Array<Record<string, unknown>>;
	customer?: Record<string, unknown> | null;
	tryCart?: Record<string, unknown>;
	convertFails?: boolean;
	rate?: number;
	coupons?: Coupon[];
	settings?: Record<string, unknown>;
	enabled?: string[];
	facts?: unknown[];
}

function harness(options: Options = {}) {
	const created: Order[] = [];
	const svc = new ShopCheckoutService(
		{ current: async () => ({ lines: options.lines ?? [cartLine()] }) } as never,
		{
			check: async (input: { countryCode: string }) => ({ ...input, country: input.countryCode, state: '' }),
			add: async () => undefined,
		} as never,
		{
			tryCart: async () => ({
				status: 'priced',
				zone: 'domestic',
				amountINR: 200,
				lines: [{ lineId: 'l1', units: 1, discounted: false, route: 'ruleSet' }],
				groups: [{ ruleSetId: 'rs_1', version: 1, trace: [{ step: 'perUnit' }] }],
				...options.tryCart,
			}),
		} as never,
		{
			convert: async (_amount: number, code: string) => {
				if (options.convertFails) throw new Error('unknown currency');
				return {
					currency: code,
					rateFromINR: options.rate ?? (code === 'INR' ? 1 : 0.0094),
					markupPercent: 0,
					amount: 0,
				};
			},
			listEnabled: async () => (options.enabled ?? ['INR', 'GBP']).map((code) => ({ code })),
		} as never,
		{
			factsFor: async () =>
				options.facts ?? [
					{ facts: { categoryPaths: [['cat_silk']], currentSaleINR: null, regularSellingINR: 10_000 } },
				],
		} as never,
		{ orderNumber: async () => 'ST-2611-000009' } as never,
		{ route: async () => 'loc_main', reserve: async () => undefined } as never,
		{ start: async () => ({ handoff: { kind: 'redirect', url: 'https://gateway.test' } }) } as never,
		{
			findById: async () =>
				options.customer === undefined
					? { id: 'cus_1', addresses: [savedLondon, savedKolkata], displayName: null, email: null }
					: options.customer,
		} as never,
		{
			findByCode: async (code: string) => (options.coupons ?? []).find((row) => row.code === code) ?? null,
			usesBy: async () => 0,
		} as never,
		{
			findByIdempotencyKey: async () => null,
			countPlacedByCustomer: async () => 0,
			create: async (order: Order) => {
				created.push(order);
				return order;
			},
		} as never,
		{ get: async () => OrderSettings.parse(options.settings ?? {}) } as never,
		{
			getSettings: async () => ({
				homeCountry: 'IN',
				abroadPolicy: 'exportOffIndianInvoice',
				abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: true },
			}),
		} as never,
		new Map([
			['ccavenue', {}],
			['paypal', {}],
		]) as never,
		{ withTransaction: async <T>(work: (context: object) => Promise<T>) => work({}) } as never,
	);
	return { svc, created };
}

const shopper = { userId: 'cus_1', sessionId: 's', audience: 'storefront', role: null, permissions: [] } as never;
const typed = (country: string) => ({ kind: 'new', address: typedAddress(country), saveAs: null }) as never;
const saved = (id: string) => ({ kind: 'saved', savedAddressId: id }) as never;
const ask = (over: Partial<CheckoutRequest> = {}): CheckoutRequest => ({
	delivery: typed('IN'),
	billing: null,
	addressInIndia: null,
	currency: 'INR',
	couponCodes: [],
	...over,
});

describe('shop checkout: the last cases', () => {
	it('needs a signed-in shopper whose account still exists', async () => {
		await expect(harness().svc.quote(ask(), undefined)).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(harness({ customer: null }).svc.quote(ask(), shopper)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
	});

	it('keeps Pay off for an empty cart, with no shipping asked and every coupon refused', async () => {
		const quote = await harness({ lines: [], coupons: [coupon('TENOFF')] }).svc.quote(
			ask({ couponCodes: ['tenoff', 'nosuch'] }),
			shopper,
			NOW,
		);
		expect(quote).toMatchObject({
			payBlocked: 'cartEmpty',
			shipping: { chargeINR: 0, reason: [], zone: 'domestic' },
			couponRefusals: [
				{ code: 'NOSUCH', refusal: 'unknown' },
				{ code: 'TENOFF', refusal: 'nothingEligible' },
			],
		});
	});

	it('keeps Pay off for a line that cannot be bought, but not for one only limited', async () => {
		const limited = await harness({ lines: [cartLine({ problem: 'limited' })] }).svc.quote(ask(), shopper, NOW);
		expect(limited.payBlocked).toBeNull();
		const gone = await harness({
			lines: [cartLine({ problem: 'limited' }), cartLine({ id: 'l2', problem: 'out_of_stock' })],
		}).svc.quote(ask(), shopper, NOW);
		expect(gone.payBlocked).toBe('lineProblem');
	});

	it('stacks combining coupons on the same line, frees the delivery, and leaves a line without facts out of categories', async () => {
		const { svc } = harness({
			lines: [cartLine(), cartLine({ id: 'l2', productId: 'p2', lineTotalINR: 5_000, unitPriceINR: 5_000 })],
			coupons: [
				coupon('TENOFF'),
				coupon('HUNDRED', { kind: 'amountOff', value: 100 }),
				coupon('SHIPFREE', { kind: 'freeDelivery', value: 0 }),
			],
		});
		const quote = await svc.quote(ask({ couponCodes: ['TENOFF', 'HUNDRED', 'SHIPFREE'] }), shopper, NOW);
		expect(quote.coupons.map((row) => [row.code, row.amountINR, row.deliveryAmountINR])).toEqual([
			['TENOFF', 1_500, 0],
			['HUNDRED', 100, 0],
			['SHIPFREE', 0, 200],
		]);
		expect(quote.totals).toMatchObject({ goods: 15_000, coupon: 1_600, shipping: 0, totalINR: 13_400 });
		expect(quote.lines.map((line) => line.couponAmount)).toEqual([1_066.67, 533.33]);
	});

	it('reads no delivery charge from a parcel the rules could not price, and names the zone itself', async () => {
		const quote = await harness({
			tryCart: { status: 'noRule', amountINR: null, zone: undefined, groups: [], lines: [] },
			coupons: [coupon('SHIPFREE', { kind: 'freeDelivery', value: 0 })],
		}).svc.quote(
			ask({ delivery: typed('GB'), addressInIndia: indiaAddress, currency: 'GBP', couponCodes: ['SHIPFREE'] }),
			shopper,
			NOW,
		);
		expect(quote.shipping).toMatchObject({ chargeINR: 0, zone: 'international' });
	});

	it('tells a shopper abroad that duty is paid on delivery, and says nothing of it at home', async () => {
		const settings = { importDutyNotice: 'buyerPaysOnDelivery' };
		const abroad = await harness({ settings }).svc.quote(
			ask({ delivery: typed('GB'), addressInIndia: indiaAddress, currency: 'GBP' }),
			shopper,
			NOW,
		);
		expect(abroad.notes).toContain('importDutyBuyerPays');
		const home = await harness({ settings }).svc.quote(ask(), shopper, NOW);
		expect(home.notes).toEqual([]);
	});

	it('opens no currency picker when no foreign currency is on sale', async () => {
		const quote = await harness({ enabled: ['INR'] }).svc.quote(ask({ billing: typed('GB') }), shopper, NOW);
		expect(quote.currencyPicker).toBeNull();
	});

	it('invoices to the address in India given at checkout when both addresses are abroad', async () => {
		const quote = await harness().svc.quote(
			ask({ delivery: typed('GB'), addressInIndia: indiaAddress, currency: 'GBP' }),
			shopper,
			NOW,
		);
		expect(quote).toMatchObject({ showAddressInIndia: false, payBlocked: null });
	});

	it('reads saved addresses without a country code, state or pincode, and refuses one that is gone', async () => {
		const quote = await harness().svc.quote(
			ask({ delivery: saved('adr_kol'), billing: saved('adr_ldn') }),
			shopper,
			NOW,
		);
		expect(quote.currencyPicker).toEqual({ first: 'GBP' });
		await expect(harness().svc.quote(ask({ delivery: saved('adr_none') }), shopper, NOW)).rejects.toMatchObject({
			response: { issues: [{ code: 'address_missing' }] },
		});
	});

	it('refuses a currency that is not on sale', async () => {
		await expect(
			harness({ convertFails: true }).svc.quote(ask({ currency: 'XYZ' }), shopper, NOW),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('places an order to a saved address abroad, billed there too, with its India address, coupon and no rate inverse', async () => {
		const { svc, created } = harness({ rate: 0, coupons: [coupon('TENOFF')] });
		await svc.place(
			{
				...ask({
					delivery: saved('adr_ldn'),
					addressInIndia: indiaAddress,
					currency: 'GBP',
					couponCodes: ['TENOFF'],
				}),
				idempotencyKey: 'key-1',
			} as never,
			shopper,
			'en',
			NOW,
		);
		const order = created[0] as Order;
		expect(order.shipping).toMatchObject({
			deliveryCountry: 'GB',
			ruleSets: [{ id: 'rs_1', version: 1, name: '' }],
		});
		expect(order.buyer).toMatchObject({ mobile: null });
		expect(order.addresses).toMatchObject({
			billing: { savedAddressId: 'adr_ldn' },
			delivery: { savedAddressId: 'adr_ldn' },
			billingSameAsDelivery: true,
			addressInIndia: { city: 'Kolkata', savedAddressId: null },
			invoice: { source: 'addressInIndia' },
		});
		expect(order.currencyRecord).toMatchObject({ code: 'GBP', rateFromINR: 0, inrPerUnit: null });
		expect(order.balance).toMatchObject({ couponINR: 1_000 });
		expect(order.lines[0]?.pricing).toMatchObject({ mrpUnitINR: null });
	});
});
