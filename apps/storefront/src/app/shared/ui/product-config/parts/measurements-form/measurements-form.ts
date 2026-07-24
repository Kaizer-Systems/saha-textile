import { Component, effect, inject, input, output } from '@angular/core';
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
}
