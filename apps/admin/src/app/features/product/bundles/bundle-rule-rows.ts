import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { BUNDLE_FACT_TYPES, BUNDLE_OPERATORS_BY_TYPE } from '@saha-textile/core-domain/bundle';

import type {
	BundleMethodInput,
	BundlePriceRule,
	BundleRuleAction,
	BundleRuleCondition,
} from '@saha-textile/contracts';

/** Every Then a rule can do (brief C06). */
export const BUNDLE_ACTIONS: BundleRuleAction['kind'][] = [
	'priceIs',
	'priceIsPieces',
	'percentOff',
	'amountOff',
	'makeExtraFree',
	'makePickFree',
	'requireExtra',
	'limitLevel',
	'hideItem',
];

/**
 * A list of If / Then price rules (bundle builder brief C05–C06, approved 2026-11-22), shared by the price method
 * builder and a bundle's own Price rules tab: conditions on the picks, prices, extras and dates; actions on the set
 * price, picks and extras. An amount is a number typed here or one of the method's numbers, by its code.
 */
@Component({
	selector: 'app-bundle-rule-rows',
	templateUrl: './bundle-rule-rows.html',
	imports: [FormsModule, TranslocoModule],
})
export class BundleRuleRows {
	readonly rules = input.required<BundlePriceRule[]>();
	/** The method's numbers a rule may use as its amount ("the % typed on each bundle"). */
	readonly numbers = input<BundleMethodInput[]>([]);
	readonly lang = input<'en' | 'bn'>('en');
	/** Keeps the datalist id unique when two lists share a page. */
	readonly listId = input('rule-numbers');
	readonly rulesChange = output<BundlePriceRule[]>();

	readonly facts = Object.keys(BUNDLE_FACT_TYPES) as (keyof typeof BUNDLE_FACT_TYPES)[];
	readonly actions = BUNDLE_ACTIONS;

	private emit(rules: BundlePriceRule[]): void {
		this.rulesChange.emit(rules);
	}

	operatorsFor(fact: string | null): string[] {
		return fact ? [...BUNDLE_OPERATORS_BY_TYPE[BUNDLE_FACT_TYPES[fact as keyof typeof BUNDLE_FACT_TYPES]]] : [];
	}

	addRule(): void {
		const rule: BundlePriceRule = {
			id: `r${Date.now().toString(36)}`,
			name: null,
			enabled: true,
			when: { match: 'all', conditions: [] },
			then: [],
			otherwise: [],
		};
		this.emit([...this.rules(), rule]);
	}

	setRule(at: number, patch: Partial<BundlePriceRule>): void {
		this.emit(this.rules().map((row, i) => (i === at ? { ...row, ...patch } : row)));
	}

	removeRule(at: number): void {
		this.emit(this.rules().filter((_, i) => i !== at));
	}

	addCondition(at: number): void {
		const rule = this.rules()[at];
		if (!rule) return;
		const condition: BundleRuleCondition = { fact: 'pieces.count', level: null, op: 'atLeast', value: 2 };
		this.setRule(at, { when: { ...rule.when, conditions: [...rule.when.conditions, condition] } });
	}

	setCondition(at: number, c: number, patch: Partial<BundleRuleCondition>): void {
		const rule = this.rules()[at];
		if (!rule) return;
		const conditions = rule.when.conditions.map((row, i) => (i === c ? { ...row, ...patch } : row));
		this.setRule(at, { when: { ...rule.when, conditions } });
	}

	removeCondition(at: number, c: number): void {
		const rule = this.rules()[at];
		if (rule)
			this.setRule(at, { when: { ...rule.when, conditions: rule.when.conditions.filter((_, i) => i !== c) } });
	}

	addAction(at: number): void {
		const rule = this.rules()[at];
		if (rule)
			this.setRule(at, { then: [...rule.then, { kind: 'percentOff', amount: 10, level: null, items: [] }] });
	}

	setAction(at: number, a: number, patch: Partial<BundleRuleAction>): void {
		const rule = this.rules()[at];
		if (rule) this.setRule(at, { then: rule.then.map((row, i) => (i === a ? { ...row, ...patch } : row)) });
	}

	removeAction(at: number, a: number): void {
		const rule = this.rules()[at];
		if (rule) this.setRule(at, { then: rule.then.filter((_, i) => i !== a) });
	}

	/** A number typed in the rule, or one of the method's numbers by its code. */
	setAmount(at: number, a: number, value: string): void {
		const named = this.numbers().find((row) => row.code === value);
		this.setAction(at, a, { amount: named ? { input: named.code } : value === '' ? null : Number(value) });
	}

	amountText(action: BundleRuleAction): string {
		const amount = action.amount;
		return amount === null ? '' : typeof amount === 'number' ? String(amount) : amount.input;
	}

	conditionValue(condition: BundleRuleCondition): string {
		return Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '');
	}

	parseValue(text: string, fact: string | null): BundleRuleCondition['value'] {
		const type = fact ? BUNDLE_FACT_TYPES[fact as keyof typeof BUNDLE_FACT_TYPES] : 'number';
		if (type === 'keys')
			return text
				.split(',')
				.map((word) => word.trim())
				.filter(Boolean);
		if (type === 'boolean') return text === 'true';
		if (type === 'date') return text.includes(',') ? text.split(',').map((word) => word.trim()) : text.trim();
		const parts = text.split(',').map((word) => Number(word.trim()));
		return parts.length === 2 ? [parts[0] ?? 0, parts[1] ?? 0] : Number(text);
	}
}
