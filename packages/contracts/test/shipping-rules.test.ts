import { describe, expect, it } from 'vitest';

import { ShippingException, ShippingRuleSetBody, ShippingSettings, ShippingTestCart } from '../src/shipping-rules';

describe('shipping rule set bodies', () => {
	it('parse nested and / or groups, bands and drafts with blank amounts', () => {
		const body = ShippingRuleSetBody.parse({
			steps: [
				{
					id: 'step-1',
					scope: 'wholeCart',
					node: {
						kind: 'if',
						id: 'if-1',
						when: {
							kind: 'group',
							id: 'g-1',
							join: 'all',
							items: [
								{ kind: 'condition', id: 'c-1', field: 'cart.subtotal', op: 'atLeast', value: 4999 },
								{
									kind: 'group',
									id: 'g-2',
									join: 'any',
									items: [
										{
											kind: 'condition',
											id: 'c-2',
											field: 'delivery.state',
											op: 'isOneOf',
											value: ['Odisha'],
										},
									],
								},
							],
						},
						then: {
							kind: 'bands',
							id: 'b-1',
							field: 'cart.chargeableWeight',
							bands: [
								{
									id: 'band-1',
									from: 0,
									to: 500,
									then: {
										kind: 'result',
										id: 'r-1',
										result: { kind: 'amount', amount: null, per: 'once' },
									},
								},
							],
							otherwise: null,
						},
						otherwise: { kind: 'result', id: 'r-2', result: { kind: 'cantShip' } },
					},
				},
			],
		});
		expect(body.steps[0]?.combine).toBe('sum');
		expect(body.adjust).toEqual([]);
		const otherwise = body.steps[0]?.node?.kind === 'if' ? body.steps[0].node.otherwise : null;
		expect(otherwise).toEqual({ kind: 'result', id: 'r-2', result: { kind: 'cantShip', message: {} } });
	});

	it('refuse unknown fields, bad block ids, more than two decimals and negative amounts', () => {
		const step = (result: unknown, id = 'r-1') => ({
			steps: [{ id: 's', scope: 'eachLine', node: { kind: 'result', id, result } }],
		});
		expect(ShippingRuleSetBody.safeParse(step({ kind: 'amount', amount: 10.005, per: 'once' })).success).toBe(
			false,
		);
		expect(ShippingRuleSetBody.safeParse(step({ kind: 'amount', amount: -1, per: 'once' })).success).toBe(false);
		expect(
			ShippingRuleSetBody.safeParse(step({ kind: 'amount', amount: 99.5, per: 'once' }, 'Bad Id')).success,
		).toBe(false);
		expect(
			ShippingRuleSetBody.safeParse({
				steps: [
					{
						id: 's',
						scope: 'eachLine',
						node: {
							kind: 'if',
							id: 'i',
							when: {
								kind: 'group',
								id: 'g',
								join: 'all',
								items: [{ kind: 'condition', id: 'c', field: 'line.colour', op: 'is', value: 'red' }],
							},
							then: null,
							otherwise: null,
						},
					},
				],
			}).success,
		).toBe(false);
	});
});

describe('settings, exceptions and test carts', () => {
	it('default to the home country India, adding mixed rule sets up and the export-off path', () => {
		const settings = ShippingSettings.parse({
			domestic: { kind: 'ruleSet', ruleSetId: 'rs-dom' },
			international: { kind: 'courier', courierId: 'shiprocket', fallbackRuleSetId: 'rs-intl' },
			defaultCharges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
		});
		expect(settings).toMatchObject({
			homeCountry: 'IN',
			mixedRuleSets: 'sum',
			abroadPolicy: 'exportOffIndianInvoice',
			international: { extra: null },
		});
	});

	it('an exception targets a category (with sub-categories by default) or a product', () => {
		const parsed = ShippingException.parse({
			id: 'e-1',
			target: { kind: 'category', categoryId: 'bridal' },
			domestic: { kind: 'siteWide' },
			international: { kind: 'cantShip' },
		});
		expect(parsed.target).toEqual({ kind: 'category', categoryId: 'bridal', includeSubcategories: true });
	});

	it('a test cart holds real products and the amount accepted for it', () => {
		const parsed = ShippingTestCart.parse({
			id: 'cart-1',
			name: 'Two discounted, one full price',
			lines: [{ productId: 'p-1', quantity: 2 }],
			delivery: { country: 'IN', state: 'West Bengal', pincode: '700045' },
			expectedINR: 200,
		});
		expect(parsed.shopper).toEqual({ signedIn: true, groups: [], firstOrder: false });
		expect(parsed.lines[0]?.variationId).toBeNull();
	});
});
