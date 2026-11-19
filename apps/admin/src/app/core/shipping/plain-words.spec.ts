import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PREMADE_RULE_SETS } from '@saha-textile/core-domain/shipping';
import { describe, expect, it } from 'vitest';

import { FIELD_GROUPS, duplicateStep, fieldKey, newNode, newStep, operatorKey } from './blocks';
import { plainWords, type Translate } from './plain-words';

import type { ShippingRuleSetBody } from '@saha-textile/contracts';

const dictionary = (lang: 'en' | 'bn') =>
	JSON.parse(readFileSync(resolve(__dirname, `../../../../public/assets/i18n/${lang}.json`), 'utf8')) as Record<
		string,
		string
	>;
const translator =
	(words: Record<string, string>): Translate =>
	(key, params = {}) => {
		const text = words[key];
		if (text === undefined) throw new Error(`missing key ${key}`);
		return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ''));
	};
const en = translator(dictionary('en'));
const bn = translator(dictionary('bn'));

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
					id: 'g-1',
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

describe('plain words', () => {
	it('writes Saha Textile’s domestic rule set as sentences', () => {
		expect(plainWords(SAHA_TEXTILE_DOMESTIC, en)).toEqual([
			'For each line in the cart: if “Is discounted” is Yes: charge the product’s domestic charge for each unit; otherwise: free',
			'Add up every result.',
			'No adjustment.',
		]);
	});

	it('writes the international one, an unfinished branch and adjustments', () => {
		const body: ShippingRuleSetBody = {
			steps: [
				{
					id: 's',
					scope: 'wholeCart',
					combine: 'sum',
					node: {
						kind: 'result',
						id: 'r',
						result: {
							kind: 'firstAndFurther',
							first: { from: 'product', charge: 'internationalFirst' },
							further: { from: 'product', charge: 'internationalFurther' },
							count: 'acrossCart',
						},
					},
				},
				{ id: 't', scope: 'eachLine', combine: 'highest', node: null },
			],
			adjust: [
				{ kind: 'roundUp', id: 'round', to: 10 },
				{ kind: 'freeAbove', id: 'free', subtotal: 4999 },
			],
		};
		expect(plainWords(body, en)).toEqual([
			'For the whole cart: charge the highest international first-unit charge among the products once, then that unit’s own international further-unit charge for each further unit, counting every unit in the cart',
			'For each line in the cart: no result (to be filled in)',
			'Take only the highest result.',
			'Round up to the nearest ₹10.',
			'Free when the cart is ₹4,999 or more.',
		]);
	});

	it('every pre-made rule set reads in English and in Bengali with no missing words', () => {
		for (const premade of PREMADE_RULE_SETS) {
			expect(plainWords(premade.body, en).length, premade.key).toBeGreaterThan(1);
			expect(plainWords(premade.body, bn).join(' '), premade.key).toMatch(/[ঀ-৿]/);
		}
	});

	it('names every field and operator the builder offers, in both languages', () => {
		const words = { en: dictionary('en'), bn: dictionary('bn') };
		for (const group of FIELD_GROUPS)
			for (const field of group.fields)
				for (const lang of ['en', 'bn'] as const) expect(words[lang][fieldKey(field)], field).toBeTruthy();
		for (const op of [
			'is',
			'isNot',
			'isOneOf',
			'isNotOneOf',
			'moreThan',
			'atLeast',
			'lessThan',
			'atMost',
			'between',
			'startsWith',
		] as const) {
			expect(words.bn[operatorKey(op)], op).toBeTruthy();
		}
	});
});

describe('blocks', () => {
	it('duplicates a step with every block id renewed', () => {
		const step = { ...newStep('eachLine'), node: newNode('if') };
		const copy = duplicateStep(step);
		expect(copy.id).not.toBe(step.id);
		expect(copy.node?.id).not.toBe(step.node?.id);
		expect(copy.node?.kind).toBe('if');
		expect(copy.id).toMatch(/^[a-z0-9-]{1,40}$/);
	});
});
