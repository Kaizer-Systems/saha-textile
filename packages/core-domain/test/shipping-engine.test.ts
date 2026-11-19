import { describe, expect, it } from 'vitest';

import type {
	ShippingCartSnapshot,
	ShippingException,
	ShippingRuleSetBody,
	ShippingSettings,
	ShippingSnapshotLine,
} from '@saha-textile/contracts';

import {
	asksForAddressInHomeCountry,
	chargeableGrams,
	decideInvoiceAddress,
	evaluateShippingRuleSet,
	foreignAmountFromINR,
	priceShipping,
	resolveShippingBox,
	resolveShippingCharges,
	routePaymentGateway,
	routeShippingLine,
	validateShippingRuleSet,
	volumetricGrams,
	PREMADE_RULE_SETS,
	type ActiveRuleSet,
} from '../src/shipping/index';

/* Saha Textile's two rule sets exactly as the builder stores them (brief rb02, rb03). */
const SAHA_TEXTILE_DOMESTIC: ShippingRuleSetBody = {
	steps: [
		{
			id: 'step-1',
			scope: 'eachLine',
			combine: 'sum',
			node: {
				kind: 'if',
				id: 'if-1',
				when: {
					kind: 'group',
					id: 'when-1',
					join: 'all',
					items: [{ kind: 'condition', id: 'c-1', field: 'line.discounted', op: 'is', value: true }],
				},
				then: { kind: 'result', id: 'r-1', result: { kind: 'productCharge', charge: 'domestic', per: 'unit' } },
				otherwise: { kind: 'result', id: 'r-2', result: { kind: 'free' } },
			},
		},
	],
	adjust: [],
};

const SAHA_TEXTILE_INTERNATIONAL: ShippingRuleSetBody = {
	steps: [
		{
			id: 'step-1',
			scope: 'wholeCart',
			combine: 'sum',
			node: {
				kind: 'result',
				id: 'r-1',
				result: {
					kind: 'firstAndFurther',
					first: { from: 'product', charge: 'internationalFirst' },
					further: { from: 'product', charge: 'internationalFurther' },
					count: 'acrossCart',
				},
			},
		},
	],
	adjust: [],
};

const SAHA_TEXTILE_CHARGES = { domestic: 100, internationalFirst: 2000, internationalFurther: 900 };

const line = (id: string, over: Partial<ShippingSnapshotLine> = {}): ShippingSnapshotLine => ({
	lineId: id,
	productId: `p-${id}`,
	categoryIds: ['sarees'],
	mainCategoryId: 'sarees',
	mainCategoryAncestorIds: [],
	freeShipping: false,
	units: 1,
	sellingPriceINR: 2450,
	mrpINR: 2450,
	onSaleEvent: false,
	soldBy: 'piece',
	madeToOrder: false,
	chargeableWeightGrams: 600,
	charges: SAHA_TEXTILE_CHARGES,
	...over,
});

const cart = (
	lines: ShippingSnapshotLine[],
	country = 'IN',
	over: Partial<ShippingCartSnapshot> = {},
): ShippingCartSnapshot => ({
	lines,
	delivery: {
		country,
		state: country === 'IN' ? 'West Bengal' : null,
		pincode: country === 'IN' ? '700045' : 'NW3 4DU',
	},
	shopper: { signedIn: true, groups: [], firstOrder: false },
	...over,
});

const priced = (outcome: ReturnType<typeof evaluateShippingRuleSet>): number => {
	if (outcome.status !== 'priced') throw new Error(`expected priced, got ${outcome.status}`);
	return outcome.amountINR;
};

