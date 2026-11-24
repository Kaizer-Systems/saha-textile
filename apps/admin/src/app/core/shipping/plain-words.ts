import { fieldKey, operatorKey } from './blocks';

import type {
	ShippingAmountSource,
	ShippingBandsNode,
	ShippingChargeKind,
	ShippingCondition,
	ShippingConditionGroup,
	ShippingIfNode,
	ShippingNode,
	ShippingResult,
	ShippingRuleSetBody,
	ShippingStep,
} from '@saha-textile/contracts';

/** Translates a key with its values (the page's Transloco). */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Names for ids a condition may hold (categories, products), when the page knows them. */
export type NameOf = (id: string) => string;

/** What a product charge comes to across the categories: one amount everywhere, or a range. */
export interface ChargeAmount {
	/** "₹100", or "₹100–₹150" when categories differ. */
	amount: string;
	every: boolean;
}
export type ChargeAmounts = Partial<Record<ShippingChargeKind, ChargeAmount>>;

const rupees = (value: number | null): string => (value === null ? '₹ …' : `₹${value.toLocaleString('en-IN')}`);

/** Money fields read as rupees; the discount reads as a percentage. */
const MONEY = new Set([
	'line.sellingPrice',
	'line.mrp',
	'cart.subtotal',
	'line.charge.domestic',
	'line.charge.internationalFirst',
	'line.charge.internationalFurther',
]);

/**
 * "In plain words" (brief rb02, rb03, rb06, rb09): the system writes the rule set out as sentences
 * from its blocks, so staff can check a rule set without reading the builder. A decision reads as
 * "if …, charge …" with its "Otherwise …" on the next line; a loop's combine and an empty adjust
 * share a line ("Add up every line. No adjustment.").
 */
export function plainWords(
	body: ShippingRuleSetBody,
	t: Translate,
	nameOf: NameOf = (id) => id,
	amounts: ChargeAmounts = {},
): string[] {
	const lines: string[] = [];
	const words = { t, nameOf, amounts };
	for (const step of body.steps) lines.push(...stepLines(step, words));
	const adjust = body.adjust.map((a) => {
		const value = a.kind === 'roundUp' ? a.to : a.kind === 'freeAbove' ? a.subtotal : a.amount;
		return t(`ship_pw_adjust_${a.kind}`, { amount: rupees(value) });
	});
	const lastStep = body.steps[body.steps.length - 1];
	if (adjust.length === 0) {
		// "Add up every line. No adjustment." when the last step is a loop; otherwise on its own line.
		if (lastStep && lastStep.scope !== 'wholeCart' && lines.length > 0)
			lines[lines.length - 1] = `${lines[lines.length - 1]} ${t('ship_pw_no_adjust')}`;
		else lines.push(t('ship_pw_no_adjust'));
	}
	lines.push(...adjust);
	return lines;
}

interface Words {
	t: Translate;
	nameOf: NameOf;
	amounts: ChargeAmounts;
}

const sentence = (text: string): string => {
	const trimmed = text.trim();
	const first = trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1);
	return /[.!?।]$/.test(first) ? first : `${first}.`;
};

function stepLines(step: ShippingStep, words: Words): string[] {
	const { t } = words;
	const loop = step.scope !== 'wholeCart';
	const out: string[] = [];
	const value = step.node;
	const prefix = t(`ship_pw_scope_${step.scope}`);

	if (value?.kind === 'if') {
		const when = group(value.when, words);
		const then = result(value.then, step, words, 'then');
		out.push(
			loop
				? sentence(`${prefix} ${t('ship_pw_if_then', { when, then })}`)
				: sentence(t('ship_pw_if_cart', { when, then })),
		);
		if (value.otherwise !== null || loop)
			out.push(sentence(t('ship_pw_otherwise', { then: result(value.otherwise, step, words, 'otherwise') })));
	} else if (value?.kind === 'result' && value.result.kind === 'firstAndFurther' && !loop) {
		// The whole cart, first and further units (brief rb03): the count, then the charge.
		out.push(t(`ship_pw_count_${value.result.count}`));
		out.push(sentence(firstAndFurther(value.result, step, words)));
	} else {
		out.push(sentence(`${prefix} ${result(value, step, words, 'then')}`));
	}
	if (loop) out.push(t(`ship_pw_combine_${step.combine}_${step.scope}`));
	return out;
}

function group(value: ShippingConditionGroup, words: Words): string {
	const parts = value.items.map((item) => (item.kind === 'group' ? group(item, words) : condition(item, words)));
	if (parts.length === 0) return '…';
	const joiner = words.t(value.join === 'all' ? 'ship_pw_and' : 'ship_pw_or');
	if (parts.length === 1) return parts[0] as string;
	// "A, and B or C, and D": the joiner after a comma once the list is longer than two.
	return parts.length === 2 ? parts.join(` ${joiner} `) : parts.join(`, ${joiner} `);
}

