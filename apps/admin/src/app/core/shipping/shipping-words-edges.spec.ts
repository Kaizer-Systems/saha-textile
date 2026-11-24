import { describe, expect, it } from 'vitest';

import { plainWords } from './plain-words';
import { entryWords, findNode, lineFigures, lineState, lineSubline, tryExplanation } from './try-words';

import type {
	ShippingCondition,
	ShippingNode,
	ShippingResult,
	ShippingRuleSetBody,
	ShippingStep,
	ShippingTraceEntry,
	ShippingTryLineView,
} from '@saha-textile/contracts';

/** Keys come back with their values after a colon, so a sentence ends the way its last value does. */
const t = (key: string, params?: Record<string, string | number>) =>
	params && Object.keys(params).length ? `${key}:${Object.values(params).join('|')}` : key;

const res = (id: string, result: ShippingResult): ShippingNode => ({ kind: 'result', id, result });
const step = (node: ShippingNode | null, over: Partial<ShippingStep> = {}): ShippingStep => ({
	id: 'step-1',
	scope: 'eachLine',
	combine: 'sum',
	node,
	...over,
});
const body = (steps: ShippingStep[], adjust: ShippingRuleSetBody['adjust'] = []): ShippingRuleSetBody => ({
	steps,
	adjust,
});
const cond = (over: Partial<ShippingCondition>): ShippingCondition => ({
	kind: 'condition',
	id: 'c',
	field: 'cart.subtotal',
	op: 'is',
	value: 1,
	...over,
});
const ifNode = (
	items: ShippingCondition[],
	then: ShippingNode | null,
	otherwise: ShippingNode | null = null,
): ShippingNode => ({
	kind: 'if',
	id: 'if-1',
	when: { kind: 'group', id: 'g', join: 'all', items },
	then,
	otherwise,
});
const words = (b: ShippingRuleSetBody, amounts = {}) => plainWords(b, t, (id) => `name-${id}`, amounts);

const line = (lineId: string, over: Partial<ShippingTryLineView> = {}): ShippingTryLineView =>
	({
		lineId,
		productId: 'p',
		title: 'T',
		units: 1,
		sellingPriceINR: 800,
		mrpINR: 1000,
		discounted: false,
		charges: { domestic: 100, internationalFirst: 2000, internationalFurther: 500 },
		chargeableWeightGrams: null,
		variantLabel: null,
		imageUrl: null,
		...over,
	}) as ShippingTryLineView;
const entry = (over: Partial<ShippingTraceEntry>): ShippingTraceEntry => ({
	stepId: 'step-1',
	lineIds: ['l1'],
	path: [],
	result: 'amount',
	amountINR: 100,
	...over,
});

describe('in plain words: conditions (rb06)', () => {
	const when = (items: ShippingCondition[]) => words(body([step(ifNode(items, res('r', { kind: 'free' })))]))[0];

	it('reads every kind of value and the phrases the brief writes in full', () => {
		expect(when([])).toContain('ship_pw_if_then:…|');
		expect(when([cond({ field: null })])).toContain(':…|');
		expect(when([cond({ field: 'line.discounted', op: 'isNot', value: true })])).toContain(
			'ship_pw_c_line_discounted_no',
		);
		expect(when([cond({ field: 'line.discounted', op: 'moreThan', value: true })])).toContain('ship_op_moreThan ');
		expect(when([cond({ field: 'line.discountPercent', op: 'atLeast', value: 20 })])).toContain('20%');
		expect(when([cond({ field: 'cart.units', op: 'atLeast', value: 1200 })])).toContain('1,200');
		expect(when([cond({ field: 'cart.subtotal', op: 'atLeast', value: 4999 })])).toContain(
			'ship_pw_cart_at_least:₹4,999',
		);
		expect(when([cond({ field: 'cart.subtotal', op: 'between', value: [100, 200] })])).toContain('₹100–₹200');
		expect(when([cond({ field: 'delivery.state', op: 'isOneOf', value: ['WB'] })])).toContain(
			'ship_pw_delivery_in:name-WB',
		);
		expect(when([cond({ field: 'delivery.state', op: 'isNotOneOf', value: ['WB', 'AS', 'OD'] })])).toContain(
			'name-WB, name-AS ship_pw_or name-OD',
		);
		expect(when([cond({ field: 'shopper.group', op: 'is', value: 'trade' })])).toContain(
			'ship_pw_shopper_is:name-trade',
		);
		expect(when([cond({ field: 'delivery.zone', op: 'is', value: 'international' })])).toContain(
			'ship_pw_delivery_zone_international',
		);
		expect(when([cond({ field: 'delivery.zone', op: 'isNot', value: 'domestic' })])).toContain(
			'ship_pw_delivery_zone_international',
		);
		expect(when([cond({ field: 'delivery.zone', op: 'isNot', value: 'international' })])).toContain(
			'ship_pw_delivery_zone_domestic',
		);
		expect(when([cond({ field: 'delivery.zone', op: 'isOneOf', value: ['domestic'] })])).toContain(
			'ship_zone_domestic',
		);
	});

	it('joins two conditions plainly and three with commas', () => {
		const three = when([cond({}), cond({ value: 2 }), cond({ value: 3 })]);
		expect(three).toContain(', ship_pw_and ');
	});
});

