import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { ConfiguratorState, IAddonGroup } from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { MeasurementRow } from '../measurement-row/measurement-row';
import { MeasurementsForm } from '../measurements-form/measurements-form';
import { MeasurementsSheet } from '../measurements-sheet/measurements-sheet';
import { OptionSwatch } from '../option-swatch/option-swatch';

/**
 * `named_add_on` renderer (KB tailoring). Shows each add-on option group in its
 * admin-chosen display style, reveals the measurement form when a selected term
 * requires it, and reports a running total + validity to the buy-box so
 * Add-to-Cart is gated (disabled until measurements are provided; enabled for
 * zero-measurement defaults like "No Design"). The base product identity is
 * unchanged — this only customises an included sub-part.
 */
/** Measurement forms with this many fields or fewer show on the page; longer ones open from the row (P7). */
const INLINE_FIELDS = 4;

@Component({
	selector: 'app-addon-group',
	templateUrl: './addon-group.html',
	styleUrls: ['./addon-group.scss'],
	providers: [CurrencySymbolPipe],
	imports: [OptionSwatch, MeasurementsForm, MeasurementRow, CurrencySymbolPipe, TranslocoModule],
})
export class AddonGroup implements OnInit {
	readonly product = input.required<IProduct>();
	/** Effective base price to add deltas onto — the selected variant's price when the product also has a variation axis. */
	readonly basePrice = input<number>();
	/** Prefill selections (group code -> term code) when re-opening a saved line for editing. */
	readonly initialSelections = input<Record<string, string>>();
	/** Prefill measurement values (field code -> value) for editing. */
	readonly initialMeasurements = input<Record<string, number>>();
	readonly stateChange = output<ConfiguratorState>();
	/**
	 * How the measurements show (brief P7): `auto` is the form itself for four fields or fewer and the measurement row
	 * with its pop-up for more; `row` always the row (sets and the bar's pencil); `form` always the form (the bar's
	 * Edit add-on).
	 */
	readonly measureAs = input<'auto' | 'row' | 'form'>('auto');

	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);

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

	/** The chosen add-on that needs measurements, named in the form's title (owner, 21 Nov, brief rev 4 P9). */
	readonly measuredLabel = computed(() => this.selectedTerms().find((t) => t?.requires_measurements)?.label ?? '');

	readonly valid = computed(() => !this.needsMeasurements() || this.measurementsValid());

	readonly fields = computed(() => this.product().measurement_fields ?? []);
	/** More than four fields would push the buttons down, so they move into the pop-up behind the row. */
	readonly asRow = computed(
		() => this.measureAs() === 'row' || (this.measureAs() === 'auto' && this.fields().length > INLINE_FIELDS),
	);
	/** Changes when values are written in from outside, so the form on the page is drawn again with them. */
	readonly formKey = signal(0);
	/** The values the form on the page starts from: a saved line's, or the last ones written in. */
	readonly formSeed = signal<Record<string, number> | undefined>(undefined);
	/** The row's name: the template's ("Suit measurements"), else the form's own title. */
	readonly rowTitle = computed(
		() =>
			this.product().measurement_title ||
			this.transloco.translate('measurements_for', { name: this.measuredLabel() }),
	);
	readonly measured = computed(() => this.measurementsValid());

	/** Add / Edit on the row: the whole form in the shop's pop-up, a sheet on phones; Save brings the values back. */
	async openMeasurements(): Promise<void> {
		const popup = this.modals.open(MeasurementsSheet, {
			ariaLabelledBy: 'measurements_sheet_title',
			centered: true,
			scrollable: true,
			size: 'lg',
			windowClass: 'theme-modal st-sheet',
		});
		(popup.componentInstance as MeasurementsSheet).start({
			heading: this.rowTitle(),
			fields: this.fields(),
			forName: this.measuredLabel(),
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
			// prefilled measurements are already valid; measurements-form re-confirms on render
			this.measurementsValid.set(true);
		}
		this.emit();
	}

	select(group: IAddonGroup, code: string) {
		this.selections.update((s) => ({ ...s, [group.code]: code }));
		this.emit();
	}

	/**
	 * Takes choices made elsewhere (the buy bar's sheets, brief P4) as this part's own: the selections, the measurements
	 * and whether they were complete, and draws the form again with them.
	 */
	apply(selections: Record<string, string>, measurements: Record<string, number>, measured: boolean) {
		this.selections.set({ ...selections });
		this.measurements.set({ ...measurements });
		this.measurementsValid.set(measured);
		this.formSeed.set({ ...measurements });
		this.formKey.update((key) => key + 1);
		this.emit();
	}

	/** The last state reported, for a sheet to start from. */
	snapshot(): { selections: Record<string, string>; measurements: Record<string, number>; measured: boolean } {
		return { selections: this.selections(), measurements: this.measurements(), measured: this.measurementsValid() };
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
		this.stateChange.emit({
			total: this.total(),
			delta: this.delta(),
			valid: this.valid(),
			selections: this.selections(),
			measurements: this.measurements(),
		});
	}
}
