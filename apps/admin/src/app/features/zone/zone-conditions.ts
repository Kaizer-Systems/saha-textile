import { Component, computed, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ZONE_FIELDS, ZONE_FIELD_TYPES, ZONE_OPERATORS, newZoneCondition, newZoneGroup } from '@core/zones/zone-blocks';

import type {
	ZoneCondition,
	ZoneConditionGroup,
	ZoneConditionValue,
	ZoneField,
	ZoneOperator,
} from '@saha-textile/contracts';

/** A category as the condition's picker lists it. */
export interface ZoneCategoryOption {
	id: string;
	label: string;
}

/** The value a new field or operator starts with. */
export function startValue(field: ZoneField, op: ZoneOperator): ZoneConditionValue | null {
	const type = ZONE_FIELD_TYPES[field];
	if (op === 'isEmpty' || op === 'isNotEmpty') return null;
	if (type === 'yesNo') return true;
	if (type === 'product' || type === 'categories') return [];
	if (op === 'between') return [0, 0];
	return 0;
}

/**
 * The "Only when" of a zone rule (owner, 2026-11-20: conditions and variables): conditions on the
 * line's facts joined with AND or OR, groups inside groups, drawn with the shipping builder's
 * `srb-line` rows. Each fact offers the operators that suit it and a value box of its kind.
 */
@Component({
	selector: 'app-zone-conditions',
	template: `
		@let g = group();
		@for (item of g.items; track item.id; let i = $index) {
			@if (item.kind === 'group') {
				<div class="srb-branch">
					<app-zone-conditions
						[group]="item"
						[categories]="categories()"
						[readOnly]="readOnly()"
						(groupChange)="replace(i, $event)"
						(removed)="replace(i, null)"
					/>
				</div>
			} @else {
				<div class="srb-line">
					<span class="srb-kw">
						{{ (i === 0 ? 'zone_if' : g.join === 'all' ? 'zone_and' : 'zone_or') | transloco }}
					</span>
					<select
						class="form-select"
						[attr.aria-label]="'zone_fact' | transloco"
						[disabled]="readOnly()"
						(change)="setField(i, $any($event.target).value)"
					>
						@for (field of fields; track field) {
							<option
								[value]="field"
								[selected]="field === item.field"
							>
								{{ 'zone_field_' + field.replace('.', '_') | transloco }}
							</option>
						}
					</select>
					<select
						class="form-select"
						[attr.aria-label]="'zone_operator' | transloco"
						[disabled]="readOnly()"
						(change)="setOp(i, $any($event.target).value)"
					>
						@for (op of operators(item.field); track op) {
							<option
								[value]="op"
								[selected]="op === item.op"
							>
								{{ 'zone_op_' + op | transloco }}
							</option>
						}
					</select>
					@switch (box(item)) {
						@case ('yesNo') {
							<select
								class="form-select"
								[attr.aria-label]="'zone_value' | transloco"
								[disabled]="readOnly()"
								(change)="setValue(i, $any($event.target).value === 'yes')"
							>
								<option
									value="yes"
									[selected]="item.value !== false"
								>
									{{ 'zone_yes' | transloco }}
								</option>
								<option
									value="no"
									[selected]="item.value === false"
								>
									{{ 'zone_no' | transloco }}
								</option>
							</select>
						}
						@case ('single') {
							<input
								class="form-control srb-amt"
								inputmode="decimal"
								[attr.aria-label]="'zone_value' | transloco"
								[disabled]="readOnly()"
								[value]="item.value ?? 0"
								(change)="setValue(i, num($any($event.target).value))"
							/>
						}
						@case ('range') {
							<input
								class="form-control srb-amt"
								inputmode="decimal"
								[attr.aria-label]="'zone_from' | transloco"
								[disabled]="readOnly()"
								[value]="$any(item.value)?.[0] ?? 0"
								(change)="setValue(i, [num($any($event.target).value), $any(item.value)?.[1] ?? 0])"
							/>
							<span>{{ 'zone_and' | transloco }}</span>
							<input
								class="form-control srb-amt"
								inputmode="decimal"
								[attr.aria-label]="'zone_to' | transloco"
								[disabled]="readOnly()"
								[value]="$any(item.value)?.[1] ?? 0"
								(change)="setValue(i, [$any(item.value)?.[0] ?? 0, num($any($event.target).value)])"
							/>
						}
						@case ('categories') {
							<select
								class="form-select"
								multiple
								size="3"
								[attr.aria-label]="'zone_categories' | transloco"
								[disabled]="readOnly()"
								(change)="setValue(i, selected($any($event.target)))"
							>
								@for (category of categories(); track category.id) {
									<option
										[value]="category.id"
										[selected]="$any(item.value)?.includes(category.id)"
									>
										{{ category.label }}
									</option>
								}
							</select>
						}
						@case ('products') {
							<input
								class="form-control"
								[attr.aria-label]="'zone_product_ids' | transloco"
								[placeholder]="'zone_product_ids' | transloco"
								[disabled]="readOnly()"
								[value]="$any(item.value)?.join(', ') ?? ''"
								(change)="setValue(i, splitIds($any($event.target).value))"
							/>
						}
					}
					@if (!readOnly()) {
						<button
							type="button"
							class="btn btn-link text-danger p-0"
							[title]="'zone_remove_condition' | transloco"
							[attr.aria-label]="'zone_remove_condition' | transloco"
							(click)="replace(i, null)"
						>
							<i class="ri-close-circle-line"></i>
						</button>
					}
				</div>
			}
		}
		@if (!readOnly()) {
			<div class="srb-line">
				<button
					type="button"
					class="btn btn-link srb-add p-0"
					(click)="add(false)"
				>
					<i class="ri-add-line"></i>
					{{ 'zone_add_condition' | transloco }}
				</button>
				<button
					type="button"
					class="btn btn-link srb-add p-0"
					(click)="add(true)"
				>
					<i class="ri-add-box-line"></i>
					{{ 'zone_add_group' | transloco }}
				</button>
				@if (g.items.length > 1) {
					<select
						class="form-select"
						[attr.aria-label]="'zone_join' | transloco"
						(change)="setJoin($any($event.target).value)"
					>
						<option
							value="all"
							[selected]="g.join === 'all'"
						>
							{{ 'zone_join_all' | transloco }}
						</option>
						<option
							value="any"
							[selected]="g.join === 'any'"
						>
							{{ 'zone_join_any' | transloco }}
						</option>
					</select>
				}
			</div>
		}
	`,
	imports: [TranslocoModule],
})
export class ZoneConditions {
	readonly group = input.required<ZoneConditionGroup>();
	readonly categories = input<readonly ZoneCategoryOption[]>([]);
	readonly readOnly = input(false);
	readonly groupChange = output<ZoneConditionGroup>();
	readonly removed = output<void>();