describe('in plain words: results, nesting and steps', () => {
	it('reads every result in a line loop and for the whole cart', () => {
		const amounts = {
			domestic: { amount: '₹100', every: true },
			internationalFirst: { amount: '₹1,500–₹2,000', every: false },
		};
		const cart = (node: ShippingNode) => words(body([step(node, { scope: 'wholeCart' })]), amounts);
		expect(cart(res('r', { kind: 'amount', amount: 149, per: 'once' }))[0]).toContain('ship_pw_amount_once_order');
		expect(cart(res('r', { kind: 'productCharge', charge: 'domestic', per: 'once' }))[0]).toContain(
			'ship_pw_product_once_highest',
		);
		expect(cart(res('r', { kind: 'productCharge', charge: 'domestic', per: 'once' }))[0]).toContain(
			'ship_pw_aside_every',
		);
		expect(cart(res('r', { kind: 'productCharge', charge: 'internationalFirst', per: 'unit' }))[0]).toContain(
			'ship_pw_aside_range',
		);
		expect(cart(res('r', { kind: 'productCharge', charge: 'internationalFurther', per: 'unit' }))[0]).not.toContain(
			'aside',
		);
		expect(cart(res('r', { kind: 'percent', percent: null, of: 'cart' } as never))[0]).toContain(':…');
		expect(cart(res('r', { kind: 'free' }))[0]).toContain('ship_pw_free');
		expect(cart(res('r', { kind: 'cantShip', message: {} }))[0]).toContain('ship_pw_cant_ship:');
		expect(cart(res('r', { kind: 'cantShip', message: { en: 'No shipping here.' } }))[0]).toMatch(/here\.$/);
		expect(cart(res('r', { kind: 'courierQuote' }))[0]).toContain('ship_pw_courier');
		const across = cart(
			res('r', {
				kind: 'firstAndFurther',
				first: { from: 'product', charge: 'internationalFirst' },
				further: { from: 'fixed', amount: null },
				count: 'acrossCart',
			}),
		);
		expect(across[0]).toBe('ship_pw_count_acrossCart');
		expect(across[1]).toMatch(/ship_pw_first_further_acrossCart/i);
		expect(across[1]).toContain('(₹1,500–₹2,000)');
		expect(across[1]).toContain('₹ …');
		const perProduct = words(
			body([
				step(
					res('r', {
						kind: 'firstAndFurther',
						first: { from: 'fixed', amount: 300 },
						further: { from: 'product', charge: 'internationalFurther' },
						count: 'perProduct',
					} as never),
				),
			]),
		);
		expect(perProduct[0]).toContain('ship_pw_first_further_perProduct');
	});

	it('reads nested decisions and bands, and a cart decision with no otherwise', () => {
		const nested = words(
			body([
				step(
					ifNode([cond({})], ifNode([cond({})], null, res('r', { kind: 'free' })), {
						kind: 'bands',
						id: 'bands',
						field: null,
						bands: [
							{
								id: 'b1',
								from: null,
								to: 500,
								then: res('r1', { kind: 'amount', amount: 50, per: 'unit' }),
							},
							{ id: 'b2', from: 500, to: null, then: null },
						],
						otherwise: null,
					}),
				),
			]),
		);
		expect(nested[0]).toContain('ship_pw_if_nested');
		expect(nested[1]).toContain('ship_pw_bands:…|');
		expect(nested[1]).toContain('ship_pw_band:0|500|');
		expect(nested[1]).toContain('ship_pw_band_open');
		expect(nested[0]).toContain('ship_pw_nothing');
		const withField = words(
			body([step({ kind: 'bands', id: 'b', field: 'cart.subtotal', bands: [], otherwise: null })]),
		);
		expect(withField[0]).toContain('ship_f_cart_subtotal');
		const cartIf = words(body([step(ifNode([cond({})], res('r', { kind: 'free' })), { scope: 'wholeCart' })]));
		expect(cartIf).toEqual([
			'Ship_pw_if_cart:ship_f_cart_subtotal ship_op_is ₹1|ship_pw_free.',
			'ship_pw_no_adjust',
		]);
		const otherwiseFree = words(body([step(ifNode([cond({})], null, res('r', { kind: 'free' })))]));
		expect(otherwiseFree[1]).toContain('ship_pw_line_free');
	});

	it('reads the adjustments, and says "No adjustment" on its own line when needed', () => {
		expect(words(body([]))).toEqual(['ship_pw_no_adjust']);
		expect(
			words(
				body(
					[step(res('r', { kind: 'free' }))],
					[
						{ kind: 'minimum', id: 'a1', amount: null },
						{ kind: 'roundUp', id: 'a2', to: 10 },
						{ kind: 'freeAbove', id: 'a3', subtotal: 5000 },
					],
				),
			).slice(-3),
		).toEqual(['ship_pw_adjust_minimum:₹ …', 'ship_pw_adjust_roundUp:₹10', 'ship_pw_adjust_freeAbove:₹5,000']);
	});
});

