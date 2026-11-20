import { describe, expect, it } from 'vitest';

import { formulaWords, newZoneFormula, newZoneRule, ruleWords } from '@core/zones/zone-blocks';

import { startValue } from './zone-conditions';
import { isoToLocalInput, localInputToIso, zoneProblemsOf } from './zone-editor';
import { zonePill } from './zone-list';

import type { ZoneRule } from '@saha-textile/contracts';

const t = (key: string, params?: Record<string, string | number>) =>
	params ? `${key}(${Object.values(params).join('|')})` : key;

describe('zone rules in plain words (DEC-B2B-ZONES)', () => {
	it('reads a category rule with a condition, extras and rounding', () => {
		const rule: ZoneRule = {
			...newZoneRule('category'),
			scope: { tier: 'category', categoryIds: ['cat_silk'], includeSubcategories: true },
			when: {
				kind: 'group',
				id: 'g',
				join: 'all',
				items: [{ kind: 'condition', id: 'c', field: 'line.isOnSale', op: 'is', value: true }],
			},
			price: {
				kind: 'lowerOf',
				formulas: [
					{ kind: 'amountOffBase', base: 'currentSaleOrRegular', amountINR: 0.01 },
					{ kind: 'percentOffBase', base: 'regularSelling', percent: 20 },
				],
			},
			rounding: 'endingInNine',
			floorINR: 500,
		};
		const words = ruleWords(rule, t, (id) => (id === 'cat_silk' ? 'Silk sarees' : id));
		expect(words).toContain('zone_words_scope_categories_subs(Silk sarees)');
		expect(words).toContain('zone_words_when(zone_field_line_isOnSale zone_op_is zone_yes)');
		expect(words).toContain('zone_words_lowerOf(');
		expect(words).toContain('zone_words_floor(₹500)');
		expect(words).toContain('zone_rounding_endingInNine');
	});

	it('words breaks step by step, and marks a rule that is off', () => {
		const breaks = newZoneFormula('quantityBreaks');
		expect(formulaWords(breaks, t)).toBe(
			'zone_words_from_quantity(10|zone_words_percent_off(10|zone_base_regularSelling))',
		);
		expect(ruleWords({ ...newZoneRule('allProducts'), enabled: false }, t)).toContain('(zone_words_off)');
	});
});

describe('zone builder helpers', () => {
	it('starts each condition with a value of its kind', () => {
		expect(startValue('line.isOnSale', 'is')).toBe(true);
		expect(startValue('line.quantity', 'between')).toEqual([0, 0]);
		expect(startValue('line.categoryIds', 'isOneOf')).toEqual([]);
		expect(startValue('line.currentSaleINR', 'isEmpty')).toBeNull();
	});

	it('reads dates in India time both ways', () => {
		expect(isoToLocalInput('2026-11-20T05:00:00.000Z')).toBe('2026-11-20T10:30');
		expect(localInputToIso('2026-11-20T10:30')).toBe('2026-11-20T05:00:00.000Z');
		expect(localInputToIso('')).toBeNull();
	});

	it('finds the rules the server flagged, wrapped or not', () => {
		const body = {
			issues: [
				{ code: 'zone_rule_problems', params: { problems: [{ ruleId: 'r1', problem: 'value_missing' }] } },
			],
		};
		expect(zoneProblemsOf({ error: body }).get('r1')).toEqual(['value_missing']);
		expect(zoneProblemsOf({ error: { error: body } }).get('r1')).toEqual(['value_missing']);
		expect(zoneProblemsOf(new Error('x')).size).toBe(0);
		expect(zonePill('live')).toBe('success');
	});
});
