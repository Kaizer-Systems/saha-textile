import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { BundleRuleRows } from './bundle-rule-rows';
import { ruleSentence } from './rule-words';

import type { BundlePriceRule } from '@saha-textile/contracts';

const t = (key: string) => key;
const rule = (over: Partial<BundlePriceRule> = {}): BundlePriceRule => ({
	id: 'r1',
	name: null,
	enabled: true,
	when: { match: 'all', conditions: [{ fact: 'pieces.count', level: null, op: 'atLeast', value: 3 }] },
	then: [{ kind: 'percentOff', amount: 10, level: null, items: [] }],
	otherwise: [],
	...over,
});

describe('a bundle’s price rules (bundle builder brief C04–C06)', () => {
	it('reads a rule in plain words, with the method’s own numbers by name', () => {
		expect(ruleSentence(rule(), t)).toBe(
			'rule_if bundle_fact_pieces_count op_atLeast 3: bundle_action_percentOff 10%',
		);
		const named = rule({ then: [{ kind: 'amountOff', amount: { input: 'off' }, level: null, items: [] }] });
		const numbers = [
			{ code: 'off', label: { en: 'Rupees off' }, kind: 'money' as const, min: null, max: null, default: 500 },
		];
		expect(ruleSentence(named, t, numbers)).toBe(
			'rule_if bundle_fact_pieces_count op_atLeast 3: bundle_action_amountOff Rupees off',
		);
		expect(ruleSentence(rule({ when: { match: 'all', conditions: [] }, then: [] }), t)).toBe(
			'bundle_rule_always: bundle_rule_does_nothing',
		);
	});

	it('edits rules row by row and hands back the whole list', () => {
		TestBed.configureTestingModule({});
		TestBed.overrideComponent(BundleRuleRows, { set: { imports: [], template: '' } });
		const fixture = TestBed.createComponent(BundleRuleRows);
		const seen: BundlePriceRule[][] = [];
		fixture.componentInstance.rulesChange.subscribe((rules) => {
			seen.push(rules);
			fixture.componentRef.setInput('rules', rules);
		});
		fixture.componentRef.setInput('rules', [rule()]);
		fixture.componentRef.setInput('numbers', [
			{ code: 'pct', label: { en: '%' }, kind: 'percent', min: null, max: null, default: 5 },
		]);
		const rows = fixture.componentInstance;
		rows.addCondition(0);
		rows.setAmount(0, 0, 'pct');
		rows.addAction(0);
		rows.removeCondition(0, 0);
		rows.addRule();
		const last = seen.at(-1)!;
		expect(last).toHaveLength(2);
		expect(last[0]?.when.conditions).toHaveLength(1);
		expect(last[0]?.then.map((a) => a.amount)).toEqual([{ input: 'pct' }, 10]);
		expect(rows.parseValue('2, 4', 'pieces.count')).toEqual([2, 4]);
		expect(rows.operatorsFor('pieces.count')).toContain('atLeast');
	});
});