describe('Try it words: blocks, figures and lines (rb02, rb03, rb10)', () => {
	const ff = (count: 'acrossCart' | 'perProduct') =>
		res('ff', {
			kind: 'firstAndFurther',
			first: { from: 'product', charge: 'internationalFirst' },
			further: { from: 'product', charge: 'internationalFurther' },
			count,
		});

	it('finds a block anywhere in the steps', () => {
		const deep = res('deep', { kind: 'free' });
		const b = body([
			step(null),
			step(
				ifNode([], null, {
					kind: 'bands',
					id: 'bands',
					field: 'cart.subtotal',
					bands: [
						{ id: 'b1', from: 0, to: null, then: res('miss', { kind: 'free' }) },
						{ id: 'b2', from: 0, to: null, then: deep },
					],
					otherwise: res('other', { kind: 'free' }),
				}),
			),
		]);
		expect(findNode(b, 'deep')).toBe(deep);
		expect(findNode(b, 'other')?.id).toBe('other');
		expect(findNode(b, 'nowhere')).toBeNull();
	});

	it('shares each entry out to its lines, and numbers the units when the cart is counted', () => {
		const lines = [
			line('l1', { units: 2, charges: { domestic: 0, internationalFirst: 1000, internationalFurther: 300 } }),
			line('l2', { units: 1, charges: { domestic: 0, internationalFirst: 2000, internationalFurther: 500 } }),
			line('l3', { units: 0 }),
		];
		const across = body([step(ff('acrossCart'), { scope: 'wholeCart' })]);
		const figures = lineFigures(across, lines, [
			entry({ lineIds: ['l1', 'l2'], path: ['ff'], result: 'firstAndFurther' }),
			entry({ lineIds: ['ghost'], amountINR: 5 }),
			entry({ lineIds: ['l1', 'l2'], path: [], result: 'amount' }),
			entry({ lineIds: ['l1', 'l2'], path: ['nowhere'], result: 'amount' }),
		]);
		expect(figures.get('l1')).toEqual({ amountINR: 600, units: { from: 1, to: 2 } });
		expect(figures.get('l2')).toEqual({ amountINR: 2000, units: { from: 3, to: 3 } });
		expect(figures.get('l3')?.units).toBeNull();
		const perProduct = body([
			step(
				res('ff', {
					kind: 'firstAndFurther',
					first: { from: 'fixed', amount: null },
					further: { from: 'fixed', amount: 50 },
					count: 'perProduct',
				} as ShippingResult),
				{ scope: 'wholeCart' },
			),
		]);
		const own = lineFigures(perProduct, lines.slice(0, 1), [
			entry({ lineIds: ['l1', 'l2'], path: ['ff'], result: 'firstAndFurther' }),
		]);
		expect(own.get('l1')?.amountINR).toBe(50);
		const ifBody = body([step(ifNode([], res('x', { kind: 'free' })))]);
		expect(
			lineFigures(ifBody, lines, [entry({ lineIds: ['l1', 'l2'], path: ['if-1'] })]).get('l1')?.amountINR,
		).toBeNull();
	});

	it('says a line’s price state, its weights, units and the charge it took', () => {
		expect(lineState(t, line('l1', { discounted: true }), true)).toBe('ship_state_percent_off:20');
		expect(lineState(t, line('l1', { discounted: true, mrpINR: null }), true)).toBe('ship_state_discounted');
		const weighs = body([step(res('r', { kind: 'amount', amount: 40, per: 'kg' }))]);
		const sub = (view: ShippingTryLineView, b = weighs, extra: Partial<Parameters<typeof lineSubline>[1]> = {}) =>
			lineSubline(t, { body: b, line: view, figures: undefined, trace: [], zone: 'domestic', ...extra });
		expect(sub(line('l1'))).toBe('');
		expect(sub(line('l1', { box: { weightGrams: 900 } } as never))).toBe('900 g');
		expect(
			sub(
				line('l1', {
					chargeableWeightGrams: 1500,
					box: { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 },
				} as never),
			),
		).toBe('900 g · ship_line_box:30|20|10 · ship_line_chargeable:1,500');
		expect(sub(line('l1', { box: { lengthCm: 30, widthCm: null, heightCm: 10 } } as never))).toBe('');
		expect(sub(line('l1', { chargeableWeightGrams: 1500, box: { weightGrams: 900 } } as never))).toBe('900 g');
		const plain = body([step(res('r', { kind: 'productCharge', charge: 'domestic', per: 'unit' }))]);
		expect(sub(line('l1'), plain, { figures: { amountINR: 1, units: { from: 2, to: 2 } } })).toBe(
			'Ship_state_full_price · ship_line_unit:2',
		);
		expect(sub(line('l1'), plain, { figures: { amountINR: 1, units: { from: 1, to: 3 } } })).toBe(
			'Ship_state_full_price · ship_line_units:1|3',
		);
		expect(sub(line('l1', { mrpINR: null }), plain)).toBe('ship_line_price:₹800 · ship_state_full_price');
		const own = [entry({ lineIds: ['l1'], path: ['r'] })];
		expect(sub(line('l1'), plain, { trace: own })).toContain('ship_line_charge:₹100');
		expect(
			sub(line('l1', { chargeSources: { domestic: { from: 'category', name: 'Sarees' } } } as never), plain, {
				trace: own,
			}),
		).toContain('ship_line_charge_from:₹100|Sarees');
		expect(
			sub(line('l1', { chargeSources: { domestic: { from: 'category', name: '' } } } as never), plain, {
				trace: own,
			}),
		).toContain('ship_line_charge:₹100');
		expect(sub(line('l1'), body([step(res('r', { kind: 'free' }))]), { trace: own })).not.toContain('charge');
	});
});

