import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import { IMeasurementField } from '@data-access/interfaces/product-detail.interface';

/**
 * Reusable tailoring measurement inputs (Shoulder/Chest/Waist/Sleeve…). Built
 * from `IMeasurementField[]` via Reactive Forms; emits the values and validity
 * so the parent can gate Add-to-Cart. Shared by the add-on group and bundle
 * configurator. Labels are Transloco keys; every field is in the SSR DOM.
 */
@Component({
	selector: 'app-measurements-form',
	templateUrl: './measurements-form.html',
	styleUrls: ['./measurements-form.scss'],
	imports: [ReactiveFormsModule, TranslocoModule],
})
export class MeasurementsForm {
	private fb = inject(FormBuilder);

	readonly fields = input<IMeasurementField[]>([]);
	readonly title = input<string>('measurements_required');
	/** Prefill values (field code -> value) when re-opening a saved line for editing. */
	readonly initialValues = input<Record<string, number>>();

	readonly valueChange = output<Record<string, number>>();
	readonly validChange = output<boolean>();

	readonly displayUnit = signal<'in' | 'cm'>('in');
	public form: FormGroup = this.fb.group({});

	constructor() {
		effect(() => {
			const fields = this.fields();
			const initial = this.initialValues();
			const group: Record<string, unknown> = {};
			for (const f of fields) {
				group[f.code] = [
					initial?.[f.code] ?? null,
					[Validators.required, Validators.min(f.min ?? 1), Validators.max(f.max ?? 200)],
				];
			}
			this.form = this.fb.group(group);
			this.form.statusChanges.subscribe(() => {
				this.validChange.emit(this.form.valid);
				this.valueChange.emit(this.form.value);
			});
			// emit initial state (valid when prefilled from a saved line)
			this.validChange.emit(this.form.valid);
			if (this.form.valid) this.valueChange.emit(this.form.value);
		});
	}

	/** What the shopper is typing, before it is kept in the field's unit. */
	readonly draft = signal<Record<string, string>>({});

	showUnit(unit: 'in' | 'cm') {
		this.draft.set({});
		this.displayUnit.set(unit);
	}

	onDraft(code: string, value: string) {
		this.draft.update((current) => ({ ...current, [code]: value }));
	}

	/**
	 * Convert the typed number into the field's unit, snap it to the field's step,
	 * and keep it only when it lands inside the field's range. The preview shows
	 * that snapped figure before this runs.
	 */
	keep(code: string, storedUnit: string, step = 0.5, min = 1, max = 200, event: Event) {
		const input = event.target as HTMLInputElement;
		const snapped = snapMeasurement(input.value, this.displayUnit(), storedUnit, step, min, max);
		const control = this.form.get(code);
		if (snapped === null) {
			control?.setValue(null);
			control?.setErrors({ range: true });
			control?.markAsTouched();
			return;
		}
		control?.setValue(snapped);
		control?.setErrors(null);
		this.draft.update((current) => {
			const next = { ...current };
			delete next[code];
			return next;
		});
		input.value = this.displayText(code, storedUnit);
	}

	displayText(code: string, storedUnit: string): string {
		const raw = this.form.get(code)?.value;
		if (raw === null || raw === undefined || raw === '') return '';
		return convertForDisplay(Number(raw), storedUnit, this.displayUnit());
	}

	preview(code: string, storedUnit: string, step = 0.5, min = 1, max = 200): string {
		const typed = this.draft()[code];
		if (typed === undefined || typed === '') return '';
		const snapped = snapMeasurement(typed, this.displayUnit(), storedUnit, step, min, max);
		if (snapped === null) return '';
		const unit = storedUnit === 'cm' ? 'cm' : 'in';
		return `${snapped} ${unit}`;
	}
}

function unitOf(value: string): 'in' | 'cm' {
	return value === 'cm' ? 'cm' : 'in';
}

function decimalPlaces(step: number): number {
	if (step >= 1) return 0;
	const text = step.toString();
	const dot = text.indexOf('.');
	return dot === -1 ? 0 : text.length - dot - 1;
}

function snapToStep(value: number, step: number): number {
	const snapped = Math.round(value / step) * step;
	return Number(snapped.toFixed(decimalPlaces(step)));
}

/** Snapped value in the field's unit, or null when it falls outside min/max. */
export function snapMeasurement(
	typed: string,
	displayUnit: string,
	storedUnit: string,
	step: number,
	min: number,
	max: number,
): number | null {
	const value = Number(typed);
	if (!(step > 0) || !Number.isFinite(value)) return null;
	const from = unitOf(displayUnit);
	const to = unitOf(storedUnit);
	const inFieldUnit = from === to ? value : from === 'in' ? value * 2.54 : value / 2.54;
	const snapped = snapToStep(inFieldUnit, step);
	if (snapped < min || snapped > max) return null;
	return snapped;
}

function convertForDisplay(stored: number, storedUnit: string, displayUnit: string): string {
	const from = unitOf(storedUnit);
	const to = unitOf(displayUnit);
	if (from === to) return String(stored);
	const converted = from === 'in' ? stored * 2.54 : stored / 2.54;
	return String(Number(converted.toFixed(2)));
}
