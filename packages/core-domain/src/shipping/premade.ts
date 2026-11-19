import type { ShippingNode, ShippingResult, ShippingRuleSetBody, ShippingRuleSetUse } from '@saha-textile/contracts';

/**
 * The pre-made rule sets every shop starts with (brief rb01 / rl01). They are locked: a business
 * copies one and changes the copy, so every business starts from the same tested version. Where
 * a rule set works for both zones it reads the product's own charges (product → category → shop
 * default) and branches on the delivery zone, so it prices correctly without typed amounts.
 * Amounts that must be typed (bands, a flat charge, a free-above threshold) are starting values
 * to change in the copy.
 */
export interface PremadeRuleSet {
	key: string;
	name: string;
	description: string;
	use: ShippingRuleSetUse;
	body: ShippingRuleSetBody;
}

const result = (id: string, value: ShippingResult): ShippingNode => ({ kind: 'result', id, result: value });

/** If the delivery is domestic, the first branch; otherwise the second. */
const byZone = (id: string, domestic: ShippingNode, international: ShippingNode): ShippingNode => ({
	kind: 'if',
	id,
	when: {
		kind: 'group',
		id: `${id}-when`,
		join: 'all',
		items: [{ kind: 'condition', id: `${id}-zone`, field: 'delivery.zone', op: 'is', value: 'domestic' }],
	},
	then: domestic,
	otherwise: international,
});

const body = (
	steps: ShippingRuleSetBody['steps'],
	adjust: ShippingRuleSetBody['adjust'] = [],
): ShippingRuleSetBody => ({ steps, adjust });

export const PREMADE_RULE_SETS: readonly PremadeRuleSet[] = [
	{
		key: 'add-per-unit',
		name: 'Add up per unit',
		description: 'Each unit costs its product’s shipping charge; lines are added up.',
		use: 'both',
		body: body([
			{
				id: 'step-1',
				scope: 'eachLine',
				combine: 'sum',
				node: byZone(
					'zone',
					result('domestic', { kind: 'productCharge', charge: 'domestic', per: 'unit' }),
					result('international', { kind: 'productCharge', charge: 'internationalFirst', per: 'unit' }),
				),
			},
		]),
	},
	{
		key: 'highest-only',
		name: 'Highest charge only',
		description: 'Only the dearest line’s charge is taken, once.',
		use: 'both',
		body: body([
			{
				id: 'step-1',
				scope: 'eachLine',
				combine: 'highest',
				node: byZone(
					'zone',
					result('domestic', { kind: 'productCharge', charge: 'domestic', per: 'once' }),
					result('international', { kind: 'productCharge', charge: 'internationalFirst', per: 'once' }),
				),
			},
		]),
	},
	{
		key: 'first-and-further',
		name: 'First and further units',
		description: 'A first-unit charge, then a lower charge for each further unit.',
		use: 'both',
		body: body([
			{
				id: 'step-1',
				scope: 'wholeCart',
				combine: 'sum',
				node: byZone(
					'zone',
					result('domestic', { kind: 'productCharge', charge: 'domestic', per: 'unit' }),
					result('international', {
						kind: 'firstAndFurther',
						first: { from: 'product', charge: 'internationalFirst' },
						further: { from: 'product', charge: 'internationalFurther' },
						count: 'acrossCart',
					}),
				),
			},
		]),
	},
	{
		key: 'free-above',
		name: 'Free above an amount',
		description: 'A flat charge, free when the cart reaches a value.',
		use: 'both',
		body: body(
			[
				{
					id: 'step-1',
					scope: 'wholeCart',
					combine: 'sum',
					node: byZone(
						'zone',
						result('domestic', { kind: 'productCharge', charge: 'domestic', per: 'once' }),
						result('international', { kind: 'productCharge', charge: 'internationalFirst', per: 'once' }),
					),
				},
			],
			[{ kind: 'freeAbove', id: 'free-above', subtotal: 4999 }],
		),
	},
	{
		key: 'weight-bands',
		name: 'Weight bands',
		description: 'Charge by chargeable weight (actual or volumetric, whichever is more).',
		use: 'both',
		body: body([
			{
				id: 'step-1',
				scope: 'wholeCart',
				combine: 'sum',
				node: byZone(
					'zone',
					{
						kind: 'bands',
						id: 'domestic-bands',
						field: 'cart.chargeableWeight',
						bands: [
							{
								id: 'd-500',
								from: 0,
								to: 500,
								then: result('d-500-r', { kind: 'amount', amount: 60, per: 'once' }),
							},
							{
								id: 'd-2000',
								from: 500,
								to: 2000,
								then: result('d-2000-r', { kind: 'amount', amount: 120, per: 'once' }),
							},
							{
								id: 'd-more',
								from: 2000,
								to: null,
								then: result('d-more-r', { kind: 'amount', amount: 40, per: 'kg' }),
							},
						],
						otherwise: null,
					},
					{
						kind: 'bands',
						id: 'international-bands',
						field: 'cart.chargeableWeight',
						bands: [
							{
								id: 'i-500',
								from: 0,
								to: 500,
								then: result('i-500-r', { kind: 'amount', amount: 1500, per: 'once' }),
							},
							{
								id: 'i-2000',
								from: 500,
								to: 2000,
								then: result('i-2000-r', { kind: 'amount', amount: 2500, per: 'once' }),
							},
							{
								id: 'i-more',
								from: 2000,
								to: null,
								then: result('i-more-r', { kind: 'amount', amount: 1000, per: 'kg' }),
							},
						],
						otherwise: null,
					},
				),
			},
		]),
	},
	{
		key: 'flat-per-order',
		name: 'Flat per order',
		description: 'One charge per order, whatever is in it.',
		use: 'both',
		body: body([
			{
				id: 'step-1',
				scope: 'wholeCart',
				combine: 'sum',
				node: byZone(
					'zone',
					result('domestic', { kind: 'amount', amount: 100, per: 'once' }),
					result('international', { kind: 'amount', amount: 2000, per: 'once' }),
				),
			},
		]),
	},
	{
		key: 'courier-quote',
		name: 'Courier quote',
		description: 'Ask the connected courier for a live price, with a fallback rule set.',
		use: 'both',
		body: body([
			{ id: 'step-1', scope: 'wholeCart', combine: 'sum', node: result('quote', { kind: 'courierQuote' }) },
		]),
	},
];

/** The stored id of a pre-made rule set. */
export const premadeRuleSetId = (key: string): string => `premade-${key}`;