describe('Try it words: the result box (rb03, rb09)', () => {
	const across = body([
		step(
			res('ff', {
				kind: 'firstAndFurther',
				first: { from: 'product', charge: 'internationalFirst' },
				further: { from: 'product', charge: 'internationalFurther' },
				count: 'acrossCart',
			}),
			{ scope: 'wholeCart' },
		),
	]);
	const whole = (over: Partial<ShippingTraceEntry>) =>
		tryExplanation(t, {
			body: across,
			lines: [],
			trace: [entry({ lineIds: ['l1', 'l2'], path: ['ff'], result: 'firstAndFurther', ...over })],
		});

	it('counts the units of the whole cart', () => {
		expect(whole({})).toBe('ship_explain_unit_one:₹0');
		expect(whole({ units: 2, firstINR: 2000 })).toBe('ship_explain_unit_two:₹2,000|₹0');
		expect(whole({ units: 3, firstINR: 2000, furtherINR: 500 })).toBe('ship_explain_units_three:₹2,000|₹500');
		expect(whole({ units: 5, firstINR: 2000, furtherINR: 500 })).toBe('ship_explain_units_many:₹2,000|5|₹500');
	});

	it('keeps the highest or lowest line, or explains each line, then the adjustments', () => {
		const lines = [line('l1'), line('l2', { discounted: true }), line('l3')];
		const per = [
			entry({ lineIds: ['l1'], amountINR: 100 }),
			entry({ lineIds: ['l2'], amountINR: 300 }),
			entry({ lineIds: ['l3'], amountINR: 200 }),
		];
		const combine = (choice: 'highest' | 'lowest', trace = per) =>
			tryExplanation(t, { body: body([step(null, { combine: choice })]), lines, trace });
		expect(combine('highest')).toBe('ship_explain_highest_many:₹300|₹200, ₹100');
		expect(combine('lowest', per.slice(0, 2))).toBe('ship_explain_lowest_one:₹100|₹300');
		const each = tryExplanation(t, {
			body: body([step(null, { scope: 'wholeCart' })]),
			lines,
			trace: [...per, entry({ lineIds: ['ghost'] })],
			adjustments: [
				{ kind: 'minimum', fromINR: 50, toINR: 99 },
				{ kind: 'maximum', fromINR: 10, toINR: 10 },
			],
		});
		expect(each).toBe(
			'ship_explain_line:1|ship_state_full_price|₹100 ship_explain_line:2|ship_state_discounted|₹300 ' +
				'ship_explain_line:3|ship_state_full_price|₹200 ship_explain_adjust_minimum:₹50|₹99',
		);
		expect(tryExplanation(t, { body: body([]), lines: [], trace: [] })).toBe('');
	});

	it('words every kind of entry', () => {
		expect(entryWords(t, entry({ result: 'free' }))).toBe('ship_why_free');
		expect(entryWords(t, entry({ result: 'none' }))).toBe('ship_why_none');
		expect(entryWords(t, entry({ result: 'cantShip' }))).toBe('ship_why_cant_ship');
		expect(entryWords(t, entry({ result: 'courierQuote' }))).toBe('ship_why_courier');
		expect(entryWords(t, entry({ result: 'percent', amountINR: 245 }))).toBe('ship_why_percent:0|₹245');
		expect(entryWords(t, entry({ result: 'percent', percent: 10, amountINR: 245 }))).toBe(
			'ship_why_percent:10|₹245',
		);
		expect(entryWords(t, entry({ kg: 2, amountINR: 80 }))).toBe('ship_why_kg:2|₹0|₹80');
		expect(entryWords(t, entry({ kg: 2, unitAmountINR: 40, amountINR: 80 }))).toBe('ship_why_kg:2|₹40|₹80');
		expect(entryWords(t, entry({ units: 1, unitAmountINR: 100 }))).toBe('ship_why_unit_one:1|₹100');
		expect(entryWords(t, entry({ units: 2, unitAmountINR: 100 }))).toBe('ship_why_units_each:2|₹100');
		expect(entryWords(t, entry({ units: 2, amountINR: 149 }))).toBe('₹149');
		expect(entryWords(t, entry({ amountINR: 149 }))).toBe('₹149');
	});
});