describe('Saha Textile — Domestic', () => {
	it('charges ₹100 per unit of a discounted piece and nothing for full-price pieces (brief shop01: ₹200)', () => {
		const snapshot = cart([
			line('a', { units: 2, sellingPriceINR: 10200, mrpINR: 12000 }),
			line('b', { units: 1 }),
		]);
		const outcome = evaluateShippingRuleSet({ body: SAHA_TEXTILE_DOMESTIC, snapshot, zone: 'domestic' });
		expect(priced(outcome)).toBe(200);
		if (outcome.status !== 'priced') return;
		expect(outcome.trace.map((t) => [t.lineIds[0], t.result, t.amountINR])).toEqual([
			['a', 'productCharge', 200],
			['b', 'free', 0],
		]);
		expect(outcome.trace[0]?.path).toEqual(['step-1', 'if-1', 'then', 'r-1']);
	});

	it('counts a sale-event price below MRP as discounted, and MRP-priced pieces as free', () => {
		const onSale = line('a', { units: 3, sellingPriceINR: 2000, mrpINR: 2450, onSaleEvent: true });
		expect(
			priced(
				evaluateShippingRuleSet({ body: SAHA_TEXTILE_DOMESTIC, snapshot: cart([onSale]), zone: 'domestic' }),
			),
		).toBe(300);
		const noMrp = line('b', { mrpINR: null });
		expect(
			priced(evaluateShippingRuleSet({ body: SAHA_TEXTILE_DOMESTIC, snapshot: cart([noMrp]), zone: 'domestic' })),
		).toBe(0);
	});

	it('reads the category charge, so a changed category charge changes the price without touching the rule set', () => {
		const snapshot = cart([
			line('a', {
				units: 2,
				sellingPriceINR: 900,
				mrpINR: 1000,
				charges: { ...SAHA_TEXTILE_CHARGES, domestic: 150 },
			}),
		]);
		expect(priced(evaluateShippingRuleSet({ body: SAHA_TEXTILE_DOMESTIC, snapshot, zone: 'domestic' }))).toBe(300);
	});

	it('treats a length of fabric as one unit', () => {
		const metre = line('m', { soldBy: 'metre', units: 1, sellingPriceINR: 900, mrpINR: 1200 });
		expect(
			priced(evaluateShippingRuleSet({ body: SAHA_TEXTILE_DOMESTIC, snapshot: cart([metre]), zone: 'domestic' })),
		).toBe(100);
	});

	it('is valid to make active', () => {
		expect(validateShippingRuleSet(SAHA_TEXTILE_DOMESTIC, 'domestic')).toEqual({ issues: [], canActivate: true });
	});
});

describe('Saha Textile — International', () => {
	const intl = (lines: ShippingSnapshotLine[]): number =>
		priced(
			evaluateShippingRuleSet({
				body: SAHA_TEXTILE_INTERNATIONAL,
				snapshot: cart(lines, 'GB'),
				zone: 'international',
			}),
		);

	it('charges ₹2,000 for the first unit and ₹900 for each further unit across the cart', () => {
		expect(intl([line('a')])).toBe(2000);
		expect(intl([line('a', { units: 3 })])).toBe(3800);
		expect(intl([line('a'), line('b', { units: 2 })])).toBe(3800);
		expect(intl([line('a', { units: 4 }), line('b', { units: 6 })])).toBe(10100);
	});

	it('takes the highest first-unit charge in the cart, and every other unit its own further charge', () => {
		const dear = line('dear', { charges: { domestic: 100, internationalFirst: 2500, internationalFurther: 1000 } });
		const cheap = line('cheap', { units: 2 });
		// 2,500 (dear's first) + 900 × 2 (cheap's further units)
		expect(intl([cheap, dear])).toBe(4300);
	});

	it('is valid for the international zone and warns when its product charge is used for domestic', () => {
		expect(validateShippingRuleSet(SAHA_TEXTILE_INTERNATIONAL, 'international').canActivate).toBe(true);
		const domestic = validateShippingRuleSet(SAHA_TEXTILE_INTERNATIONAL, 'domestic');
		expect(domestic.canActivate).toBe(true);
		expect(domestic.issues.map((i) => [i.code, i.severity])).toContainEqual(['charge_zone_mismatch', 'warning']);
	});
});

