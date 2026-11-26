import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ZONE_BASES, ZONE_FORMULA_KINDS, newZoneFormula } from '@core/zones/zone-blocks';

import type { ZoneBase, ZonePriceFormula } from '@saha-textile/contracts';

const num = (value: string): number => {
	const parsed = Number(String(value).replace(/[₹,\s]/g, ''));
	return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * How a zone rule prices a piece (owner, 2026-11-20): % or ₹ less than a base, a flat price, % above
 * purchase cost, a price per metre, quantity or order-value breaks, the lower or higher of two to
 * four formulas, or no price. Breaks and lower/higher hold formulas of their own, so the editor
 * draws itself inside them. Drawn with the shipping builder's `srb-line` rows.
 */
@Component({
	selector: 'app-zone-formula',
	template: `
		@let f = formula();
		<div class="srb-line">
			@if (depth() > 0) {
				<span class="srb-kw">{{ 'zone_then' | transloco }}</span>
			}
			<select
				class="form-select"
				[attr.aria-label]="'zone_price_kind' | transloco"
				[disabled]="readOnly()"
				(change)="setKind($any($event.target).value)"
			>
				@for (kind of kinds; track kind) {
					@if (depth() < 2 || !nested(kind)) {
						<option
							[value]="kind"
							[selected]="kind === f.kind"
						>
							{{ 'zone_kind_' + kind | transloco }}
						</option>
					}
				}
			</select>
			@switch (f.kind) {
				@case ('percentOffBase') {
					<div class="input-group">
						<input
							class="form-control srb-amt"
							inputmode="decimal"
							[attr.aria-label]="'zone_percent' | transloco"
							[disabled]="readOnly()"
							[value]="f.percent"
							(change)="patch({ percent: num($any($event.target).value) })"
						/>
						<span class="input-group-text">%</span>
					</div>
					<span>{{ 'zone_less_than' | transloco }}</span>
					<ng-container *ngTemplateOutlet="base; context: { $implicit: f.base }" />
				}
				@case ('amountOffBase') {
					<div class="input-group">
						<span class="input-group-text">₹</span>
						<input
							class="form-control srb-amt"
							inputmode="decimal"
							[attr.aria-label]="'zone_amount' | transloco"
							[disabled]="readOnly()"
							[value]="f.amountINR"
							(change)="patch({ amountINR: num($any($event.target).value) })"
						/>
					</div>
					<span>{{ 'zone_less_than' | transloco }}</span>
					<ng-container *ngTemplateOutlet="base; context: { $implicit: f.base }" />
				}
				@case ('flatPrice') {
					<div class="input-group">
						<span class="input-group-text">₹</span>
						<input
							class="form-control srb-amt"
							inputmode="decimal"
							[attr.aria-label]="'zone_amount' | transloco"
							[disabled]="readOnly()"
							[value]="f.amountINR"
							(change)="patch({ amountINR: num($any($event.target).value) })"
						/>
					</div>
				}
				@case ('percentAboveCost') {
					<div class="input-group">
						<input
							class="form-control srb-amt"
							inputmode="decimal"
							[attr.aria-label]="'zone_percent' | transloco"
							[disabled]="readOnly()"
							[value]="f.percent"
							(change)="patch({ percent: num($any($event.target).value) })"
						/>
						<span class="input-group-text">%</span>
					</div>
					<span>{{ 'zone_above_cost' | transloco }}</span>
				}
				@case ('pricePerMetre') {
					<div class="input-group">
						<span class="input-group-text">₹</span>
						<input
							class="form-control srb-amt"
							inputmode="decimal"
							[attr.aria-label]="'zone_amount' | transloco"
							[disabled]="readOnly()"
							[value]="f.amountINR"
							(change)="patch({ amountINR: num($any($event.target).value) })"
						/>
					</div>
					<span>{{ 'zone_per_metre' | transloco }}</span>
				}
			}
		</div>
		@if (f.kind === 'quantityBreaks' || f.kind === 'orderValueBreaks') {
			<div class="srb-branch">
				@for (step of $any(f).breaks; track $index; let i = $index) {
					<div class="srb-line">
						<span class="srb-kw">{{ 'zone_from' | transloco }}</span>
						@if (f.kind === 'quantityBreaks') {
							<input
								class="form-control srb-amt"
								inputmode="numeric"
								[attr.aria-label]="'zone_min_quantity' | transloco"
								[disabled]="readOnly()"
								[value]="step.minQuantity"
								(change)="setBreak(i, { minQuantity: num($any($event.target).value) })"
							/>
							<span>{{ 'zone_pieces' | transloco }}</span>
						} @else {
							<div class="input-group">
								<span class="input-group-text">₹</span>
								<input
									class="form-control srb-amt"
									inputmode="decimal"
									[attr.aria-label]="'zone_min_order' | transloco"
									[disabled]="readOnly()"
									[value]="step.minGoodsINR"
									(change)="setBreak(i, { minGoodsINR: num($any($event.target).value) })"
								/>
							</div>
							<span>{{ 'zone_order_value' | transloco }}</span>
						}
						@if (!readOnly() && $any(f).breaks.length > 1) {
							<button
								type="button"
								class="btn btn-link text-danger p-0"
								[title]="'zone_remove_step' | transloco"
								[attr.aria-label]="'zone_remove_step' | transloco"
								(click)="removeBreak(i)"
							>
								<i class="ri-close-circle-line"></i>
							</button>
						}
					</div>
					<app-zone-formula
						[formula]="step.formula"
						[depth]="depth() + 1"
						[readOnly]="readOnly()"
						(formulaChange)="setBreak(i, { formula: $event })"
					/>
				}
				@if (!readOnly()) {
					<button
						type="button"
						class="btn btn-link srb-add p-0"
						(click)="addBreak()"
					>
						<i class="ri-add-line"></i>
						{{ 'zone_add_step' | transloco }}
					</button>
				}
			</div>
		}
		@if (f.kind === 'lowerOf' || f.kind === 'higherOf') {
			<div class="srb-branch">
				@for (part of $any(f).formulas; track $index; let i = $index) {
					<div class="d-flex align-items-start gap-2">
						<div class="flex-grow-1">
							<app-zone-formula
								[formula]="part"
								[depth]="depth() + 1"
								[readOnly]="readOnly()"
								(formulaChange)="setPart(i, $event)"
							/>
						</div>
						@if (!readOnly() && $any(f).formulas.length > 2) {
							<button
								type="button"
								class="btn btn-link text-danger mt-2 p-0"
								[title]="'zone_remove_formula' | transloco"
								[attr.aria-label]="'zone_remove_formula' | transloco"
								(click)="removePart(i)"
							>
								<i class="ri-close-circle-line"></i>
							</button>
						}
					</div>
				}
				@if (!readOnly() && $any(f).formulas.length < 4) {
					<button
						type="button"
						class="btn btn-link srb-add p-0"
						(click)="addPart()"
					>
						<i class="ri-add-line"></i>
						{{ 'zone_add_formula' | transloco }}
					</button>
				}
			</div>
		}

		<ng-template
			#base
			let-current
		>
			<select
				class="form-select"
				[attr.aria-label]="'zone_base' | transloco"
				[disabled]="readOnly()"
				(change)="patch({ base: $any($event.target).value })"
			>
				@for (item of bases; track item) {
					<option
						[value]="item"
						[selected]="item === current"
					>
						{{ 'zone_base_' + item | transloco }}
					</option>
				}
			</select>
		</ng-template>
	`,
	imports: [TranslocoModule, NgTemplateOutlet],
})
export class ZoneFormula {
	readonly formula = input.required<ZonePriceFormula>();
	readonly depth = input(0);
	readonly readOnly = input(false);
	readonly formulaChange = output<ZonePriceFormula>();

	readonly kinds = ZONE_FORMULA_KINDS;
	readonly bases: readonly ZoneBase[] = ZONE_BASES;
	readonly num = num;

	/** Breaks and lower/higher hold formulas; two levels deep is plenty. */
	nested(kind: ZonePriceFormula['kind']): boolean {
		return kind === 'quantityBreaks' || kind === 'orderValueBreaks' || kind === 'lowerOf' || kind === 'higherOf';
	}

	setKind(kind: ZonePriceFormula['kind']): void {
		if (kind !== this.formula().kind) this.formulaChange.emit(newZoneFormula(kind));
	}

	patch(change: Record<string, unknown>): void {
		this.formulaChange.emit({ ...this.formula(), ...change } as ZonePriceFormula);
	}

	setBreak(index: number, change: Record<string, unknown>): void {
		const f = this.formula() as Extract<ZonePriceFormula, { kind: 'quantityBreaks' | 'orderValueBreaks' }>;
		const breaks = (f.breaks as Array<Record<string, unknown>>).map((step, at) =>
			at === index ? { ...step, ...change } : step,
		);
		this.formulaChange.emit({ ...f, breaks } as ZonePriceFormula);
	}

	addBreak(): void {
		const f = this.formula() as Extract<ZonePriceFormula, { kind: 'quantityBreaks' | 'orderValueBreaks' }>;
		const last = f.breaks[f.breaks.length - 1] as { minQuantity?: number; minGoodsINR?: number } | undefined;
		const step =
			f.kind === 'quantityBreaks'
				? { minQuantity: (last?.minQuantity ?? 0) + 10, formula: newZoneFormula('percentOffBase') }
				: { minGoodsINR: (last?.minGoodsINR ?? 0) + 50_000, formula: newZoneFormula('percentOffBase') };
		this.formulaChange.emit({ ...f, breaks: [...f.breaks, step] } as ZonePriceFormula);
	}

	removeBreak(index: number): void {
		const f = this.formula() as Extract<ZonePriceFormula, { kind: 'quantityBreaks' | 'orderValueBreaks' }>;
		this.formulaChange.emit({ ...f, breaks: f.breaks.filter((_, at) => at !== index) } as ZonePriceFormula);
	}

	setPart(index: number, part: ZonePriceFormula): void {
		const f = this.formula() as Extract<ZonePriceFormula, { kind: 'lowerOf' | 'higherOf' }>;
		this.formulaChange.emit({ ...f, formulas: f.formulas.map((row, at) => (at === index ? part : row)) });
	}

	addPart(): void {
		const f = this.formula() as Extract<ZonePriceFormula, { kind: 'lowerOf' | 'higherOf' }>;
		this.formulaChange.emit({ ...f, formulas: [...f.formulas, newZoneFormula('flatPrice')] });
	}

	removePart(index: number): void {
		const f = this.formula() as Extract<ZonePriceFormula, { kind: 'lowerOf' | 'higherOf' }>;
		this.formulaChange.emit({ ...f, formulas: f.formulas.filter((_, at) => at !== index) });
	}
}
