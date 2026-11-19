import { describe, expect, it } from 'vitest';

import { lineFigures, lineSubline, tryExplanation, type Translate } from './try-words';

import type { ShippingRuleSetBody, ShippingTraceEntry, ShippingTryLineView } from '@saha-textile/contracts';

/** English as the brief writes it, so the expectations read like the approved pictures. */
const EN: Record<string, string> = {
	ship_state_full_price: 'full price',
	ship_state_discounted: 'discounted',
	ship_state_percent_off: '{{percent}}% off',
	ship_line_box: 'box {{l}}×{{w}}×{{h}} cm',
	ship_line_chargeable: 'chargeable {{grams}} g',
	ship_line_unit: 'unit {{n}}',
	ship_line_units: 'units {{from}}–{{to}}',
	ship_line_mrp: 'MRP {{amount}}',
	ship_line_price: 'price {{amount}}',
	ship_line_charge: 'charge {{amount}}',
	ship_line_charge_from: 'charge {{amount}} ({{from}})',
	ship_explain_unit_one: 'Unit 1 {{first}}.',
	ship_explain_unit_two: 'Unit 1 {{first}}, unit 2 {{further}}.',
	ship_explain_units_three: 'Unit 1 {{first}}, units 2 and 3 {{further}} each.',
	ship_explain_units_many: 'Unit 1 {{first}}, units 2–{{last}} {{further}} each.',
	ship_explain_highest_one: 'Highest line {{kept}} is taken once; {{dropped}} is dropped.',
	ship_explain_line: 'Line {{n}}: {{state}}, {{result}}.',
	ship_explain_adjust_roundUp: 'Rounded up from {{from}} to {{to}}.',
	ship_why_free: 'free',
	ship_why_unit_one: '1 unit × {{each}}',
	ship_why_units_each: '{{units}} units × {{each}}',
};
const t: Translate = (key, params = {}) =>
	(EN[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''));

const view = (lineId: string, over: Partial<ShippingTryLineView> = {}): ShippingTryLineView => ({
	lineId,
	productId: `p-${lineId}`,
	title: lineId,
	units: 1,
	sellingPriceINR: 2450,
	mrpINR: 2450,
	discounted: false,
	charges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
	chargeableWeightGrams: null,
	variantLabel: null,
	imageUrl: null,
	chargeSources: {
		domestic: { from: 'category', name: 'Sarees' },
		internationalFirst: { from: 'category', name: 'Sarees' },
		internationalFurther: { from: 'category', name: 'Sarees' },
	},
	box: null,
	...over,
});

const DOMESTIC: ShippingRuleSetBody = {
	steps: [
		{
			id: 's1',
			scope: 'eachLine',
			combine: 'sum',
			node: {
				kind: 'if',
				id: 'if1',
				when: {
					kind: 'group',
					id: 'g1',
					join: 'all',
					items: [{ kind: 'condition', id: 'c1', field: 'line.discounted', op: 'is', value: true }],
				},
				then: { kind: 'result', id: 'r1', result: { kind: 'productCharge', charge: 'domestic', per: 'unit' } },
				otherwise: { kind: 'result', id: 'r2', result: { kind: 'free' } },
			},
		},
	],
	adjust: [],
};