describe('pre-made and other rule sets', () => {
	it('"Highest charge only": each line\'s charge once, only the highest counts', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'eachLine',
					combine: 'highest',
					node: {
						kind: 'result',
						id: 'r',
						result: { kind: 'productCharge', charge: 'domestic', per: 'once' },
					},
				},
			],
			adjust: [],
		};
		const snapshot = cart([
			line('a', { units: 5 }),
			line('b', { charges: { ...SAHA_TEXTILE_CHARGES, domestic: 180 } }),
		]);
		expect(priced(evaluateShippingRuleSet({ body, snapshot, zone: 'domestic' }))).toBe(180);
	});

	it('another business: free above ₹4,999 for three states or VIP unless made to order, else ₹149, rounded up to ₹10 (rb06)', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'wholeCart',
					combine: 'sum',
					node: {
						kind: 'if',
						id: 'if',
						when: {
							kind: 'group',
							id: 'g',
							join: 'all',
							items: [
								{ kind: 'condition', id: 'c1', field: 'cart.subtotal', op: 'atLeast', value: 4999 },
								{
									kind: 'group',
									id: 'g2',
									join: 'any',
									items: [
										{
											kind: 'condition',
											id: 'c2',
											field: 'delivery.state',
											op: 'isOneOf',
											value: ['West Bengal', 'Odisha', 'Jharkhand'],
										},
										{ kind: 'condition', id: 'c3', field: 'shopper.group', op: 'is', value: 'VIP' },
									],
								},
								{ kind: 'condition', id: 'c4', field: 'cart.hasMadeToOrder', op: 'is', value: false },
							],
						},
						then: { kind: 'result', id: 'free', result: { kind: 'free' } },
						otherwise: { kind: 'result', id: 'flat', result: { kind: 'amount', amount: 149, per: 'once' } },
					},
				},
			],
			adjust: [{ kind: 'roundUp', id: 'round', to: 10 }],
		};
		expect(validateShippingRuleSet(body).canActivate).toBe(true);
		const big = line('a', { units: 3, sellingPriceINR: 7000, mrpINR: 7000 });
		expect(priced(evaluateShippingRuleSet({ body, snapshot: cart([big]), zone: 'domestic' }))).toBe(0);
		const elsewhere = cart([big], 'IN', { delivery: { country: 'IN', state: 'Kerala', pincode: '682001' } });
		expect(priced(evaluateShippingRuleSet({ body, snapshot: elsewhere, zone: 'domestic' }))).toBe(150);
		const vip = { ...elsewhere, shopper: { signedIn: true, groups: ['vip'], firstOrder: false } };
		expect(priced(evaluateShippingRuleSet({ body, snapshot: vip, zone: 'domestic' }))).toBe(0);
		const madeToOrder = cart([big, line('m', { madeToOrder: true })]);
		expect(priced(evaluateShippingRuleSet({ body, snapshot: madeToOrder, zone: 'domestic' }))).toBe(150);
	});

	it('weight bands use chargeable weight (actual or volumetric, whichever is more)', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'wholeCart',
					combine: 'sum',
					node: {
						kind: 'bands',
						id: 'b',
						field: 'cart.chargeableWeight',
						bands: [
							{
								id: 'b1',
								from: 0,
								to: 500,
								then: { kind: 'result', id: 'r1', result: { kind: 'amount', amount: 60, per: 'once' } },
							},
							{
								id: 'b2',
								from: 500,
								to: 2000,
								then: {
									kind: 'result',
									id: 'r2',
									result: { kind: 'amount', amount: 120, per: 'once' },
								},
							},
							{
								id: 'b3',
								from: 2000,
								to: null,
								then: { kind: 'result', id: 'r3', result: { kind: 'amount', amount: 40, per: 'kg' } },
							},
						],
						otherwise: null,
					},
				},
			],
			adjust: [],
		};
		expect(validateShippingRuleSet(body).canActivate).toBe(true);
		const at = (grams: number, units = 1): number =>
			priced(
				evaluateShippingRuleSet({
					body,
					snapshot: cart([line('a', { chargeableWeightGrams: grams, units })]),
					zone: 'domestic',
				}),
			);
		expect(at(400)).toBe(60);
		expect(at(500)).toBe(120);
		expect(at(1999)).toBe(120);
		expect(at(1100, 2)).toBe(120); // 2,200 g → 3 started kg × ₹40
		expect(at(1100, 3)).toBe(160); // 3,300 g → 4 started kg
		expect(chargeableGrams({ weightGrams: 600, lengthCm: 40, widthCm: 30, heightCm: 10 })).toBe(2400);
		expect(volumetricGrams({ weightGrams: null, lengthCm: 30, widthCm: null, heightCm: 5 })).toBeNull();
		expect(chargeableGrams({ weightGrams: null, lengthCm: null, widthCm: null, heightCm: null })).toBeNull();
	});

	it('adjustments: free above an amount, a minimum and a maximum', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'eachUnit',
					combine: 'sum',
					node: { kind: 'result', id: 'r', result: { kind: 'amount', amount: 75, per: 'once' } },
				},
			],
			adjust: [
				{ kind: 'minimum', id: 'min', amount: 100 },
				{ kind: 'maximum', id: 'max', amount: 400 },
				{ kind: 'freeAbove', id: 'free', subtotal: 20000 },
			],
		};
		const at = (units: number, price = 1000): number =>
			priced(
				evaluateShippingRuleSet({
					body,
					snapshot: cart([line('a', { units, sellingPriceINR: price, mrpINR: price })]),
					zone: 'domestic',
				}),
			);
		expect(at(1)).toBe(100);
		expect(at(3)).toBe(225);
		expect(at(9)).toBe(400);
		expect(at(4, 5000)).toBe(0);
	});
});