function condition(value: ShippingCondition, words: Words): string {
	const { t, nameOf } = words;
	if (value.field === null || value.op === null || value.value === null) return '…';
	const field = value.field;
	if (typeof value.value === 'boolean' && (value.op === 'is' || value.op === 'isNot')) {
		const holds = (value.op === 'is') === value.value;
		return t(`ship_pw_c_${value.field.replace(/\./g, '_')}_${holds ? 'yes' : 'no'}`);
	}
	const shown = (item: unknown): string => {
		if (typeof item === 'number')
			return MONEY.has(field)
				? rupees(item)
				: field === 'line.discountPercent'
					? `${item}%`
					: item.toLocaleString('en-IN');
		if (typeof item === 'string') return field === 'delivery.zone' ? t(`ship_zone_${item}`) : nameOf(item);
		return '';
	};
	const list = (items: unknown[]): string => {
		const names = items.map(shown);
		if (names.length <= 1) return names.join('');
		return `${names.slice(0, -1).join(', ')} ${t('ship_pw_or')} ${names[names.length - 1]}`;
	};
	const valueText = Array.isArray(value.value)
		? value.op === 'between'
			? `${shown(value.value[0])}–${shown(value.value[1])}`
			: list(value.value)
		: shown(value.value);
	// Phrases the brief writes in full (rb06): "the cart is ₹4,999 or more", "the delivery is in …".
	if (value.field === 'cart.subtotal' && value.op === 'atLeast')
		return t('ship_pw_cart_at_least', { value: valueText });
	if (value.field === 'delivery.state' && value.op === 'isOneOf')
		return t('ship_pw_delivery_in', { value: valueText });
	if (value.field === 'shopper.group' && value.op === 'is') return t('ship_pw_shopper_is', { value: valueText });
	if (
		value.field === 'delivery.zone' &&
		(value.op === 'is' || value.op === 'isNot') &&
		typeof value.value === 'string'
	)
		return t(
			`ship_pw_delivery_zone_${value.op === 'is' ? value.value : value.value === 'domestic' ? 'international' : 'domestic'}`,
		);
	return `${t(fieldKey(value.field)).toLocaleLowerCase()} ${t(operatorKey(value.op))} ${valueText}`;
}

function chargeAside(charge: ShippingChargeKind, words: Words): string {
	const known = words.amounts[charge];
	if (!known) return '';
	return ` ${words.t(known.every ? 'ship_pw_aside_every' : 'ship_pw_aside_range', { amount: known.amount })}`;
}

function result(value: ShippingNode | null, step: ShippingStep, words: Words, side: 'then' | 'otherwise'): string {
	const { t } = words;
	if (value === null) return t('ship_pw_nothing');
	if (value.kind === 'if' || value.kind === 'bands') return nested(value, step, words);
	const cart = step.scope === 'wholeCart';
	const r: ShippingResult = value.result;
	switch (r.kind) {
		case 'amount': {
			const what = t(`ship_pw_amount_${r.per}${r.per === 'once' && cart ? '_order' : ''}`, {
				amount: rupees(r.amount),
			});
			// "Otherwise ₹149 once per order" (rb06) reads without the verb.
			return side === 'otherwise' ? what : t('ship_pw_charge_what', { what });
		}
		case 'percent':
			return t(`ship_pw_percent_${r.of}`, { percent: r.percent ?? '…' });
		case 'productCharge':
			return (
				t(`ship_pw_product_${r.per}${r.per === 'once' && cart ? '_highest' : ''}`, {
					charge: t(`ship_pw_charge_${r.charge}`),
				}) + chargeAside(r.charge, words)
			);
		case 'firstAndFurther':
			return firstAndFurther(r, step, words);
		case 'free':
			return t(side === 'otherwise' && !cart ? 'ship_pw_line_free' : 'ship_pw_free');
		case 'cantShip':
			return t('ship_pw_cant_ship', { message: r.message['en'] ?? '' });
		case 'courierQuote':
			return t('ship_pw_courier');
	}
}

function nested(value: ShippingIfNode | ShippingBandsNode, step: ShippingStep, words: Words): string {
	const { t } = words;
	if (value.kind === 'if')
		return t('ship_pw_if_nested', {
			when: group(value.when, words),
			then: result(value.then, step, words, 'then'),
			otherwise: result(value.otherwise, step, words, 'otherwise'),
		});
	const parts = value.bands.map((band) =>
		t('ship_pw_band', {
			from: band.from ?? 0,
			to: band.to === null ? t('ship_pw_band_open') : String(band.to),
			then: result(band.then, step, words, 'then'),
		}),
	);
	return t('ship_pw_bands', {
		field: value.field ? t(fieldKey(value.field)).toLocaleLowerCase() : '…',
		bands: parts.join('; '),
		otherwise: result(value.otherwise, step, words, 'otherwise'),
	});
}

function firstAndFurther(
	value: Extract<ShippingResult, { kind: 'firstAndFurther' }>,
	step: ShippingStep,
	words: Words,
): string {
	const { t } = words;
	// Across the cart, the first unit is the highest product charge and each further unit pays its own
	// (brief rb03); per product, each product starts again at its own first unit.
	const across = step.scope === 'wholeCart' && value.count === 'acrossCart';
	const named = (side: ShippingAmountSource, key: string) =>
		side.from === 'fixed' ? rupees(side.amount) : t(key, { charge: t(`ship_pw_charge_${side.charge}`) });
	// "(₹2,000)" after a product charge when every category agrees, or its range.
	const amountOf = (side: ShippingAmountSource) => {
		if (side.from === 'fixed') return '';
		const known = words.amounts[side.charge];
		return known ? ` (${known.amount})` : '';
	};
	return t(`ship_pw_first_further_${across ? 'acrossCart' : 'perProduct'}`, {
		first: named(value.first, across ? 'ship_pw_highest_charge' : 'ship_pw_product_charge'),
		further: named(value.further, across ? 'ship_pw_own_charge' : 'ship_pw_product_charge'),
		firstAmount: amountOf(value.first),
		furtherAmount: amountOf(value.further),
	});
}
