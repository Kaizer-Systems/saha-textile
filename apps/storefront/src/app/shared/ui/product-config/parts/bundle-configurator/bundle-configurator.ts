import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import {
	ConfiguratorState,
	IBundle,
	IBundleComponent,
	IBundleOptionGroup,
} from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { MeasurementRow } from '../measurement-row/measurement-row';
import { MeasurementsSheet } from '../measurements-sheet/measurements-sheet';
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
	imports: [OptionSwatch, MeasurementRow, CurrencySymbolPipe, TranslocoModule],
})
export class BundleConfigurator implements OnInit {
	readonly product = input.required<IProduct>();
	/** Prefill option selections (group code -> term code) when editing a saved line. */
	readonly initialSelections = input<Record<string, string>>();
	/** Prefill measurement values (field code -> value) when editing a saved line. */
	readonly initialMeasurements = input<Record<string, number>>();
	readonly stateChange = output<ConfiguratorState>();

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

	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);

	/** The open piece row; one at a time, all closed at first (brief P8). */
	readonly open = signal<string | null>(null);
	readonly measured = computed(() => this.measurementsValid());
	readonly lang = computed(() => this.transloco.getActiveLang() || 'en');
	readonly measureTitle = computed(
		() => this.product().measurement_title || this.transloco.translate('measurements_required_for_selection'),
	);

	toggle(code: string): void {
		this.open.update((now) => (now === code ? null : code));
	}

	/** A piece's mark: red out of stock, amber while its measurements are missing, else green. */
	mark(piece: IBundleComponent): 'ok' | 'warn' | 'bad' {
		if (piece.stock_status !== 'in_stock') return 'bad';
		if (piece.requires_measurements && !this.measurementsValid()) return 'warn';
		return 'ok';
	}

	/** The measurement row's Add / Edit: the set's form in the pop-up; Save brings the values back. */
	async openMeasurements(): Promise<void> {
		const popup = this.modals.open(MeasurementsSheet, {
			ariaLabelledBy: 'measurements_sheet_title',
			centered: true,
			scrollable: true,
			size: 'lg',
			windowClass: 'theme-modal st-sheet',
		});
		(popup.componentInstance as MeasurementsSheet).start({
			heading: this.measureTitle(),
			fields: this.bundle().measurement_fields ?? [],
			forName: '',
			values: this.measurements(),
			sizeGuide: !!this.product().size_guide,
		});
		const values = (await popup.result.catch(() => null)) as Record<string, number> | null;
		if (!values) return;
		this.measurements.set(values);
		this.measurementsValid.set(true);
		this.emit();
	}

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

	/** Changes when values are written in from outside, so the form is drawn again with them. */
	readonly formKey = signal(0);
	readonly formSeed = signal<Record<string, number> | undefined>(undefined);

	/** Takes choices made in the buy bar's Configure set sheet (brief P4) as this part's own. */
	apply(selections: Record<string, string>, measurements: Record<string, number>, measured: boolean) {
		this.selections.set({ ...selections });
		this.measurements.set({ ...measurements });
		this.measurementsValid.set(measured);
		this.formSeed.set({ ...measurements });
		this.formKey.update((key) => key + 1);
		this.emit();
	}

	/** The current choices, for a sheet to start from. */
	snapshot(): { selections: Record<string, string>; measurements: Record<string, number>; measured: boolean } {
		return { selections: this.selections(), measurements: this.measurements(), measured: this.measurementsValid() };
	}

	private emit() {
		this.stateChange.emit({
			total: this.total(),
			delta: this.optionDelta(),
			valid: this.valid(),
			selections: this.selections(),
			measurements: this.measurements(),
		});
	}
}