describe('what stops a rule set', () => {
	it('a branch with no result gives "noResult", never a silent ₹0', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'eachLine',
					combine: 'sum',
					node: {
						kind: 'if',
						id: 'if',
						when: {
							kind: 'group',
							id: 'g',
							join: 'all',
							items: [{ kind: 'condition', id: 'c', field: 'line.discounted', op: 'is', value: true }],
						},
						then: { kind: 'result', id: 'r', result: { kind: 'amount', amount: 100, per: 'unit' } },
						otherwise: null,
					},
				},
			],
			adjust: [],
		};
		const outcome = evaluateShippingRuleSet({ body, snapshot: cart([line('full')]), zone: 'domestic' });
		expect(outcome.status).toBe('noResult');
		if (outcome.status === 'noResult')
			expect(outcome.where).toEqual([{ stepId: 's', lineIds: ['full'], blockId: 'if:otherwise' }]);
	});

	it('"can\'t ship" and "courier quote" are reported, not priced', () => {
		const cantShip: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'eachLine',
					combine: 'sum',
					node: { kind: 'result', id: 'r', result: { kind: 'cantShip', message: { en: 'Not sent abroad' } } },
				},
			],
			adjust: [],
		};
		const outcome = evaluateShippingRuleSet({
			body: cantShip,
			snapshot: cart([line('a')], 'GB'),
			zone: 'international',
		});
		expect(outcome).toMatchObject({
			status: 'cantShip',
			lines: [{ lineId: 'a', message: { en: 'Not sent abroad' } }],
		});
		const quote: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'wholeCart',
					combine: 'sum',
					node: { kind: 'result', id: 'r', result: { kind: 'courierQuote' } },
				},
			],
			adjust: [],
		};
		expect(evaluateShippingRuleSet({ body: quote, snapshot: cart([line('a')]), zone: 'domestic' }).status).toBe(
			'needsQuote',
		);
	});

	it('names every mistake of rb07 before the rule set can go live', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'eachLine',
					combine: 'sum',
					node: {
						kind: 'if',
						id: 'if',
						when: {
							kind: 'group',
							id: 'g',
							join: 'all',
							items: [
								{ kind: 'condition', id: 'c1', field: 'line.discounted', op: 'is', value: true },
								{
									kind: 'condition',
									id: 'c2',
									field: 'line.discountPercent',
									op: 'moreThan',
									value: 120,
								},
							],
						},
						then: { kind: 'result', id: 'r', result: { kind: 'amount', amount: null, per: 'unit' } },
						otherwise: null,
					},
				},
			],
			adjust: [],
		};
		const result = validateShippingRuleSet(body);
		expect(result.canActivate).toBe(false);
		expect(result.issues.map((i) => [i.code, i.blockId])).toEqual([
			['condition_impossible', 'c2'],
			['amount_missing', 'r'],
			['branch_no_result', 'if'],
		]);
	});

	it('catches scope misuse, empty conditions, band gaps and overlaps, and duplicate ids', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'wholeCart',
					combine: 'sum',
					node: {
						kind: 'if',
						id: 'if',
						when: {
							kind: 'group',
							id: 'g',
							join: 'all',
							items: [
								{ kind: 'condition', id: 'c1', field: 'line.discounted', op: 'is', value: true },
								{ kind: 'condition', id: 'c2', field: 'cart.units', op: 'isOneOf', value: ['3'] },
								{ kind: 'condition', id: 'c3', field: 'cart.subtotal', op: null, value: null },
								{ kind: 'group', id: 'g2', join: 'any', items: [] },
							],
						},
						then: {
							kind: 'bands',
							id: 'b',
							field: 'cart.chargeableWeight',
							bands: [
								{
									id: 'b1',
									from: 0,
									to: 500,
									then: { kind: 'result', id: 'r1', result: { kind: 'free' } },
								},
								{
									id: 'b2',
									from: 600,
									to: 1000,
									then: { kind: 'result', id: 'r2', result: { kind: 'free' } },
								},
								{
									id: 'b3',
									from: 900,
									to: 2000,
									then: { kind: 'result', id: 'r1', result: { kind: 'free' } },
								},
							],
							otherwise: null,
						},
						otherwise: { kind: 'result', id: 'r4', result: { kind: 'percent', percent: 5, of: 'line' } },
					},
				},
			],
			adjust: [
				{ kind: 'roundUp', id: 'round', to: 0 },
				{ kind: 'minimum', id: 'min', amount: 500 },
				{ kind: 'maximum', id: 'max', amount: 100 },
			],
		};
		const codes = validateShippingRuleSet(body).issues.map((i) => i.code);
		expect(codes).toEqual(
			expect.arrayContaining([
				'line_fact_needs_loop',
				'condition_operator',
				'condition_incomplete',
				'group_empty',
				'bands_gap',
				'bands_overlap',
				'bands_uncovered',
				'percent_of_line_needs_loop',
				'round_up_zero',
				'minimum_above_maximum',
				'duplicate_block_id',
			]),
		);
		expect(validateShippingRuleSet({ steps: [], adjust: [] }).issues[0]?.code).toBe('no_steps');
	});
});

