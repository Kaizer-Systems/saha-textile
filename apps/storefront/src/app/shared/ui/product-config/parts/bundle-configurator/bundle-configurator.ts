import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { includedKeys, quoteBundle, type BundleQuote } from '@saha-textile/core-domain/bundle';

import {
	ConfiguratorState,
	IBundle,
	IBundleOptionGroup,
	IFreePick,
	ISetItem,
	ISetLevel,
} from '@data-access/interfaces/product-detail.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { setQuote } from '../../set-pricing';
import { FreeItems, FreeItemsState, freePicksValid, givenFreePicks } from '../free-items/free-items';
import { FreeItemsSheet } from '../free-items-sheet/free-items-sheet';
import { MeasurementRow } from '../measurement-row/measurement-row';
import { MeasurementsSheet } from '../measurements-sheet/measurements-sheet';
import { OptionSwatch } from '../option-swatch/option-swatch';

/** A set's choices: picks per level, sizes for items the shopper sizes, extras ticked, free items per piece. */
export interface SetChoice {
	picks?: Record<string, string[]>;
	extras?: string[];
	variants?: Record<string, string>;
	free?: Record<string, IFreePick[]>;
}

/** One row of the set: a choice level, a fixed piece, or an optional extra. */
type SetRow =
	| { kind: 'choice'; code: string; level: ISetLevel }
	| { kind: 'piece'; code: string; level: ISetLevel; item: ISetItem }
	| { kind: 'extra'; code: string; item: ISetItem };

/**
 * The set block (bundle builder brief, approved 2026-11-22; product page brief P8). A fixed level shows its pieces
 * with a green tick; a choice level opens to picture tiles; extras use the same rows with an outlined tick that
 * fills when ticked. A pick that brings free items opens a pop-up when a choice is needed (D5). Prices come from
 * core `quoteBundle`, the same rules checkout uses.
 */
@Component({
	selector: 'app-bundle-configurator',
	templateUrl: './bundle-configurator.html',
	providers: [CurrencySymbolPipe],
	imports: [OptionSwatch, MeasurementRow, FreeItems, CurrencySymbolPipe, TranslocoModule, NgTemplateOutlet],
})
export class BundleConfigurator implements OnInit {
	readonly product = input.required<IProduct>();
	/** Prefill option selections (group code -> term code) when editing a saved line. */
	readonly initialSelections = input<Record<string, string>>();
	/** Prefill measurement values (field code -> value) when editing a saved line. */
	readonly initialMeasurements = input<Record<string, number>>();
	/** Prefill a set's choices (the buy bar's Configure set sheet, or a cart edit). */
	readonly initialSet = input<SetChoice>();
	readonly stateChange = output<ConfiguratorState>();
	/** The product page shows the set's summary in its right column instead (brief P8); the pop-up keeps it here. */
	readonly showSummary = input(true);

	private readonly selections = signal<Record<string, string>>({});
	private readonly measurements = signal<Record<string, number>>({});
	private readonly measurementsValid = signal(false);

	readonly bundle = computed<IBundle>(() => this.product().bundle as IBundle);
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

	private readonly picks = signal<Record<string, string[]>>({});
	private readonly extras = signal<string[]>([]);
	private readonly variants = signal<Record<string, string>>({});
	private readonly free = signal<Record<string, IFreePick[]>>({});

	private readonly engine = computed(() => setQuote(this.bundle()));
	readonly quote = computed<BundleQuote>(() =>
		quoteBundle(this.engine(), { picks: this.picks(), extras: this.extras() }),
	);
	/** Every item key the set holds now: pieces and extras. */
	readonly chosen = computed(
		() =>
			new Set([
				...this.quote().pieces.map((piece) => piece.key),
				...this.quote().extras.map((extra) => extra.key),
			]),
	);
	readonly total = computed(() => this.quote().totalINR + this.optionDelta());

	private readonly items = computed(() => [
		...this.bundle().levels.flatMap((level) => level.items),
		...this.bundle().extras,
	]);
	itemOf(key: string): ISetItem | undefined {
		return this.items().find((item) => item.key === key);
	}

	/** The set as rows: a choice level is one row; each piece of a fixed level its own; then the extras. */
	readonly rows = computed<SetRow[]>(() => [
		...this.bundle().levels.flatMap<SetRow>((level) =>
			level.choice
				? [{ kind: 'choice', code: `level:${level.code}`, level }]
				: level.items.map((item) => ({ kind: 'piece', code: `item:${item.key}`, level, item })),
		),
		...this.bundle().extras.map<SetRow>((item) => ({ kind: 'extra', code: `extra:${item.key}`, item })),
	]);
	readonly hasChoice = computed(() => this.bundle().heading === 'choose');
	readonly extraCount = computed(() => this.bundle().extras.length);
	/** The heading's count: rows, and "+ N optional" when the set has extras (brief section 6). */
	readonly countLabel = computed(() => {
		const extras = this.extraCount();
		const rows = String(this.rows().length - extras);
		return extras ? `${rows} ${this.transloco.translate('plus_optional', { count: extras })}` : rows;
	});

