import { Component, OnInit, computed, input, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
	ConfiguratorState,
	IBundle,
	IBundleComponent,
	IBundleOptionGroup,
} from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { MeasurementsForm } from '../measurements-form/measurements-form';
import { OptionSwatch } from '../option-swatch/option-swatch';

/**
 * True `bundle`/composite renderer (KB `productBundles`). Shows the components
 * it consumes (own SKU/stock/consumption), the choose-one-per-group options, the
 * measurement form when a component/option needs it, and an order-summary
 * snapshot (parent + component lines) — the shape the order will snapshot at
 * checkout. Reports total + validity to the buy-box. Everything server-rendered.
 */
@Component({
	selector: 'app-bundle-configurator',
	templateUrl: './bundle-configurator.html',
	styleUrls: ['./bundle-configurator.scss'],
	providers: [CurrencySymbolPipe],
	imports: [OptionSwatch, MeasurementsForm, CurrencySymbolPipe, TranslocoModule],
})
export class BundleConfigurator implements OnInit {
	readonly product = input.required<IProduct>();
	/** Prefill option selections (group code -> term code) when editing a saved line. */
	readonly initialSelections = input<Record<string, string>>();
	/** Prefill measurement values (field code -> value) when editing a saved line. */
	readonly initialMeasurements = input<Record<string, number>>();
	readonly change = output<ConfiguratorState>();

	private readonly selections = signal<Record<string, string>>({});
	private readonly measurements = signal<Record<string, number>>({});
	private readonly measurementsValid = signal(false);

	readonly bundle = computed<IBundle>(() => this.product().bundle!);
	readonly components = computed<IBundleComponent[]>(() => this.bundle().components ?? []);
	readonly optionGroups = computed<IBundleOptionGroup[]>(() => this.bundle().option_groups ?? []);

	selectedCode(group: IBundleOptionGroup): string {
		return this.selections()[group.code] ?? group.default_term_code ?? group.terms[0]?.code ?? '';
	}

	selectedTermLabel(group: IBundleOptionGroup): string {
		return group.terms.find((t) => t.code === this.selectedCode(group))?.label ?? '';
	}

	private readonly selectedTerms = computed(() =>
		this.optionGroups().map((g) => g.terms.find((t) => t.code === this.selectedCode(g))),
	);

	readonly optionDelta = computed(() => this.selectedTerms().reduce((sum, t) => sum + (t?.price_delta ?? 0), 0));
	readonly total = computed(() => this.bundle().bundle_price + this.optionDelta());

	readonly needsMeasurements = computed(
		() =>
			this.components().some((c) => c.requires_measurements) ||
			this.selectedTerms().some((t) => t?.requires_measurements),
	);
	readonly available = computed(() => this.components().every((c) => c.stock_status === 'in_stock'));
	readonly valid = computed(() => this.available() && (!this.needsMeasurements() || this.measurementsValid()));

	ngOnInit() {
		const seed = this.initialSelections();
		if (seed && Object.keys(seed).length) this.selections.set({ ...seed });
		const meas = this.initialMeasurements();
		if (meas && Object.keys(meas).length) {
			this.measurements.set({ ...meas });
			this.measurementsValid.set(true);
		}
		this.emit();
	}

	select(group: IBundleOptionGroup, code: string) {
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
			delta: this.optionDelta(),
			valid: this.valid(),
			selections: this.selections(),
			measurements: this.measurements(),
		});
	}
}
