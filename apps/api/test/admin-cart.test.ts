import { PriceZone, ZoneRule } from '@saha-textile/contracts';
import { zonePriceFor, type ZoneLineFacts } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { AdminCartService } from '../src/admin-orders/admin-cart.service';

const page = (sellingINR: number, soldBy: 'piece' | 'metre' = 'piece') => ({
	bundle: null,
	variants: [],
	selected: { sku: soldBy === 'metre' ? 'CLO-1' : 'SAR-1', sellingINR, mrpINR: 12_000, quantity: 5, buyable: true },
	optionGroups:
		soldBy === 'metre'
			? []
			: [
					{
						code: 'stitching',
						role: 'named_add_on',
						label: 'Blouse',
						defaultTermCode: 'none',
						terms: [
							{ code: 'none', label: 'No stitching', priceDeltaINR: 0, requiresMeasurements: false },
							{
								code: 'basic',
								label: 'Basic stitching',
								priceDeltaINR: 800,
								requiresMeasurements: false,
							},
						],
					},
				],
	measurements: null,
	soldBy,
	metre: soldBy === 'metre' ? { shortestCutTenths: 10 } : null,
	madeToOrder: false,
	gallery: [],
});

const zone = PriceZone.parse({
	id: 'zone_w',
	code: 'WHOLESALE',
	name: 'Wholesale',
	status: 'live',
	rules: [
		ZoneRule.parse({
			id: 'off',
			scope: { tier: 'product', productIds: ['p_off'] },
			price: { kind: 'noPrice' },
		}),
		ZoneRule.parse({
			id: 'all',
			scope: { tier: 'allProducts' },
			price: { kind: 'percentOffBase', base: 'regularSelling', percent: 20 },
		}),
	],
});

function service() {
	const pages: Record<string, ReturnType<typeof page>> = {
		p_saree: page(10_000),
		p_off: page(5_000),
		p_cloth: page(500, 'metre'),
	};
	const facts = (productId: string, quantity: number): ZoneLineFacts => ({
		productId,
		sku: productId,
		categoryPaths: [],
		regularSellingINR: productId === 'p_cloth' ? 500 : productId === 'p_off' ? 5_000 : 10_000,
		currentSaleINR: null,
		mrpINR: null,
		purchaseCostINR: null,
		quantity,
		metres: productId === 'p_cloth' ? quantity : null,
		orderGoodsINR: 0,
	});
	return new AdminCartService(
		{ cartRead: async (id: string) => ({ slug: id, title: id, page: pages[id] ?? null }) } as never,
		{
			factsFor: async (items: Array<{ productId: string; quantity: number }>) =>
				items.map((item) => ({ facts: facts(item.productId, item.quantity) })),
			price: zonePriceFor,
		} as never,
		{
			convert: async (_amount: number, code: string) =>
				code === 'USD'
					? { currency: 'USD', rateFromINR: 0.012, markupPercent: 6, amount: 0 }
					: { currency: 'INR', rateFromINR: 1, markupPercent: 0, amount: 0 },
		} as never,
		{
			findById: async (id: string) =>
				id === 'biz_w'
					? { id, roles: { customer: { zoneId: 'zone_w' } } }
					: { id, roles: { customer: { zoneId: 'zone_retail' } } },
		} as never,
		{ findById: async (id: string) => (id === 'zone_w' ? zone : null) } as never,
		{} as never,
	);
}

const line = (productId: string, quantity: number, stitching = false) => ({
	productId,
	variationId: null,
	quantity,
	addons: stitching ? [{ code: 'stitching', value: 'basic' }] : [],
});

describe('admin cart (create order, zone cards)', () => {
	it('prices a shop customer exactly as the shop does, stitching included', async () => {
		const view = await service().price({ buyer: null, currency: 'INR', lines: [line('p_saree', 2, true)] });
		expect(view.lines[0]).toMatchObject({
			unitPriceINR: 10_800,
			lineTotal: 21_600,
			zonePrice: null,
			problem: null,
		});
		expect(view.subtotalINR).toBe(21_600);
	});

	it('prices the piece by the business zone and keeps the stitching at its listed price', async () => {
		const view = await service().price({
			buyer: { kind: 'business', businessId: 'biz_w' },
			currency: 'INR',
			lines: [line('p_saree', 1, true), line('p_off', 1), line('p_cloth', 25)],
		});
		expect(view.lines[0]).toMatchObject({
			unitPriceINR: 8_800,
			zonePrice: { kind: 'priced', unitPriceINR: 8_000, rule: { ruleId: 'all' } },
		});
		expect(view.lines[1]).toMatchObject({
			problem: 'noZonePrice',
			zonePrice: { kind: 'noPrice', reason: 'ruleSaysNoPrice' },
		});
		// Fabric: 2.5 m at the zone's ₹400 a metre.
		expect(view.lines[2]).toMatchObject({ unitPriceINR: 400, lineTotal: 1_000 });
		expect(view.subtotalINR).toBe(9_800);
	});

	it('gives a business on RETAIL the shop price', async () => {
		const view = await service().price({
			buyer: { kind: 'business', businessId: 'biz_r' },
			currency: 'INR',
			lines: [line('p_saree', 1)],
		});
		expect(view.lines[0]).toMatchObject({ unitPriceINR: 10_000, zonePrice: null });
	});

	it('converts at the stored rate plus the PayPal markup when the currency is switched', async () => {
		const view = await service().price({ buyer: null, currency: 'USD', lines: [line('p_saree', 1)] });
		expect(view).toMatchObject({ currency: 'USD', markupPercent: 6, subtotalINR: 10_000 });
		expect(view.lines[0]?.unitPrice).toBe(127.2);
		expect(view.subtotal).toBe(127.2);
	});
});
