import type {
	ShippingCartSnapshot,
	ShippingException,
	ShippingRuleSetBody,
	ShippingSettings,
	ShippingSnapshotLine,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { priceShipping, type ActiveRuleSet } from '../src/shipping/price-cart';

const CHARGES = { domestic: 100, internationalFirst: 2000, internationalFurther: 900 };
const line = (id: string, over: Partial<ShippingSnapshotLine> = {}): ShippingSnapshotLine => ({
	lineId: id,
	productId: `p-${id}`,
	categoryIds: [],
	mainCategoryId: null,
	mainCategoryAncestorIds: [],
	freeShipping: false,
	units: 1,
	sellingPriceINR: 1000,
	mrpINR: 1000,
	onSaleEvent: false,
	soldBy: 'piece',
	madeToOrder: false,
	chargeableWeightGrams: 500,
	charges: CHARGES,
	...over,
});
const cart = (lines: ShippingSnapshotLine[], country = 'IN'): ShippingCartSnapshot => ({
	lines,
	delivery: { country, state: null, pincode: '700045' },
	shopper: { signedIn: true, groups: [], firstOrder: false },
});
const result = (r: unknown): ShippingRuleSetBody =>
	({
		steps: [{ id: 's', scope: 'wholeCart', combine: 'sum', node: { kind: 'result', id: 'r', result: r } }],
		adjust: [],
	}) as ShippingRuleSetBody;
const ruleSets = new Map<string, ActiveRuleSet>([
	['flat', { ruleSetId: 'flat', version: 1, body: result({ kind: 'amount', amount: 250, per: 'once' }) }],
	['refuse', { ruleSetId: 'refuse', version: 1, body: result({ kind: 'cantShip', message: { en: 'No' } }) }],
	['quote', { ruleSetId: 'quote', version: 1, body: result({ kind: 'courierQuote' }) }],
	[
		'blank',
		{
			ruleSetId: 'blank',
			version: 1,
			body: { steps: [{ id: 's', scope: 'wholeCart', combine: 'sum', node: null }], adjust: [] } as never,
		},
	],
]);
const settings = (over: Partial<ShippingSettings> = {}): ShippingSettings =>
	({
		homeCountry: 'IN',
		domestic: { kind: 'ruleSet', ruleSetId: 'flat' },
		international: { kind: 'ruleSet', ruleSetId: 'flat' },
		mixedRuleSets: 'sum',
		defaultCharges: CHARGES,
		abroadPolicy: 'exportOffIndianInvoice',
		abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: true },
		revision: 0,
		updatedBy: null,
		...over,
	}) as ShippingSettings;
const courier = (fallbackRuleSetId: string | null) =>
	({ kind: 'courier', courierId: 'shiprocket', fallbackRuleSetId, extra: { percent: 10, amountINR: 20 } }) as never;
const exception = (
	target: ShippingException['target'],
	domestic: ShippingException['domestic'],
): ShippingException => ({
	id: 'x1',
	target,
	domestic,
	international: { kind: 'siteWide' },
	note: '',
	updatedBy: null,
});

describe('priceShipping: the remaining cases', () => {
	it('prices an empty cart at nothing', () => {
		expect(priceShipping({ snapshot: cart([]), settings: settings(), exceptions: [], ruleSets })).toMatchObject({
			status: 'priced',
			amountINR: 0,
			groups: [],
		});
	});

	it('passes a product exception that keeps the site-wide rule, for a line without a main category', () => {
		const out = priceShipping({
			snapshot: cart([line('a')]),
			settings: settings(),
			exceptions: [exception({ kind: 'product', productId: 'p-a' }, { kind: 'siteWide' })],
			ruleSets,
		});
		expect(out).toMatchObject({ status: 'priced', amountINR: 250 });
	});

	it('ships a free line in its own group beside the priced ones', () => {
		const out = priceShipping({
			snapshot: cart([line('a', { freeShipping: true }), line('b')]),
			settings: settings(),
			exceptions: [],
			ruleSets,
		});
		expect(out).toMatchObject({ status: 'priced', amountINR: 250 });
		expect(out.status === 'priced' && out.groups.map((g) => g.kind)).toEqual(['free', 'ruleSet']);
	});

	it('adds the courier extras to a quote abroad, and has no method without a quote or a fallback', () => {
		const abroad = priceShipping({
			snapshot: cart([line('a')], 'GB'),
			settings: settings({ international: courier(null) }),
			exceptions: [],
			ruleSets,
			courierQuoteINR: 1000,
		});
		expect(abroad).toMatchObject({ status: 'priced', zone: 'international', amountINR: 1120 });
		const none = priceShipping({
			snapshot: cart([line('a')]),
			settings: settings({ domestic: courier(null) }),
			exceptions: [],
			ruleSets,
		});
		expect(none).toMatchObject({ status: 'unpriced', problems: [{ kind: 'noMethod', lineIds: ['a'] }] });
	});

	it('reports lines a rule set will not ship, with how they were routed', () => {
		const out = priceShipping({
			snapshot: cart([line('a')]),
			settings: settings({ domestic: { kind: 'ruleSet', ruleSetId: 'refuse' } }),
			exceptions: [],
			ruleSets,
		});
		expect(out).toMatchObject({ status: 'cantShip', lines: [{ lineId: 'a', via: { kind: 'siteWide' } }] });
	});

	it('says when a rule set gives no result', () => {
		const out = priceShipping({
			snapshot: cart([line('a')]),
			settings: settings({ domestic: { kind: 'ruleSet', ruleSetId: 'blank' } }),
			exceptions: [],
			ruleSets,
		});
		expect(out).toMatchObject({ status: 'unpriced', problems: [{ kind: 'noResult', ruleSetId: 'blank' }] });
	});

	it('asks for a courier quote when the rule set needs one', () => {
		const out = priceShipping({
			snapshot: cart([line('a')]),
			settings: settings({ domestic: { kind: 'ruleSet', ruleSetId: 'quote' } }),
			exceptions: [],
			ruleSets,
		});
		expect(out).toMatchObject({ status: 'unpriced', problems: [{ kind: 'needsQuote', ruleSetId: 'quote' }] });
	});

	it('passes a category exception that keeps the site-wide rule, and adds courier extras at home too', () => {
		const out = priceShipping({
			snapshot: cart([line('a', { mainCategoryId: 'sarees' })]),
			settings: settings({ domestic: courier(null) }),
			exceptions: [
				exception(
					{ kind: 'category', categoryId: 'sarees', includeSubcategories: false },
					{ kind: 'siteWide' },
				),
			],
			ruleSets,
			courierQuoteINR: 500,
		});
		expect(out).toMatchObject({ status: 'priced', zone: 'domestic', amountINR: 570 });
	});
});