describe('which rule set prices each line', () => {
	const settings: ShippingSettings = {
		homeCountry: 'IN',
		domestic: { kind: 'ruleSet', ruleSetId: 'saha-textile-dom' },
		international: { kind: 'ruleSet', ruleSetId: 'saha-textile-intl' },
		mixedRuleSets: 'sum',
		defaultCharges: SAHA_TEXTILE_CHARGES,
		abroadPolicy: 'exportOffIndianInvoice',
		revision: 0,
		updatedBy: null,
	};
	const exception = (
		id: string,
		target: ShippingException['target'],
		domestic: ShippingException['domestic'],
		international: ShippingException['international'] = { kind: 'siteWide' },
	): ShippingException => ({
		id,
		target,
		domestic,
		international,
		note: '',
		updatedBy: null,
	});
	const ruleSets = new Map<string, ActiveRuleSet>([
		['saha-textile-dom', { ruleSetId: 'saha-textile-dom', version: 3, body: SAHA_TEXTILE_DOMESTIC }],
		['saha-textile-intl', { ruleSetId: 'saha-textile-intl', version: 2, body: SAHA_TEXTILE_INTERNATIONAL }],
		[
			'flat-250',
			{
				ruleSetId: 'flat-250',
				version: 1,
				body: {
					steps: [
						{
							id: 's',
							scope: 'wholeCart',
							combine: 'sum',
							node: { kind: 'result', id: 'r', result: { kind: 'amount', amount: 250, per: 'once' } },
						},
					],
					adjust: [],
				},
			},
		],
	]);

	it('follows: Free shipping switch → product → main category → parents (with sub-categories) → site-wide', () => {
		const exceptions = [
			exception('e-prod', { kind: 'product', productId: 'p-x' }, { kind: 'ruleSet', ruleSetId: 'flat-250' }),
			exception(
				'e-main',
				{ kind: 'category', categoryId: 'bridal', includeSubcategories: false },
				{ kind: 'free' },
			),
			exception(
				'e-parent',
				{ kind: 'category', categoryId: 'lehenga', includeSubcategories: true },
				{ kind: 'cantShip' },
			),
			exception(
				'e-parent-only',
				{ kind: 'category', categoryId: 'sarees', includeSubcategories: false },
				{ kind: 'free' },
			),
		];
		const route = (over: Partial<ShippingSnapshotLine>) =>
			routeShippingLine(line('a', over), 'domestic', settings, exceptions);
		expect(route({ freeShipping: true, productId: 'p-x' })).toMatchObject({
			kind: 'free',
			via: { kind: 'freeShippingSwitch' },
		});
		expect(route({ productId: 'p-x' })).toMatchObject({
			kind: 'ruleSet',
			ruleSetId: 'flat-250',
			via: { kind: 'productException' },
		});
		expect(route({ mainCategoryId: 'bridal', mainCategoryAncestorIds: ['lehenga'] })).toMatchObject({
			kind: 'free',
			via: { exceptionId: 'e-main' },
		});
		expect(route({ mainCategoryId: 'bridal-red', mainCategoryAncestorIds: ['lehenga'] })).toMatchObject({
			kind: 'cantShip',
			via: { inherited: true },
		});
		expect(route({ mainCategoryId: 'tant', mainCategoryAncestorIds: ['sarees'] })).toMatchObject({
			kind: 'ruleSet',
			ruleSetId: 'saha-textile-dom',
			via: { kind: 'siteWide' },
		});
		// An exception set to "site-wide" for this zone falls through.
		const intlOnly = [
			exception('e', { kind: 'product', productId: 'p-a' }, { kind: 'siteWide' }, { kind: 'cantShip' }),
		];
		expect(routeShippingLine(line('a'), 'domestic', settings, intlOnly)).toMatchObject({
			kind: 'ruleSet',
			ruleSetId: 'saha-textile-dom',
		});
		expect(routeShippingLine(line('a'), 'international', settings, intlOnly)).toMatchObject({ kind: 'cantShip' });
	});

	it('the delivery country decides the zone, never the currency', () => {
		const lines = [line('a', { units: 2, sellingPriceINR: 10200, mrpINR: 12000 }), line('b')];
		const kolkata = priceShipping({ snapshot: cart(lines, 'IN'), settings, exceptions: [], ruleSets });
		expect(kolkata).toMatchObject({ status: 'priced', zone: 'domestic', amountINR: 200 });
		const dubai = priceShipping({ snapshot: cart(lines, 'AE'), settings, exceptions: [], ruleSets });
		expect(dubai).toMatchObject({ status: 'priced', zone: 'international', amountINR: 3800 });
		if (dubai.status === 'priced')
			expect(dubai.groups[0]).toMatchObject({ ruleSetId: 'saha-textile-intl', version: 2 });
	});

	it('mixed rule sets add up by default, or charge only the highest', () => {
		const exceptions = [
			exception('e', { kind: 'product', productId: 'p-b' }, { kind: 'ruleSet', ruleSetId: 'flat-250' }),
		];
		const snapshot = cart([line('a', { units: 2, sellingPriceINR: 900, mrpINR: 1000 }), line('b')]);
		expect(priceShipping({ snapshot, settings, exceptions, ruleSets })).toMatchObject({
			status: 'priced',
			amountINR: 450,
		});
		expect(
			priceShipping({ snapshot, settings: { ...settings, mixedRuleSets: 'highest' }, exceptions, ruleSets }),
		).toMatchObject({ status: 'priced', amountINR: 250 });
	});

	it("stops checkout when a zone has no rule set, a rule set is missing, or a line can't ship", () => {
		const snapshot = cart([line('a')]);
		expect(
			priceShipping({
				snapshot,
				settings: { ...settings, domestic: { kind: 'ruleSet', ruleSetId: null } },
				exceptions: [],
				ruleSets,
			}),
		).toMatchObject({
			status: 'unpriced',
			problems: [{ kind: 'noMethod', lineIds: ['a'] }],
		});
		expect(priceShipping({ snapshot, settings, exceptions: [], ruleSets: new Map() })).toMatchObject({
			status: 'unpriced',
			problems: [{ kind: 'missingRuleSet', ruleSetId: 'saha-textile-dom' }],
		});
		const exceptions = [
			exception('e', { kind: 'product', productId: 'p-a' }, { kind: 'siteWide' }, { kind: 'cantShip' }),
		];
		expect(
			priceShipping({ snapshot: cart([line('a'), line('b')], 'GB'), settings, exceptions, ruleSets }),
		).toMatchObject({
			status: 'cantShip',
			lines: [{ lineId: 'a', via: { kind: 'productException' } }],
		});
		expect(
			priceShipping({
				snapshot: cart([line('a')], 'US'),
				settings: { ...settings, abroadPolicy: 'indiaOnly' },
				exceptions: [],
				ruleSets,
			}),
		).toMatchObject({
			status: 'cantShip',
			lines: [{ lineId: 'a', via: { kind: 'indiaOnly' } }],
		});
	});

	it('a courier zone uses the quote plus its extra, or the fallback rule set when there is no quote', () => {
		const courier: ShippingSettings = {
			...settings,
			international: {
				kind: 'courier',
				courierId: 'shiprocket',
				fallbackRuleSetId: 'saha-textile-intl',
				extra: { kind: 'percent', value: 10 },
			},
		};
		const snapshot = cart([line('a', { units: 2 })], 'GB');
		expect(
			priceShipping({ snapshot, settings: courier, exceptions: [], ruleSets, courierQuoteINR: 1800 }),
		).toMatchObject({ status: 'priced', amountINR: 1980 });
		const fallback = priceShipping({
			snapshot,
			settings: courier,
			exceptions: [],
			ruleSets,
			courierQuoteINR: null,
		});
		expect(fallback).toMatchObject({
			status: 'priced',
			amountINR: 2900,
			groups: [{ kind: 'ruleSet', usedFallback: true }],
		});
	});
});

