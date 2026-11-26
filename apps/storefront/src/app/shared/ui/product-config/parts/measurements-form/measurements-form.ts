import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import { IMeasurementField } from '@data-access/interfaces/product-detail.interface';

type Unit = 'in' | 'cm';

/** What the shopper typed in one box, in the unit the box showed while they typed. */
interface Entry {
	text: string;
	unit: Unit;
}

/** The allowed range of one field, written in the unit the shopper is looking at. */
export interface MeasurementLimits {
	min: string;
	max: string;
	unit: Unit;
}

const CM_PER_INCH = 2.54;

/**
 * Reusable tailoring measurement inputs (Shoulder/Chest/Waist/Sleeve…). Built
 * from `IMeasurementField[]` via Reactive Forms; emits the values and validity
 * so the parent can gate Add-to-Cart. Shared by the add-on group and bundle
 * configurator. Labels are Transloco keys; every field is in the SSR DOM.
 *
 * A box always shows what the shopper typed while its unit is showing. The kept
 * value is that number in the field's own unit, snapped to the field's step
 * (owner log: "The value snaps to the field step"). Switching units shows the
 * kept value converted, and switching back shows the shopper's own number again,
 * so no figure drifts by being converted twice. A number outside the field's
 * range stays in the box with a note naming the range; it is never wiped.
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
	/** The chosen add-on the form is for ("Measurements for Boat Neck Blouse"); empty keeps `title`. */
	readonly forName = input<string>('');
	/** Prefill values (field code -> value) when re-opening a saved line for editing. */
	readonly initialValues = input<Record<string, number>>();

	readonly valueChange = output<Record<string, number>>();
	readonly validChange = output<boolean>();

	readonly displayUnit = signal<Unit>('in');
	public form: FormGroup = this.fb.group({});

	/** Each box's own text, by field code. */
	readonly entries = signal<Record<string, Entry>>({});
	/** Boxes the shopper has left, so a range note waits until they stop typing. */
	readonly left = signal<Record<string, true>>({});

	/** The fields and prefill the form was last built from; a repeat of the same keeps what was typed. */
	private builtFrom = '';

	constructor() {
		effect(() => {
			const fields = this.fields();
			const initial = this.initialValues();
			const builtFrom = JSON.stringify([
				fields.map((f) => [f.code, f.unit, f.step, f.min, f.max]),
				initial ?? null,
			]);
			if (builtFrom === this.builtFrom) return;
			this.builtFrom = builtFrom;

			const group: Record<string, unknown> = {};
			for (const f of fields) {
				group[f.code] = [
					initial?.[f.code] ?? null,
					[Validators.required, Validators.min(f.min ?? 1), Validators.max(f.max ?? 200)],
				];
			}
			this.form = this.fb.group(group);
			this.entries.set({});
			this.left.set({});
			this.form.statusChanges.subscribe(() => {
				this.validChange.emit(this.form.valid);
				this.valueChange.emit(this.form.value);
			});
			// emit initial state (valid when prefilled from a saved line)
			this.validChange.emit(this.form.valid);
			if (this.form.valid) this.valueChange.emit(this.form.value);
		});
	}

	showUnit(unit: Unit) {
		this.displayUnit.set(unit);
	}

	/** Keeps the shopper's text as typed, and the field's value as that number snapped in the field's unit. */
	onInput(field: IMeasurementField, text: string) {
		const unit = this.displayUnit();
		this.entries.update((current) => ({ ...current, [field.code]: { text, unit } }));
		const control = this.form.get(field.code);
		if (!control) return;
		if (text.trim() === '') {
			control.setValue(null);
			return;
		}
		const kept = snapMeasurement(text, unit, field.unit, field.step ?? 0.5, field.min ?? 1, field.max ?? 200);
		control.setValue(kept);
		if (kept === null) control.setErrors({ range: true });
	}

	onLeave(code: string) {
		this.left.update((current) => ({ ...current, [code]: true }));
		this.form.get(code)?.markAsTouched();
	}

	/** The text the box shows in the unit now chosen. */
	boxText(field: IMeasurementField): string {
		const unit = this.displayUnit();
		const entry = this.entries()[field.code];
		if (entry?.unit === unit) return entry.text;
		const kept = this.form.get(field.code)?.value;
		if (kept !== null && kept !== undefined && kept !== '') {
			return unitOf(field.unit) === unit
				? String(kept)
				: oneDecimal(convert(Number(kept), unitOf(field.unit), unit));
		}
		// Nothing kept: an out-of-range number still shows, converted, beside its range note.
		if (entry && entry.text.trim() !== '' && Number.isFinite(Number(entry.text))) {
			return oneDecimal(convert(Number(entry.text), entry.unit, unit));
		}
		return '';
	}

	/** The field's range in the unit now chosen, once the shopper has left a box holding a number outside it. */
	outOfRange(field: IMeasurementField): MeasurementLimits | null {
		const entry = this.entries()[field.code];
		if (!this.left()[field.code] || !entry || entry.text.trim() === '') return null;
		if (!this.form.get(field.code)?.hasError('range')) return null;
		const unit = this.displayUnit();
		const from = unitOf(field.unit);
		return {
			min: oneDecimal(convert(field.min ?? 1, from, unit)),
			max: oneDecimal(convert(field.max ?? 200, from, unit)),
			unit,
		};
	}

	/** The kept figure in the field's own unit, shown under a box whose number was typed in the other unit. */
	keptNote(field: IMeasurementField): string {
		const entry = this.entries()[field.code];
		const unit = unitOf(field.unit);
		if (!entry || entry.unit === unit || entry.unit !== this.displayUnit()) return '';
		const kept = this.form.get(field.code)?.value;
		if (kept === null || kept === undefined || kept === '') return '';
		return `${kept} ${unit}`;
	}
}

function unitOf(value: string): Unit {
	return value === 'cm' ? 'cm' : 'in';
}

function convert(value: number, from: Unit, to: Unit): number {
	if (from === to) return value;
	return from === 'in' ? value * CM_PER_INCH : value / CM_PER_INCH;
}

/** One decimal at most, with no trailing zero: 91.44 -> "91.4", 60.96 -> "61". */
function oneDecimal(value: number): string {
	return String(Number(value.toFixed(1)));
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
	const snapped = snapToStep(convert(value, unitOf(displayUnit), unitOf(storedUnit)), step);
	if (snapped < min || snapped > max) return null;
	return snapped;
}