	// Products have their own tier and picker, so a condition never asks for product ids.
	readonly fields = ZONE_FIELDS.filter((field) => field !== 'line.productId');
	readonly count = computed(() => this.group().items.length);

	num(value: string): number {
		const parsed = Number(String(value).replace(/[₹,\s]/g, ''));
		return Number.isFinite(parsed) ? parsed : 0;
	}

	splitIds(text: string): string[] {
		return text
			.split(/[,\s]+/)
			.map((row) => row.trim())
			.filter(Boolean);
	}

	selected(select: HTMLSelectElement): string[] {
		return Array.from(select.selectedOptions).map((option) => option.value);
	}

	operators(field: ZoneField): readonly ZoneOperator[] {
		return ZONE_OPERATORS[ZONE_FIELD_TYPES[field]];
	}

	/** Which value box a condition shows. */
	box(condition: ZoneCondition): 'none' | 'yesNo' | 'single' | 'range' | 'categories' | 'products' {
		const type = ZONE_FIELD_TYPES[condition.field];
		if (condition.op === 'isEmpty' || condition.op === 'isNotEmpty') return 'none';
		if (type === 'yesNo') return 'yesNo';
		if (type === 'categories') return 'categories';
		if (type === 'product') return 'products';
		return condition.op === 'between' ? 'range' : 'single';
	}

	private emitItems(items: ZoneConditionGroup['items']): void {
		if (!items.length) {
			this.removed.emit();
			return;
		}
		this.groupChange.emit({ ...this.group(), items });
	}

	private patch(index: number, change: Partial<ZoneCondition>): void {
		this.emitItems(
			this.group().items.map((item, at) =>
				at === index && item.kind === 'condition' ? ({ ...item, ...change } as ZoneCondition) : item,
			),
		);
	}

	setField(index: number, field: ZoneField): void {
		const op = this.operators(field)[0] as ZoneOperator;
		this.patch(index, { field, op, value: startValue(field, op) });
	}

	setOp(index: number, op: ZoneOperator): void {
		const item = this.group().items[index];
		if (item?.kind !== 'condition') return;
		this.patch(index, { op, value: startValue(item.field, op) });
	}

	setValue(index: number, value: ZoneConditionValue): void {
		this.patch(index, { value });
	}

	setJoin(join: 'all' | 'any'): void {
		this.groupChange.emit({ ...this.group(), join });
	}

	add(asGroup: boolean): void {
		this.emitItems([...this.group().items, asGroup ? newZoneGroup() : newZoneCondition()]);
	}

	replace(index: number, item: ZoneCondition | ZoneConditionGroup | null): void {
		const items = [...this.group().items];
		if (item) items[index] = item;
		else items.splice(index, 1);
		this.emitItems(items);
	}
}