describe('charges and boxes inherit', () => {
	it('product → main category → parents → shop default, charge by charge', () => {
		const resolved = resolveShippingCharges(
			{ domesticINR: null, internationalFirstINR: 2500, internationalFurtherINR: null },
			[
				{
					id: 'tant',
					shipping: {
						domesticINR: null,
						internationalFirstINR: null,
						internationalFurtherINR: 800,
						weightGrams: null,
						lengthCm: null,
						widthCm: null,
						heightCm: null,
					},
				},
				{
					id: 'sarees',
					shipping: {
						domesticINR: 100,
						internationalFirstINR: 2000,
						internationalFurtherINR: 900,
						weightGrams: null,
						lengthCm: null,
						widthCm: null,
						heightCm: null,
					},
				},
			],
			{ domestic: 50, internationalFirst: 1500, internationalFurther: 700 },
		);
		expect(resolved.charges).toEqual({ domestic: 100, internationalFirst: 2500, internationalFurther: 800 });
		expect(resolved.sources).toEqual({
			domestic: { from: 'parentCategory', categoryId: 'sarees' },
			internationalFirst: { from: 'product', categoryId: null },
			internationalFurther: { from: 'mainCategory', categoryId: 'tant' },
		});
		expect(
			resolveShippingCharges(null, [], { domestic: 50, internationalFirst: 1500, internationalFurther: 700 })
				.sources.domestic.from,
		).toBe('shopDefault');
		expect(
			resolveShippingBox([
				{ weightGrams: null, lengthCm: 30 },
				{ weightGrams: 650, lengthCm: 40, widthCm: 25 },
				{ heightCm: 4 },
			]),
		).toEqual({
			weightGrams: 650,
			lengthCm: 30,
			widthCm: 25,
			heightCm: 4,
		});
	});
});

