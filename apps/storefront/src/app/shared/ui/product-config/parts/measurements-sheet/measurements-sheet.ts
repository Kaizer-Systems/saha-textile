import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { IMeasurementField } from '@data-access/interfaces/product-detail.interface';

import { MeasurementsForm } from '../measurements-form/measurements-form';

export interface MeasurementsSheetStart {
	/** The pop-up's heading: the form's name ("Suit measurements"). */
	heading: string;
	fields: IMeasurementField[];
	/** The chosen add-on the form measures for, named in the form's title. */
	forName: string;
	values: Record<string, number>;
	/** Shows the "use the size guide on this page" hint. */
	sizeGuide: boolean;
}

/**
 * The measurement pop-up (brief P7, render 3): the very form made in Admin › Add-on templates, unchanged, inside the
 * shop's theme pop-up, which phones show as a sheet from the bottom (`.st-sheet`). Save hands the values back; closing
 * keeps what the page had.
 */
@Component({
	selector: 'app-measurements-sheet',
	templateUrl: './measurements-sheet.html',
	imports: [MeasurementsForm, TranslocoModule],
})
export class MeasurementsSheet {
	readonly modal = inject(NgbActiveModal);

	readonly heading = signal('');
	readonly fields = signal<IMeasurementField[]>([]);
	readonly forName = signal('');
	readonly initial = signal<Record<string, number>>({});
	readonly sizeGuide = signal(false);

	private values: Record<string, number> = {};
	readonly valid = signal(false);

	start(config: MeasurementsSheetStart): void {
		this.heading.set(config.heading);
		this.fields.set(config.fields);
		this.forName.set(config.forName);
		this.initial.set({ ...config.values });
		this.values = { ...config.values };
		this.sizeGuide.set(config.sizeGuide);
	}

	onValue(values: Record<string, number>): void {
		this.values = values;
	}

	onValid(valid: boolean): void {
		this.valid.set(valid);
	}

	save(): void {
		if (this.valid()) this.modal.close({ ...this.values });
	}
}
