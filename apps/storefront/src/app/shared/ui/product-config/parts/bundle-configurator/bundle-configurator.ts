import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { chosenPieces, isChoiceGroup, setPriceINR } from '@saha-textile/core-domain/set-price';

import {
	ConfiguratorState,
	IBundle,
	IBundleComponent,
	IBundleOptionGroup,
} from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { setPricing } from '../../set-pricing';
import { MeasurementRow } from '../measurement-row/measurement-row';
import { MeasurementsSheet } from '../measurements-sheet/measurements-sheet';
import { OptionSwatch } from '../option-swatch/option-swatch';

/** One row of the set: a choice group with its pieces, or a single piece (optional or not). */
type SetRow =
	| { kind: 'group'; code: string; group: string; label: string; max: number; pieces: IBundleComponent[] }
	| { kind: 'piece'; code: string; piece: IBundleComponent; optional: boolean };

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
	providers: [CurrencySymbolPipe],
	imports: [OptionSwatch, MeasurementRow, CurrencySymbolPipe, TranslocoModule, NgTemplateOutlet],
})
export class BundleConfigurator implements OnInit {
	readonly product = input.required<IProduct>();
	/** Prefill option selections (group code -> term code) when editing a saved line. */
	readonly initialSelections = input<Record<string, string>>();
	/** Prefill measurement values (field code -> value) when editing a saved line. */
	readonly initialMeasurements = input<Record<string, number>>();
	/** Prefill a set's picks and optional pieces (the buy bar's Configure set sheet). */
	readonly initialPicks = input<Record<string, string[]>>();
	readonly initialExtras = input<string[]>();
	readonly stateChange = output<ConfiguratorState>();
	/** The product page shows the set's summary in its right column instead (brief P8); the pop-up keeps it here. */
	readonly showSummary = input(true);

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

	/** Each choice group's picks and the optional pieces switched on (owner, 21 Nov 2026: each set's price setting). */
	private readonly picks = signal<Record<string, string[]>>({});
	private readonly extras = signal<string[]>([]);
	private readonly pricing = computed(() => setPricing(this.bundle()));
	/** The pieces the set holds now: required ones, each group's picks and the optional ones switched on. */
	readonly chosen = computed(
		() => new Set(chosenPieces(this.pricing(), { picks: this.picks(), extras: this.extras() })),
	);
	readonly setPrice = computed(() => setPriceINR(this.pricing(), { picks: this.picks(), extras: this.extras() }));
	readonly total = computed(() => this.setPrice() + this.optionDelta());

	/**
	 * The set as rows (brief P8): a choice group is one row whose tiles pick its piece; any other piece is its own
	 * row, with a switch when it is optional.
	 */
	readonly rows = computed(() =>
		this.pricing().groups.flatMap<SetRow>((group) => {
			const pieces = this.components().filter((piece) => (piece.group ?? '') === group.code);
			const label = this.bundle().groups?.find((candidate) => candidate.code === group.code)?.label ?? '';
			return isChoiceGroup(group)
				? [
						{
							kind: 'group' as const,
							code: `group:${group.code}`,
							group: group.code,
							label,
							max: group.maxSelections,
							pieces,
						},
					]
				: pieces.map((piece) => ({
						kind: 'piece' as const,
						code: piece.code,
						piece,
						optional: piece.required === false,
					}));
		}),
	);
	readonly hasChoice = computed(() => this.rows().some((row) => row.kind === 'group'));
	readonly optionalCount = computed(() => this.rows().filter((row) => row.kind === 'piece' && row.optional).length);
	/** The heading's count: rows, and "+ N optional" when the set has optional pieces (brief section 6). */
	readonly countLabel = computed(() => {
		const optional = this.optionalCount();
		const rows = String(this.rows().length - optional);
		return optional ? `${rows} ${this.transloco.translate('plus_optional', { count: optional })}` : rows;
	});

	readonly needsMeasurements = computed(
		() =>
			this.components().some((c) => this.chosen().has(c.code) && c.requires_measurements) ||
			this.selectedTerms().some((t) => t?.requires_measurements),
	);
	readonly available = computed(() =>
		this.components().every((c) => !this.chosen().has(c.code) || c.stock_status === 'in_stock'),
	);
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

	/** A piece's mark: red out of stock, amber while its measurements are missing, none while an optional one is off. */
	mark(piece: IBundleComponent): 'ok' | 'warn' | 'bad' | 'off' {
		if (!this.chosen().has(piece.code)) return 'off';
		if (piece.stock_status !== 'in_stock') return 'bad';
		if (piece.requires_measurements && !this.measurementsValid()) return 'warn';
		return 'ok';
	}

	/** A choice group's mark: its picks' own, amber when a pick is out of stock but another is in, red when none is. */
	groupMark(pieces: IBundleComponent[]): 'ok' | 'warn' | 'bad' {
		const picked = pieces.filter((piece) => this.chosen().has(piece.code));
		if (picked.every((piece) => piece.stock_status === 'in_stock'))
			return picked.some((piece) => this.mark(piece) === 'warn') ? 'warn' : 'ok';
		return pieces.some((piece) => piece.stock_status === 'in_stock') ? 'warn' : 'bad';
	}

	/** Takes a piece in its choice group: in place of the group's pick, or beside it while the group has room. */
	pick(group: string, max: number, code: string): void {
		const now = this.components()
			.filter((piece) => (piece.group ?? '') === group && this.chosen().has(piece.code))
			.map((piece) => piece.code);
		if (now.includes(code)) return;
		const next = max > 1 ? [...now, code].slice(-max) : [code];
		this.picks.update((picks) => ({ ...picks, [group]: next }));
		this.emit();
	}

	/** Switches an optional piece on or off. */
	toggleExtra(code: string): void {
		this.extras.update((extras) =>
			extras.includes(code) ? extras.filter((id) => id !== code) : [...extras, code],
		);
		this.emit();
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
		this.picks.set({ ...this.initialPicks() });
		this.extras.set([...(this.initialExtras() ?? [])]);
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
	apply(
		selections: Record<string, string>,
		measurements: Record<string, number>,
		measured: boolean,
		set: { picks?: Record<string, string[]>; extras?: string[] } = {},
	) {
		this.picks.set({ ...set.picks });
		this.extras.set([...(set.extras ?? [])]);
		this.selections.set({ ...selections });
		this.measurements.set({ ...measurements });
		this.measurementsValid.set(measured);
		this.formSeed.set({ ...measurements });
		this.formKey.update((key) => key + 1);
		this.emit();
	}

	/** The current choices, for a sheet to start from. */
	snapshot(): {
		selections: Record<string, string>;
		measurements: Record<string, number>;
		measured: boolean;
		picks: Record<string, string[]>;
		extras: string[];
	} {
		return {
			selections: this.selections(),
			measurements: this.measurements(),
			measured: this.measurementsValid(),
			picks: this.picks(),
			extras: this.extras(),
		};
	}

	private emit() {
		this.stateChange.emit({
			total: this.total(),
			// Over the set's own price: its options, its picks and its optional pieces.
			delta: this.total() - this.bundle().bundle_price,
			valid: this.valid(),
			selections: this.selections(),
			measurements: this.measurements(),
			picks: this.picks(),
			extras: this.extras(),
			pieces: [...this.chosen()],
		});
	}
}