const INTERNATIONAL: ShippingRuleSetBody = {
	steps: [
		{
			id: 's1',
			scope: 'wholeCart',
			combine: 'sum',
			node: {
				kind: 'result',
				id: 'r1',
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

const entry = (over: Partial<ShippingTraceEntry>): ShippingTraceEntry => ({
	stepId: 's1',
	lineIds: [],
	path: [],
	result: 'free',
	amountINR: 0,
	...over,
});

describe('Try it words (brief rb02, rb03)', () => {
	it('domestic: each line’s amount, its MRP and price line, and the sentence', () => {
		const lines = [
			view('line-1', { units: 2, sellingPriceINR: 10200, mrpINR: 12000, discounted: true }),
			view('line-2'),
		];
		const trace = [
			entry({
				lineIds: ['line-1'],
				path: ['if1', 'r1'],
				result: 'productCharge',
				amountINR: 200,
				units: 2,
				unitAmountINR: 100,
			}),
			entry({ lineIds: ['line-2'], path: ['if1', 'r2'], result: 'free', amountINR: 0 }),
		];
		const figures = lineFigures(DOMESTIC, lines, trace);
		expect(figures.get('line-1')).toEqual({ amountINR: 200, units: null });
		expect(figures.get('line-2')).toEqual({ amountINR: 0, units: null });
		const sub = (i: number) =>
			lineSubline(t, {
				body: DOMESTIC,
				line: lines[i] as ShippingTryLineView,
				figures: figures.get(`line-${i + 1}`),
				trace,
				zone: 'domestic',
			});
		expect(sub(0)).toBe('MRP ₹12,000 · price ₹10,200 · discounted · charge ₹100 (Sarees)');
		expect(sub(1)).toBe('MRP ₹2,450 · price ₹2,450 · full price');
		expect(tryExplanation(t, { body: DOMESTIC, lines, trace })).toBe(
			'Line 1: discounted, 2 units × ₹100. Line 2: full price, free.',
		);
	});

	it('international: one first unit across the cart, unit numbers per line, and the sentence', () => {
		const lines = [view('line-1', { units: 2, discounted: true, mrpINR: 3000 }), view('line-2')];
		const trace = [
			entry({
				lineIds: ['line-1', 'line-2'],
				path: ['r1'],
				result: 'firstAndFurther',
				amountINR: 3800,
				firstINR: 2000,
				furtherINR: 900,
				furtherUnits: 2,
				units: 3,
			}),
		];
		const figures = lineFigures(INTERNATIONAL, lines, trace);
		expect(figures.get('line-1')).toEqual({ amountINR: 2900, units: { from: 1, to: 2 } });
		expect(figures.get('line-2')).toEqual({ amountINR: 900, units: { from: 3, to: 3 } });
		expect(
			lineSubline(t, {
				body: INTERNATIONAL,
				line: lines[0] as ShippingTryLineView,
				figures: figures.get('line-1'),
				trace,
				zone: 'international',
			}),
		).toBe('Discounted · units 1–2');
		expect(
			lineSubline(t, {
				body: INTERNATIONAL,
				line: lines[1] as ShippingTryLineView,
				figures: figures.get('line-2'),
				trace,
				zone: 'international',
			}),
		).toBe('Full price · unit 3');
		expect(tryExplanation(t, { body: INTERNATIONAL, lines, trace })).toBe(
			'Unit 1 ₹2,000, units 2 and 3 ₹900 each.',
		);
	});

	it('the first unit goes to the line with the highest first-unit charge', () => {
		const lines = [
			view('line-1', { charges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 } }),
			view('line-2', { charges: { domestic: 100, internationalFirst: 3500, internationalFurther: 900 } }),
		];
		const trace = [entry({ lineIds: ['line-1', 'line-2'], path: ['r1'], result: 'firstAndFurther', units: 2 })];
		const figures = lineFigures(INTERNATIONAL, lines, trace);
		expect(figures.get('line-1')?.amountINR).toBe(900);
		expect(figures.get('line-2')?.amountINR).toBe(3500);
	});

	it('highest line only, weights for weight bands, and adjustments', () => {
		const highest: ShippingRuleSetBody = {
			steps: [{ ...DOMESTIC.steps[0], combine: 'highest' } as ShippingRuleSetBody['steps'][number]],
			adjust: [],
		};
		const lines = [view('line-1'), view('line-2')];
		const trace = [
			entry({ lineIds: ['line-1'], result: 'productCharge', amountINR: 250 }),
			entry({ lineIds: ['line-2'], result: 'productCharge', amountINR: 120 }),
		];
		expect(
			tryExplanation(t, {
				body: highest,
				lines,
				trace,
				adjustments: [{ kind: 'roundUp', fromINR: 245, toINR: 250 }],
			}),
		).toBe('Highest line ₹250 is taken once; ₹120 is dropped. Rounded up from ₹245 to ₹250.');

		const bands: ShippingRuleSetBody = {
			steps: [
				{
					id: 's1',
					scope: 'wholeCart',
					combine: 'sum',
					node: { kind: 'bands', id: 'b', field: 'cart.chargeableWeight', bands: [], otherwise: null },
				},
			],
			adjust: [],
		};
		const heavy = view('line-1', {
			box: { weightGrams: 750, lengthCm: 35, widthCm: 25, heightCm: 5 },
			chargeableWeightGrams: 1500,
		});
		expect(lineSubline(t, { body: bands, line: heavy, figures: undefined, trace: [], zone: 'domestic' })).toBe(
			'750 g · box 35×25×5 cm · chargeable 1,500 g',
		);
	});
});