	/** A piece the shopper must size (no pinned size or colour). */
	needsSize(item: ISetItem): boolean {
		return item.variant_id === null && item.variants.length > 0;
	}

	sizeOf(item: ISetItem): string | null {
		return item.variant_id ?? this.variants()[item.key] ?? null;
	}

	sizeLabel(item: ISetItem): string | null {
		const id = this.sizeOf(item);
		return item.variant_label ?? item.variants.find((v) => v.id === id)?.label ?? null;
	}

	/** The free items a chosen piece brings now: given ones fill themselves in; chosen ones come from the pop-up. */
	freeOf(item: ISetItem): IFreePick[] {
		const rule = item.free_with;
		if (!rule) return [];
		return this.free()[item.key] ?? (rule.given ? givenFreePicks(rule) : []);
	}

	freeNames(item: ISetItem): string[] {
		const rule = item.free_with;
		if (!rule) return [];
		return this.freeOf(item).flatMap(
			(pick) => rule.items.find((row) => row.product_id === pick.productId)?.name ?? [],
		);
	}

	freeReady(item: ISetItem): boolean {
		return !item.free_with || freePicksValid(item.free_with, this.freeOf(item));
	}

	/** Whether a chosen item is ready: in stock, sized, and its free choice made. */
	ready(item: ISetItem): boolean {
		return item.in_stock && (!this.needsSize(item) || !!this.sizeOf(item)) && this.freeReady(item);
	}

	readonly needsMeasurements = computed(() => this.selectedTerms().some((t) => t?.requires_measurements));

