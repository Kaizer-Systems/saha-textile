import { fieldKey, operatorKey } from './blocks';

import type {
	ShippingAmountSource,
	ShippingCondition,
	ShippingConditionGroup,
	ShippingNode,
	ShippingResult,
	ShippingRuleSetBody,
	ShippingStep,
} from '@saha-textile/contracts';

/** Translates a key with its values (the page's Transloco). */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Names for ids a condition may hold (categories, products), when the page knows them. */
export type NameOf = (id: string) => string;

const rupees = (value: number | null): string => (value === null ? '₹ …' : `₹${value.toLocaleString('en-IN')}`);

/**
 * "In plain words" (brief rb02): the system writes the rule set out as sentences from its blocks,
 * so staff can check a rule set without reading the builder. One line per step and adjustment.
 */
export function plainWords(body: ShippingRuleSetBody, t: Translate, nameOf: NameOf = (id) => id): string[] {
	const lines: string[] = [];
	for (const step of body.steps) {
		lines.push(`${t(`ship_pw_scope_${step.scope}`)} ${node(step.node, step, t, nameOf)}`);
		if (step.scope !== 'wholeCart') lines.push(t(`ship_pw_combine_${step.combine}`));
	}
	if (body.adjust.length === 0) lines.push(t('ship_pw_no_adjust'));
	for (const adjust of body.adjust) {
		const value =
			adjust.kind === 'roundUp' ? adjust.to : adjust.kind === 'freeAbove' ? adjust.subtotal : adjust.amount;
		lines.push(t(`ship_pw_adjust_${adjust.kind}`, { amount: rupees(value) }));
	}
	return lines;
}

function node(value: ShippingNode | null, step: ShippingStep, t: Translate, nameOf: NameOf): string {
	if (value === null) return t('ship_pw_nothing');
	switch (value.kind) {
		case 'result':
			return result(value.result, step, t);
		case 'if':
			return t('ship_pw_if', {
				when: group(value.when, t, nameOf),
				then: node(value.then, step, t, nameOf),
				otherwise: node(value.otherwise, step, t, nameOf),
			});
		case 'bands': {
			const parts = value.bands.map((band) =>
				t('ship_pw_band', {
					from: band.from ?? 0,
					to: band.to === null ? t('ship_pw_band_open') : String(band.to),
					then: node(band.then, step, t, nameOf),
				}),
			);
			return t('ship_pw_bands', {
				field: value.field ? t(fieldKey(value.field)) : '…',
				bands: parts.join('; '),
				otherwise: node(value.otherwise, step, t, nameOf),
			});
		}
	}
}

function group(value: ShippingConditionGroup, t: Translate, nameOf: NameOf): string {
	const joiner = value.join === 'all' ? ` ${t('ship_pw_and')} ` : ` ${t('ship_pw_or')} `;
	const parts = value.items.map((item) =>
		item.kind === 'group' ? `(${group(item, t, nameOf)})` : condition(item, t, nameOf),
	);
	return parts.length ? parts.join(joiner) : '…';
}

function condition(value: ShippingCondition, t: Translate, nameOf: NameOf): string {
	if (value.field === null || value.op === null || value.value === null) return '…';
	const shown = (item: unknown): string => {
		if (typeof item === 'boolean') return t(item ? 'yes' : 'no');
		if (typeof item === 'number') return item.toLocaleString('en-IN');
		if (typeof item === 'string') return value.field === 'delivery.zone' ? t(`ship_zone_${item}`) : nameOf(item);
		return '';
	};
	const valueText = Array.isArray(value.value)
		? value.op === 'between'
			? `${shown(value.value[0])}–${shown(value.value[1])}`
			: value.value.map(shown).join(', ')
		: shown(value.value);
	return `“${t(fieldKey(value.field))}” ${t(operatorKey(value.op))} ${valueText}`;
}

function source(value: ShippingAmountSource, t: Translate): string {
	return value.from === 'fixed' ? rupees(value.amount) : t(`ship_pw_charge_${value.charge}`);
}

function result(value: ShippingResult, step: ShippingStep, t: Translate): string {
	const cart = step.scope === 'wholeCart';
	switch (value.kind) {
		case 'amount':
			return t(`ship_pw_amount_${value.per}${value.per === 'once' && cart ? '_order' : ''}`, {
				amount: rupees(value.amount),
			});
		case 'percent':
			return t(`ship_pw_percent_${value.of}`, { percent: value.percent ?? '…' });
		case 'productCharge':
			return t(`ship_pw_product_${value.per}${value.per === 'once' && cart ? '_highest' : ''}`, {
				charge: t(`ship_pw_charge_${value.charge}`),
			});
		case 'firstAndFurther':
			return t(`ship_pw_first_further_${cart ? value.count : 'perProduct'}`, {
				first: source(value.first, t),
				further: source(value.further, t),
			});
		case 'free':
			return t('ship_pw_free');
		case 'cantShip':
			return t('ship_pw_cant_ship', { message: value.message['en'] ?? '' });
		case 'courierQuote':
			return t('ship_pw_courier');
	}
}