describe('the invoice address (export off, invoice to an address in India)', () => {
	const IN = {
		fullName: 'Rina Basu',
		line1: '14 Lake Gardens',
		city: 'Kolkata',
		state: 'West Bengal',
		postalCode: '700045',
		country: 'IN',
	};
	const UK = {
		fullName: 'Arjun Mehta',
		line1: '22 Belsize Park',
		city: 'London',
		state: null,
		postalCode: 'NW3 4DU',
		country: 'GB',
	};
	const base = {
		policy: 'exportOffIndianInvoice' as const,
		homeCountry: 'IN',
		givenAtCheckout: null,
		addedByStaff: null,
	};

	it('covers the four address cases', () => {
		expect(decideInvoiceAddress({ ...base, billing: IN, delivery: IN })).toMatchObject({
			status: 'ready',
			source: 'billing',
		});
		expect(decideInvoiceAddress({ ...base, billing: IN, delivery: UK })).toMatchObject({
			status: 'ready',
			source: 'billing',
		});
		expect(decideInvoiceAddress({ ...base, billing: UK, delivery: IN })).toMatchObject({
			status: 'ready',
			source: 'delivery',
			address: IN,
		});
		const given = {
			fullName: 'Arjun Mehta',
			line1: '7B Ballygunge Place',
			city: 'Kolkata',
			state: 'West Bengal',
			postalCode: '700 019',
		};
		expect(decideInvoiceAddress({ ...base, billing: UK, delivery: UK, givenAtCheckout: given })).toMatchObject({
			status: 'ready',
			source: 'givenAtCheckout',
			address: { postalCode: '700019', country: 'IN' },
		});
	});

	it('flags "Invoice address needed" for a missing or half-filled address, and lets staff complete it', () => {
		expect(decideInvoiceAddress({ ...base, billing: UK, delivery: UK })).toEqual({
			status: 'needed',
			partial: null,
			missing: ['fullName', 'line1', 'city', 'state', 'postalCode'],
		});
		const partial = { fullName: 'Arjun', city: 'Kolkata', postalCode: '7000' };
		expect(decideInvoiceAddress({ ...base, billing: UK, delivery: UK, givenAtCheckout: partial })).toMatchObject({
			status: 'needed',
			missing: ['line1', 'state', 'postalCode'],
		});
		const staff = {
			fullName: 'Arjun Mehta',
			line1: '7B Ballygunge Place',
			city: 'Kolkata',
			state: 'West Bengal',
			postalCode: '700019',
		};
		expect(
			decideInvoiceAddress({ ...base, billing: UK, delivery: UK, givenAtCheckout: partial, addedByStaff: staff }),
		).toMatchObject({ status: 'ready', source: 'addedByStaff' });
	});

	it('asks for an address in India only when both addresses are abroad and only on that path', () => {
		expect(asksForAddressInHomeCountry('exportOffIndianInvoice', 'IN', 'GB', 'GB')).toBe(true);
		expect(asksForAddressInHomeCountry('exportOffIndianInvoice', 'IN', 'GB', 'IN')).toBe(false);
		expect(asksForAddressInHomeCountry('indiaOnly', 'IN', 'GB', 'GB')).toBe(false);
	});

	it('other paths: India only refuses delivery abroad; standard export is not built', () => {
		expect(decideInvoiceAddress({ ...base, policy: 'indiaOnly', billing: UK, delivery: UK })).toEqual({
			status: 'notAllowed',
			reason: 'deliveryAbroadRefused',
		});
		expect(decideInvoiceAddress({ ...base, policy: 'indiaOnly', billing: UK, delivery: IN })).toMatchObject({
			status: 'ready',
			source: 'billing',
		});
		expect(decideInvoiceAddress({ ...base, policy: 'standardExport', billing: IN, delivery: UK })).toEqual({
			status: 'notAllowed',
			reason: 'standardExportNotBuilt',
		});
	});
});