	readonly valid = computed(() => {
		const quote = this.quote();
		if (!quote.ok || !this.bundle().buyable) return false;
		if (
			[...this.chosen()].some((key) => {
				const item = this.itemOf(key);
				return !item || !this.ready(item);
			})
		)
			return false;
		return !this.needsMeasurements() || this.measurementsValid();
	});

	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);

	/** The open row; one at a time, all closed at first (brief P8). */
	readonly open = signal<string | null>(null);
	readonly measured = computed(() => this.measurementsValid());
	readonly lang = computed(() => this.transloco.getActiveLang() || 'en');
	readonly measureTitle = computed(
		() => this.product().measurement_title || this.transloco.translate('measurements_required_for_selection'),
	);

	toggle(code: string): void {
		this.open.update((now) => (now === code ? null : code));
	}

	/** A piece's mark: red out of stock, amber while a size, free choice or measurements are missing. */
	mark(item: ISetItem): 'ok' | 'warn' | 'bad' {
		if (!item.in_stock) return 'bad';
		if (!this.ready(item)) return 'warn';
		if (this.needsMeasurements() && !this.measurementsValid()) return 'warn';
		return 'ok';
	}

	/** A choice level's mark: its picks' own; red when nothing it offers is in stock. */
	levelMark(level: ISetLevel): 'ok' | 'warn' | 'bad' {
		if (!level.items.some((item) => item.in_stock)) return 'bad';
		const picked = level.items.filter((item) => this.chosen().has(item.key));
		if (picked.length !== level.take) return 'warn';
		return picked.every((item) => this.mark(item) === 'ok')
			? 'ok'
			: picked.some((item) => !item.in_stock)
				? 'bad'
				: 'warn';
	}

	picked(level: ISetLevel): ISetItem[] {
		return level.items.filter((item) => this.chosen().has(item.key));
	}

	/** Whether the set's rules let this level offer the item now (S5). */
	offered(level: ISetLevel, item: ISetItem): boolean {
		return (this.quote().offered[level.code] ?? []).includes(item.key);
	}

	/** What picking this item changes against the level's included pieces ("Included", "+₹800"). */
	changeFor(level: ISetLevel, item: ISetItem): number {
		const engine = this.engine();
		const engineLevel = engine.levels.find((row) => row.code === level.code);
		if (!engineLevel) return 0;
		const included = includedKeys(engineLevel, this.quote().offered[level.code]);
		if (included.includes(item.key)) return 0;
		const base = quoteBundle(engine, { picks: { ...this.picks(), [level.code]: included } }).setPriceINR;
		const withIt = quoteBundle(engine, {
			picks: { ...this.picks(), [level.code]: [...included.slice(0, -1), item.key] },
		}).setPriceINR;
		return withIt - base;
	}

	/** Takes an item in its level: in place of the pick, or beside it while the level has room; a second tap lets go. */
	async pick(level: ISetLevel, item: ISetItem): Promise<void> {
		if (!item.in_stock || !this.offered(level, item)) return;
		const now = this.picked(level).map((row) => row.key);
		let next: string[];
		if (now.includes(item.key)) {
			if (level.take === 1) return;
			next = now.filter((key) => key !== item.key);
		} else next = level.take === 1 ? [item.key] : [...now, item.key].slice(-level.take);
		this.picks.update((picks) => ({ ...picks, [level.code]: next }));
		this.emit();
		if (!now.includes(item.key)) await this.askFree(item);
	}

	/** Ticks an extra on or off (the outlined tick, brief D3). */
	async toggleExtra(item: ISetItem): Promise<void> {
		if (!item.in_stock) return;
		const on = this.extras().includes(item.key);
		this.extras.update((extras) => (on ? extras.filter((key) => key !== item.key) : [...extras, item.key]));
		this.emit();
		if (!on) await this.askFree(item);
	}

	setSize(item: ISetItem, variantId: string): void {
		this.variants.update((now) => ({ ...now, [item.key]: variantId }));
		this.emit();
	}

	/** A fixed piece's free choice, made inside its own row (D2-FIXED). */
	onFreeState(item: ISetItem, state: FreeItemsState): void {
		this.free.update((now) => ({ ...now, [item.key]: state.picks }));
		this.emit();
	}

	/**
	 * The pop-up (D5): a note with OK for one given item, tiles for a choice. It opens only when the pick brings
	 * free items that need the shopper: given items without sizes simply show as a chip on the row.
	 */
	private async askFree(item: ISetItem): Promise<void> {
		const rule = item.free_with;
		if (!rule) return;
		const needsShopper =
			!rule.given || rule.items.some((row) => row.variant_id === null && row.variants.length > 0);
		if (!needsShopper && rule.items.length > 1) return;
		const popup = this.modals.open(FreeItemsSheet, {
			ariaLabelledBy: 'free_items_sheet_title',
			centered: true,
			scrollable: true,
			windowClass: 'theme-modal st-sheet',
		});
		(popup.componentInstance as FreeItemsSheet).start({
			pieceName: item.name,
			freeWith: rule,
			picks: this.free()[item.key] ?? null,
		});
		const picks = (await popup.result.catch(() => null)) as IFreePick[] | null;
		if (picks === null) return;
		this.free.update((now) => ({ ...now, [item.key]: picks }));
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
		this.setChoice(this.initialSet() ?? {});
		this.emit();
	}

	select(group: IBundleOptionGroup, code: string) {
		this.selections.update((s) => ({ ...s, [group.code]: code }));
		this.emit();
	}

	/** Takes choices made in the buy bar's Configure set sheet (brief P4) as this part's own. */
	apply(
		selections: Record<string, string>,
		measurements: Record<string, number>,
		measured: boolean,
		set: SetChoice = {},
	) {
		this.setChoice(set);
		this.selections.set({ ...selections });
		this.measurements.set({ ...measurements });
		this.measurementsValid.set(measured);
		this.emit();
	}

	private setChoice(set: SetChoice): void {
		this.picks.set({ ...set.picks });
		this.extras.set([...(set.extras ?? [])]);
		this.variants.set({ ...set.variants });
		this.free.set({ ...set.free });
	}

	/** The current choices, for a sheet to start from. */
	snapshot(): {
		selections: Record<string, string>;
		measurements: Record<string, number>;
		measured: boolean;
		set: SetChoice;
	} {
		return {
			selections: this.selections(),
			measurements: this.measurements(),
			measured: this.measurementsValid(),
			set: { picks: this.picks(), extras: this.extras(), variants: this.variants(), free: this.freeAll() },
		};
	}

	/** Free items for every chosen piece and extra, given ones filled in. */
	private freeAll(): Record<string, IFreePick[]> {
		const chosen = this.chosen();
		return Object.fromEntries(
			this.items()
				.filter((item) => chosen.has(item.key))
				.flatMap((item) => {
					const picks = this.freeOf(item);
					return picks.length ? [[item.key, picks]] : [];
				}),
		);
	}

	private emit() {
		this.stateChange.emit({
			total: this.total(),
			// Over the set's own price: its options, its picks and its extras.
			delta: this.total() - this.bundle().bundle_price,
			valid: this.valid(),
			selections: this.selections(),
			measurements: this.measurements(),
			picks: this.picks(),
			extras: this.extras(),
			pieces: [...this.chosen()],
			variants: this.variants(),
			free: this.freeAll(),
		});
	}
}
