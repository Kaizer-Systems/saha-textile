import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { SHIPPING_FIELD_TYPES, SHIPPING_OPERATORS_BY_TYPE, valueShape } from '@saha-textile/core-domain/shipping';

import { FIELD_GROUPS, fieldKey, newCondition, newGroup, operatorKey } from '@core/shipping/blocks';

import type {
	ShippingCondition,
	ShippingConditionField,
	ShippingConditionGroup,
	ShippingConditionValue,
	ShippingOperator,
} from '@saha-textile/contracts';

/** A category as the condition's picker lists it. */
export interface SrbCategoryOption {
	id: string;
	label: string;
}

/**
 * The conditions of an "If" block (brief rb04, rb06): conditions joined with AND or OR, groups
 * inside groups. Each condition picks a fact, an operator that suits it, and a value of the right
 * kind; a condition the checks flagged is outlined.
 */
@Component({
	selector: 'app-srb-group',
	templateUrl: './srb-group.html',
	imports: [FormsModule, NgbDropdownModule, TranslocoModule],
})
export class SrbGroup {
	readonly group = input.required<ShippingConditionGroup>();
	readonly readOnly = input(false);
	/** Whether line facts are allowed (inside a line or unit loop). */
	readonly lineFacts = input(true);
	readonly errorIds = input<ReadonlySet<string>>(new Set());
	readonly categories = input<readonly SrbCategoryOption[]>([]);
	/** True for the top group of an "If" (its first condition says IF; nested groups say Group). */
	readonly top = input(true);
	/** The add-condition and and/or controls; the top group of an "If" shows them at the block's bottom. */
	readonly controls = input(true);
	readonly groupChange = output<ShippingConditionGroup>();
	readonly removed = output<void>();

	readonly fieldGroups = FIELD_GROUPS;
	readonly fieldKey = fieldKey;
	readonly operatorKey = operatorKey;
	readonly joinLabel = computed(() => (this.group().join === 'all' ? 'ship_and' : 'ship_or'));

	/** "line", "cart", "delivery" or "shopper": the closed picker reads "Line › Is discounted" (brief rb04). */
	groupOf(field: ShippingConditionField): string {
		// Every field is "<group>.<name>", so the first part is always there.
		return field.split('.', 1)[0] as string;
	}

	operators(field: ShippingConditionField | null): readonly ShippingOperator[] {
		return field ? SHIPPING_OPERATORS_BY_TYPE[SHIPPING_FIELD_TYPES[field]] : [];
	}

	/** What the value box shows: yes/no, a number, a range, a text, a list, a category list. */
	shape(condition: ShippingCondition): string | null {
		if (!condition.field || !condition.op) return null;
		const type = SHIPPING_FIELD_TYPES[condition.field];
		const base = valueShape(type, condition.op);
		if (base === null) return null;
		if (condition.field === 'line.category' || condition.field === 'line.mainCategory')
			return base === 'list' ? 'categories' : 'category';
		if (condition.field === 'delivery.zone') return 'zone';
		if (condition.field === 'line.soldBy') return base === 'list' ? 'list' : 'soldBy';
		return base;
	}

	setJoin(join: 'all' | 'any') {
		this.groupChange.emit({ ...this.group(), join });
	}

	replace(index: number, item: ShippingCondition | ShippingConditionGroup | null) {
		const items = [...this.group().items];
		if (item === null) items.splice(index, 1);
		else items[index] = item;
		this.groupChange.emit({ ...this.group(), items });
	}

	addCondition() {
		this.groupChange.emit({ ...this.group(), items: [...this.group().items, newCondition()] });
	}

	addGroup() {
		const join = this.group().join === 'all' ? 'any' : 'all';
		this.groupChange.emit({ ...this.group(), items: [...this.group().items, newGroup(join)] });
	}

	setField(index: number, condition: ShippingCondition, field: ShippingConditionField) {
		// Every field type has operators; the first is where a new condition starts.
		const op = this.operators(field)[0] as ShippingOperator;
		const type = SHIPPING_FIELD_TYPES[field];
		this.replace(index, { ...condition, field, op, value: type === 'boolean' ? true : null });
	}

	setOperator(index: number, condition: ShippingCondition, op: ShippingOperator) {
		const keep =
			condition.op &&
			condition.field &&
			valueShape(SHIPPING_FIELD_TYPES[condition.field], condition.op) ===
				valueShape(SHIPPING_FIELD_TYPES[condition.field], op);
		this.replace(index, { ...condition, op, value: keep ? condition.value : null });
	}

	setValue(index: number, condition: ShippingCondition, value: ShippingConditionValue | null) {
		this.replace(index, { ...condition, value });
	}

	/** Comma-separated words as a list, blanks dropped. */
	listOf(text: string): string[] | null {
		const list = text
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);
		return list.length ? list : null;
	}

	listText(value: ShippingConditionValue | null): string {
		return Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
	}

	numberOf(text: unknown): number | null {
		const n = Number(text);
		return text === '' || text === null || !Number.isFinite(n) ? null : n;
	}

	rangeOf(value: ShippingConditionValue | null): [number | null, number | null] {
		return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number')
			? [value[0] as number, value[1] as number]
			: [null, null];
	}

	setRange(index: number, condition: ShippingCondition, side: 0 | 1, text: unknown) {
		const range = this.rangeOf(condition.value);
		range[side] = this.numberOf(text);
		this.setValue(index, condition, range[0] !== null && range[1] !== null ? [range[0], range[1]] : null);
	}

	selectedList(value: ShippingConditionValue | null): string[] {
		return Array.isArray(value) ? (value as string[]) : [];
	}

	pickCategories(index: number, condition: ShippingCondition, select: HTMLSelectElement) {
		const chosen = Array.from(select.selectedOptions).map((option) => option.value);
		this.setValue(index, condition, chosen.length ? chosen : null);
	}

	asCondition(item: ShippingCondition | ShippingConditionGroup): ShippingCondition {
		return item as ShippingCondition;
	}

	asGroup(item: ShippingCondition | ShippingConditionGroup): ShippingConditionGroup {
		return item as ShippingConditionGroup;
	}
}