describe('gateways and foreign amounts', () => {
	it('rupees go to the active INR gateway, every other currency to PayPal', () => {
		const routing = { activeInrGateway: 'ccavenue', foreignGateway: 'paypal', homeCurrency: 'INR' };
		expect(routePaymentGateway('INR', routing)).toEqual({ gateway: 'ccavenue' });
		expect(routePaymentGateway('gbp', routing)).toEqual({ gateway: 'paypal' });
		expect(routePaymentGateway('INR', { ...routing, activeInrGateway: null })).toEqual({ problem: 'noInrGateway' });
	});

	it('converts at the active rate plus the flat 6% markup (brief: ₹3,800 → £34.44 at ₹116.95)', () => {
		expect(foreignAmountFromINR(3800, 1 / 116.95, 6)).toBe(34.44);
		expect(foreignAmountFromINR(10200, 1 / 116.95, 6)).toBe(92.45);
		expect(() => foreignAmountFromINR(100, 0, 6)).toThrow(RangeError);
	});
});

describe('pre-made rule sets', () => {
	it('are all valid to make active, and price a cart in both zones from the product charges', () => {
		const expected: Record<string, [number, number]> = {
			'add-per-unit': [300, 6000],
			'highest-only': [100, 2000],
			'first-and-further': [300, 3800],
			'free-above': [100, 2000],
			'weight-bands': [120, 2500],
			'flat-per-order': [100, 2000],
		};
		expect(PREMADE_RULE_SETS.map((r) => r.key)).toEqual([...Object.keys(expected), 'courier-quote']);
		for (const premade of PREMADE_RULE_SETS) {
			const check = validateShippingRuleSet(premade.body, premade.use);
			expect(check.canActivate, premade.key).toBe(true);
			const amounts = expected[premade.key];
			if (!amounts) continue;
			const lines = [
				line('a', { units: 2, chargeableWeightGrams: 400, sellingPriceINR: 1000, mrpINR: 1000 }),
				line('b', { chargeableWeightGrams: 400, sellingPriceINR: 1000, mrpINR: 1000 }),
			];
			expect(
				priced(evaluateShippingRuleSet({ body: premade.body, snapshot: cart(lines), zone: 'domestic' })),
				premade.key,
			).toBe(amounts[0]);
			expect(
				priced(
					evaluateShippingRuleSet({ body: premade.body, snapshot: cart(lines, 'GB'), zone: 'international' }),
				),
				premade.key,
			).toBe(amounts[1]);
		}
	});
});

describe("can't-ship messages", () => {
	it('must be written in every shop language before the rule set goes live', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'eachLine',
					combine: 'sum',
					node: {
						kind: 'result',
						id: 'no',
						result: { kind: 'cantShip', message: { en: 'Not sent abroad', bn: ' ' } },
					},
				},
			],
			adjust: [],
		};
		expect(validateShippingRuleSet(body, 'international').canActivate).toBe(true);
		const both = validateShippingRuleSet(body, 'international', { languages: ['en', 'bn'] });
		expect(both.canActivate).toBe(false);
		expect(both.issues).toEqual([
			{
				code: 'cant_ship_message_missing',
				severity: 'error',
				blockId: 'no',
				stepId: 's',
				params: { language: 'bn' },
			},
		]);
	});
});

describe('discounted compares the price before add-ons with MRP', () => {
	it('a discounted saree with paid stitching stays discounted; a full-price one with stitching stays full price', () => {
		const stitchedSale = line('a', { sellingPriceINR: 12300, basePriceINR: 11800, mrpINR: 12000 });
		const stitchedFull = line('b', { sellingPriceINR: 2950, basePriceINR: 2450, mrpINR: 2450 });
		const outcome = evaluateShippingRuleSet({
			body: SAHA_TEXTILE_DOMESTIC,
			snapshot: cart([stitchedSale, stitchedFull]),
			zone: 'domestic',
		});
		expect(priced(outcome)).toBe(100);
	});
});
