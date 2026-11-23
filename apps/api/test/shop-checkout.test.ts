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
		{} as never,
		{} as never,
		{} as never,
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
		{} as never,
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

describe('shop checkout Pay (place)', () => {
	it('Pay again on the same order after its hold ended: the pieces are held again and a new attempt starts', async () => {
		const calls: string[] = [];
		const existing = {
			id: 'ord_1',
			orderNumber: 'ST-2611-482190',
			status: 'awaiting_payment',
			holdUntil: null,
			locale: 'bn',
			revision: 3,
			history: [],
			lines: [{ lineId: 'l1', productId: 'p1', sku: 'S', quantity: 1, held: false }],
		};
		const svc = new ShopCheckoutService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{ reserve: async () => void calls.push('reserve') } as never,
			{
				start: async (order: { holdUntil: string }, locale: string) => {
					calls.push(`start:${locale}:${order.holdUntil}`);
					return { handoff: { kind: 'redirect', url: 'https://gateway.test' } };
				},
			} as never,
			{} as never,
			{} as never,
			{
				findByIdempotencyKey: async (key: string) =>
					key === 'shop:cus_1:key-0123456789abcdef' ? existing : null,
				findById: async () => existing,
				update: async (order: object) => order,
			} as never,
			{} as never,
			{} as never,
			new Map() as never,
			{ withTransaction: async <T>(work: (context: object) => Promise<T>) => work({}) } as never,
		);
		const handoff = await svc.place(
			{ ...request('IN', null, 'INR'), idempotencyKey: 'key-0123456789abcdef' },
			principal,
			'en',
			new Date('2026-11-20T10:00:00.000Z'),
		);
		expect(handoff).toMatchObject({ orderNumber: 'ST-2611-482190', handoff: { kind: 'redirect' } });
		expect(calls).toEqual(['reserve', 'start:bn:2026-11-20T10:15:00.000Z']);
	});
});

describe('a set at checkout (bundle builder brief E05–E08)', () => {
	type LinesOf = { orderLines(built: unknown, at: string): import('@saha-textile/contracts').OrderLine[] };
	const svc = new ShopCheckoutService(
		...(Array.from({ length: 15 }, () => ({}) as never) as unknown as ConstructorParameters<
			typeof ShopCheckoutService
		>),
	) as unknown as LinesOf;
	const child = (over: Record<string, unknown>) => ({
		role: 'piece',
		key: 'k',
		parentKey: null,
		level: null,
		productId: 'p',
		title: 'Piece',
		sku: 'SKU',
		image: null,
		variantId: null,
		variantLabel: null,
		quantity: 1,
		priceINR: 0,
		mrpINR: null,
		...over,
	});
	const built = (setHeading: 'components' | null) => ({
		quote: { currency: 'INR' },
		conversion: { rateFromINR: 1, markupPercent: 0 },
		facts: [],
		couponByLine: new Map([['l1', 1000]]),
		view: {
			lines: [
				{
					id: 'l1',
					productId: setHeading ? 'set1' : 'saree1',
					variationId: null,
					title: setHeading ? 'Peacock Blue set' : 'Peacock Blue saree',
					sku: 'BND-0001',
					quantity: 2,
					image: null,
					options: [],
					measurements: [],
					basePriceINR: 44900,
					unitPriceINR: 44900,
					mrpINR: 48400,
					lineTotalINR: 89800,
					setHeading,
					children: setHeading
						? [
								child({
									key: 'a',
									productId: 'p933',
									title: 'Peacock Blue',
									priceINR: 33211.16,
									mrpINR: 35800,
								}),
								child({
									role: 'free',
									key: 'a>petti',
									parentKey: 'a',
									productId: 'pt',
									title: 'Petticoat',
									variantId: 'v-m',
									variantLabel: 'M',
									mrpINR: 799,
								}),
								child({
									key: 'b',
									productId: 'p1086',
									title: 'Off White',
									priceINR: 11688.84,
									mrpINR: 12600,
								}),
							]
						: [
								child({
									role: 'free',
									key: 'product>pt',
									productId: 'pt',
									title: 'Petticoat',
									mrpINR: 799,
								}),
							],
				},
			],
		},
	});

	it('keeps the set as a line with no money, its pieces and free item beneath carrying it', () => {
		const lines = svc.orderLines(built('components'), '2026-11-22T00:00:00.000Z');
		expect(
			lines.map((line) => [line.lineId, line.role, line.parentLineId, line.quantity, line.lineTotalINR]),
		).toEqual([
			['l1', 'bundle', null, 2, 0],
			['l1~a', 'piece', 'l1', 2, 66422.32],
			['l1~a>petti', 'free', 'l1~a', 2, 0],
			['l1~b', 'piece', 'l1', 2, 23377.68],
		]);
		expect(lines[0]?.set).toEqual({ heading: 'components', priceINR: 44900, separatelyINR: 48400 });
		expect(lines.reduce((sum, line) => sum + line.lineTotalINR, 0)).toBeCloseTo(89800, 2);
		expect(Math.round(lines.reduce((sum, line) => sum + line.couponINR, 0) * 100)).toBe(100000);
		expect(lines[2]).toMatchObject({ variationId: 'v-m', attributes: { Variation: 'M' } });
	});

	it("leaves a product's coupon on its own line, with its free item beneath at ₹0", () => {
		const lines = svc.orderLines(built(null), '2026-11-22T00:00:00.000Z');
		expect(lines.map((line) => [line.role, line.parentLineId, line.lineTotalINR, line.couponINR])).toEqual([
			['product', null, 89800, 1000],
			['free', 'l1', 0, 0],
		]);
	});
});
