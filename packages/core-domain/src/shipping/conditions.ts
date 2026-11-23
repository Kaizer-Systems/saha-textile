import type { ShippingCondition, ShippingConditionGroup, ShippingOperator } from '@saha-textile/contracts';

import { SHIPPING_FIELD_TYPES, factValue, type ShippingEvalScope, type ShippingFieldType } from './facts';

/** The operators each kind of field accepts, in the order the builder lists them. */
export const SHIPPING_OPERATORS_BY_TYPE: Readonly<Record<ShippingFieldType, readonly ShippingOperator[]>> = {
	boolean: ['is'],
	number: ['is', 'isNot', 'moreThan', 'atLeast', 'lessThan', 'atMost', 'between'],
	money: ['is', 'isNot', 'moreThan', 'atLeast', 'lessThan', 'atMost', 'between'],
	percent: ['is', 'isNot', 'moreThan', 'atLeast', 'lessThan', 'atMost', 'between'],
	grams: ['moreThan', 'atLeast', 'lessThan', 'atMost', 'between'],
	id: ['is', 'isNot', 'isOneOf', 'isNotOneOf'],
	text: ['is', 'isNot', 'isOneOf', 'isNotOneOf'],
	pincode: ['is', 'isOneOf', 'isNotOneOf', 'startsWith', 'between'],
};

const NUMERIC: ReadonlySet<ShippingFieldType> = new Set(['number', 'money', 'percent', 'grams']);

/** What a value must look like for an operator on a field type; null when the pair isn't allowed. */
export type ShippingValueShape = 'boolean' | 'number' | 'range' | 'text' | 'list' | 'textOrList';

export function valueShape(type: ShippingFieldType, op: ShippingOperator): ShippingValueShape | null {
	if (!SHIPPING_OPERATORS_BY_TYPE[type].includes(op)) return null;
	if (type === 'boolean') return 'boolean';
	if (op === 'between') return 'range';
	if (op === 'isOneOf' || op === 'isNotOneOf') return 'list';
	if (op === 'startsWith') return 'textOrList';
	return NUMERIC.has(type) ? 'number' : 'text';
}

export function valueMatchesShape(value: unknown, shape: ShippingValueShape): boolean {
	switch (shape) {
		case 'boolean':
			return typeof value === 'boolean';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'range':
			return (
				Array.isArray(value) &&
				value.length === 2 &&
				value.every((v) => typeof v === 'number' && Number.isFinite(v))
			);
		case 'text':
			return typeof value === 'string' && value.trim().length > 0;
		case 'list':
			return (
				Array.isArray(value) &&
				value.length > 0 &&
				value.every((v) => typeof v === 'string' && v.trim().length > 0)
			);
		case 'textOrList':
			return valueMatchesShape(value, 'text') || valueMatchesShape(value, 'list');
	}
}

const norm = (value: string): string => value.trim().toLowerCase();

/** True when the fact (one value, or the list a line or shopper belongs to) contains the wanted text. */
function textHas(fact: string | string[], wanted: string): boolean {
	return Array.isArray(fact) ? fact.some((item) => norm(item) === norm(wanted)) : norm(fact) === norm(wanted);
}

/**
 * Whether one condition holds. An unfinished condition (a draft) never holds, so a draft can be
 * tried without crashing; `validateShippingRuleSet` stops it going live.
 */
export function conditionHolds(condition: ShippingCondition, scope: ShippingEvalScope): boolean {
	const { field, op, value } = condition;
	if (field === null || op === null || value === null) return false;
	const type = SHIPPING_FIELD_TYPES[field];
	const shape = valueShape(type, op);
	if (shape === null || !valueMatchesShape(value, shape)) return false;
	const fact = factValue(field, scope);
	if (fact === null) return false;

	if (type === 'boolean') return typeof fact === 'boolean' && fact === value;
	// The shape check admits only these operators for each type, and a field's facts are always of its type.
	if (NUMERIC.has(type)) return NUMBER_TESTS[op as NumberOp](fact as number, value);
	if (type === 'pincode') {
		const pin = (fact as string).replace(/\s+/g, '');
		return pin !== '' && PINCODE_TESTS[op as PincodeOp](pin, value);
	}
	return TEXT_TESTS[op as TextOp](fact as string | string[], value);
}

type NumberOp = 'is' | 'isNot' | 'moreThan' | 'atLeast' | 'lessThan' | 'atMost' | 'between';
type PincodeOp = 'is' | 'isOneOf' | 'isNotOneOf' | 'startsWith' | 'between';
type TextOp = 'is' | 'isNot' | 'isOneOf' | 'isNotOneOf';

const NUMBER_TESTS: Record<NumberOp, (fact: number, value: unknown) => boolean> = {
	is: (fact, value) => Math.abs(fact - (value as number)) < 1e-9,
	isNot: (fact, value) => Math.abs(fact - (value as number)) >= 1e-9,
	moreThan: (fact, value) => fact > (value as number),
	atLeast: (fact, value) => fact >= (value as number),
	lessThan: (fact, value) => fact < (value as number),
	atMost: (fact, value) => fact <= (value as number),
	between: (fact, value) => {
		const [lo, hi] = value as [number, number];
		return fact >= lo && fact <= hi;
	},
};

const PINCODE_TESTS: Record<PincodeOp, (pin: string, value: unknown) => boolean> = {
	is: (pin, value) => pin === String(value).replace(/\s+/g, ''),
	isOneOf: (pin, value) => (value as string[]).some((v) => v.replace(/\s+/g, '') === pin),
	isNotOneOf: (pin, value) => !(value as string[]).some((v) => v.replace(/\s+/g, '') === pin),
	startsWith: (pin, value) => {
		const prefixes = Array.isArray(value) ? (value as string[]) : [value as string];
		return prefixes.some((p) => p.trim() !== '' && pin.startsWith(p.replace(/\s+/g, '')));
	},
	between: (pin, value) => {
		if (!/^\d+$/.test(pin)) return false;
		const [lo, hi] = value as [number, number];
		const n = Number(pin);
		return n >= lo && n <= hi;
	},
};

const TEXT_TESTS: Record<TextOp, (fact: string | string[], value: unknown) => boolean> = {
	is: (fact, value) => textHas(fact, value as string),
	isNot: (fact, value) => !textHas(fact, value as string),
	isOneOf: (fact, value) => (value as string[]).some((v) => textHas(fact, v)),
	isNotOneOf: (fact, value) => !(value as string[]).some((v) => textHas(fact, v)),
};

/** AND / OR over a group; an empty group is not a valid rule, so it never holds. */
export function groupHolds(group: ShippingConditionGroup, scope: ShippingEvalScope): boolean {
	if (group.items.length === 0) return false;
	const holds = (item: ShippingCondition | ShippingConditionGroup): boolean =>
		item.kind === 'group' ? groupHolds(item, scope) : conditionHolds(item, scope);
	return group.join === 'all' ? group.items.every(holds) : group.items.some(holds);
}
