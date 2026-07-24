import { Component, OnInit, computed, input, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { ConfiguratorState, IAddonGroup } from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { MeasurementsForm } from '../measurements-form/measurements-form';
import { OptionSwatch } from '../option-swatch/option-swatch';

/**
 * `named_add_on` renderer (KB tailoring). Shows each add-on option group in its
 * admin-chosen display style, reveals the measurement form when a selected term
 * requires it, and reports a running total + validity to the buy-box so
 * Add-to-Cart is gated (disabled until measurements are provided; enabled for
 * zero-measurement defaults like "No Design"). The base product identity is
 * unchanged — this only customises an included sub-part.
 */
@Component({
	selector: 'app-addon-group',
	templateUrl: './addon-group.html',
	styleUrls: ['./addon-group.scss'],
	providers: [CurrencySymbolPipe],
	imports: [OptionSwatch, MeasurementsForm, CurrencySymbolPipe, TranslocoModule],
})
export class AddonGroup implements OnInit {
	readonly product = input.required<IProduct>();
	/** Effective base price to add deltas onto — the selected variant's price when the product also has a variation axis. */
	readonly basePrice = input<number>();
	/** Prefill selections (group code -> term code) when re-opening a saved line for editing. */
	readonly initialSelections = input<Record<string, string>>();
	/** Prefill measurement values (field code -> value) for editing. */
	readonly initialMeasurements = input<Record<string, number>>();
	readonly change = output<ConfiguratorState>();

	readonly base = computed(() => this.basePrice() ?? this.product().price);

	private readonly selections = signal<Record<string, string>>({});
	private readonly measurements = signal<Record<string, number>>({});
	private readonly measurementsValid = signal(false);

	readonly groups = computed<IAddonGroup[]>(() => this.product().addon_groups ?? []);

	selectedCode(group: IAddonGroup): string {
		return this.selections()[group.code] ?? group.default_term_code ?? group.terms[0]?.code ?? '';
	}

	private readonly selectedTerms = computed(() =>
		this.groups().map((g) => g.terms.find((t) => t.code === this.selectedCode(g))),
	);

	readonly delta = computed(() => this.selectedTerms().reduce((sum, t) => sum + (t?.price_delta ?? 0), 0));
	readonly total = computed(() => this.base() + this.delta());
	readonly needsMeasurements = computed(() => this.selectedTerms().some((t) => t?.requires_measurements));

	readonly valid = computed(() => !this.needsMeasurements() || this.measurementsValid());

	ngOnInit() {
		const seed = this.initialSelections();
		if (seed && Object.keys(seed).length) this.selections.set({ ...seed });
		const meas = this.initialMeasurements();
		if (meas && Object.keys(meas).length) {
			this.measurements.set({ ...meas });
			// prefilled measurements are already valid; measurements-form re-confirms on render
			this.measurementsValid.set(true);
		}
		this.emit();
	}

	select(group: IAddonGroup, code: string) {
		this.selections.update((s) => ({ ...s, [group.code]: code }));
		this.emit();
	}

	onMeasurementsValue(value: Record<string, number>) {
		this.measurements.set(value);
		this.emit();
	}

	onMeasurementsValid(valid: boolean) {
		this.measurementsValid.set(valid);
		this.emit();
	}

	private emit() {
		this.change.emit({
			total: this.total(),
			delta: this.delta(),
			valid: this.valid(),
			selections: this.selections(),
			measurements: this.measurements(),
		});
	}
}
