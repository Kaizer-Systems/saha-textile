import { OrderSettings, type CheckoutRequest } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { ShopCheckoutService } from '../src/shop-checkout/shop-checkout.service';

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

function harness(options: { cantShip?: boolean; policy?: string; gateways?: string[] } = {}) {
	const svc = new ShopCheckoutService(
		{
			current: async () => ({
				lines: [
					{
						id: 'l1',
						productId: 'p1',
						variationId: null,
						title: 'Kanjivaram saree',
						quantity: 2,
						soldBy: 'piece',
						unitPriceINR: 10_000,
						lineTotalINR: 20_000,
						problem: null,
					},
				],
			}),
		} as never,
		{
			check: async (input: { countryCode: string; city: string; postalCode: string }) => ({
				...input,
				country: input.countryCode,
				state: '',
			}),
		} as never,
		{
			tryCart: async (request: { delivery: { country: string } }) => ({
				status: options.cantShip ? 'cantShip' : 'priced',
				zone: request.delivery.country === 'IN' ? 'domestic' : 'international',
				amountINR: request.delivery.country === 'IN' ? 200 : 3_800,
				lines: [{ route: options.cantShip ? 'cantShip' : 'ruleSet' }],
				groups: [{ trace: [{ step: 'perUnit', amountINR: 100 }] }],
			}),
		} as never,
		{
			convert: async (_amount: number, code: string) => ({
				currency: code,
				rateFromINR: code === 'INR' ? 1 : 0.0094,
				markupPercent: code === 'INR' ? 0 : 6,
				amount: 0,
			}),
			listEnabled: async () => [{ code: 'INR' }, { code: 'USD' }, { code: 'GBP' }],
		} as never,
		{ factsFor: async () => [{ facts: { categoryPaths: [['cat_silk']], currentSaleINR: null } }] } as never,
		{ findById: async () => ({ id: 'cus_1', addresses: [] }) } as never,
		{ findByCode: async () => null } as never,
		{ countPlacedByCustomer: async () => 1 } as never,
		{ get: async () => OrderSettings.parse({}) } as never,
		{
			getSettings: async () => ({
				homeCountry: 'IN',
				abroadPolicy: options.policy ?? 'exportOffIndianInvoice',
				abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: true },
			}),
		} as never,
		new Map((options.gateways ?? ['ccavenue', 'paypal']).map((id) => [id, {}])) as never,
	);
	return svc;
}

const principal = { userId: 'cus_1', sessionId: 's', audience: 'storefront', role: null, permissions: [] } as never;
const request = (delivery: string, billing: string | null, currency: string): CheckoutRequest => ({
	delivery: { kind: 'new', address: address(delivery) as never, saveAs: null },
	billing: billing ? { kind: 'new', address: address(billing) as never, saveAs: null } : null,
	addressInIndia: null,
	currency,
	couponCodes: [],
});

describe('shop checkout quote (S1–S10, shop01–shop09)', () => {
	it('S1: India to India in ₹, shipping with its reason, Pay on', async () => {
		const quote = await harness().quote(request('IN', null, 'INR'), principal);
		expect(quote).toMatchObject({
			currency: 'INR',
			shipping: { chargeINR: 200, zone: 'domestic' },
			totals: { goods: 20_000, shipping: 200, total: 20_200, totalINR: 20_200 },
			showAddressInIndia: false,
			notes: [],
			currencyPicker: null,
			payBlocked: null,
		});
		expect(quote.shipping.reason).toHaveLength(1);
	});

	it('S8: both abroad in £ asks for the optional address in India and converts with the markup', async () => {
		const quote = await harness().quote(request('GB', null, 'GBP'), principal);
		expect(quote).toMatchObject({
			showAddressInIndia: true,
			shipping: { chargeINR: 3_800, zone: 'international' },
		});
		expect(quote.totals.total).toBe(Math.round(23_800 * 0.0094 * 1.06 * 100) / 100);
	});

	it('S2/S4: billed in India paying in US$ gets the quiet "Pay in ₹ instead" note', async () => {
		expect((await harness().quote(request('IN', 'IN', 'USD'), principal)).notes).toEqual(['payFromIndiaInRupees']);
	});

	it('S5/S7: billed abroad paying in ₹ before HDFC takes foreign cards opens the picker with their currency first', async () => {
		expect((await harness().quote(request('IN', 'GB', 'INR'), principal)).currencyPicker).toEqual({ first: 'GBP' });
	});

	it('S9/S10: Pay stays off for a piece that can’t go there, or a shop that sends nowhere abroad', async () => {
		const cant = await harness({ cantShip: true }).quote(request('GB', null, 'GBP'), principal);
		expect(cant.payBlocked).toBe('pieceCannotShip');
		expect(cant.lines[0]?.cannotShipReason).toBe('cantShipThere');
		expect((await harness({ policy: 'indiaOnly' }).quote(request('GB', null, 'GBP'), principal)).payBlocked).toBe(
			'deliveryAbroadNotOffered',
		);
		expect(
			(await harness({ gateways: ['ccavenue'] }).quote(request('GB', null, 'GBP'), principal)).payBlocked,
		).toBe('noGateway');
	});
});
