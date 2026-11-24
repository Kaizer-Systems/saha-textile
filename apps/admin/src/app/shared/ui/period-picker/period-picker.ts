import { Component, type OnInit, inject, input, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import {
	NgbDate,
	NgbDateParserFormatter,
	NgbDropdown,
	NgbDropdownAnchor,
	NgbDropdownItem,
	NgbDropdownMenu,
	NgbInputDatepicker,
} from '@ng-bootstrap/ng-bootstrap';

import type { DashboardPeriodQuery } from '@saha-textile/contracts';

type DashboardPreset = DashboardPeriodQuery['period'];

/** Every period the picker can offer: the dashboard's six, and the accounts lists' five more (accounts brief A). */
export type PeriodPreset = DashboardPreset | 'today' | 'last_7_days' | 'this_month' | 'this_fy' | 'last_fy';

/** A complete choice: a preset, or a custom range of India days. */
export interface PeriodChoice {
	period: PeriodPreset;
	from?: string;
	to?: string;
}

const PRESETS: readonly DashboardPreset[] = [
	'last_12_months',
	'last_30_days',
	'last_month',
	'last_quarter',
	'current_quarter',
	'custom',
];

const DEFAULT_PRESET: PeriodPreset = 'last_12_months';
const DASHBOARD_PRESETS = new Set<PeriodPreset>(PRESETS);

/** The accounts lists' choices, in the order A1 draws them (the financial year runs 1 April to 31 March). */
export const ACCOUNTS_PRESETS: readonly PeriodPreset[] = [
	'today',
	'last_7_days',
	'last_30_days',
	'this_month',
	'last_month',
	'current_quarter',
	'last_quarter',
	'this_fy',
	'last_fy',
	'last_12_months',
	'custom',
];

/**
 * `DASHBOARD_CUSTOM_RANGE_MAX_MONTHS` from the contracts. Repeated here because this app takes
 * only types from that package; the spec fails if the two ever differ. The API enforces it.
 */
export const CUSTOM_RANGE_MAX_MONTHS = 24;

const toNgbDate = (date: Date): NgbDate => new NgbDate(date.getFullYear(), date.getMonth() + 1, date.getDate());

/**
 * The period choice on a home page tile (`DEC-ADMIN-HOME-WIDGETS`).
 *
 * Assembled from what the admin already has: `ngbDropdown` from the language switch, and the
 * date-range picker from `shared/ui/table`, whose `custom-day` and `custom-dt-picker` classes
 * it reuses. There is no CSS of its own.
 */
@Component({
	selector: 'app-period-picker',
	templateUrl: './period-picker.html',
	imports: [TranslocoModule, NgbDropdown, NgbDropdownAnchor, NgbDropdownItem, NgbDropdownMenu, NgbInputDatepicker],
})
export class PeriodPicker implements OnInit {
	readonly formatter = inject(NgbDateParserFormatter);

	/** The choices offered (the dashboard's six unless a page passes its own) and the one picked at first. */
	readonly choices = input<readonly PeriodPreset[]>(PRESETS);
	readonly start = input<PeriodPreset>(DEFAULT_PRESET);
	/** Put before each choice's name to find its words ("period_" on the accounts lists). */
	readonly labelPrefix = input('');
	/** The days a choice covers, shown beside it in the menu ("24 Oct – 23 Nov 2026"); none by default. */
	readonly hint = input<(preset: PeriodPreset) => string | null>(() => null);

	/** Emits only a complete dashboard choice, so a tile never asks for half a custom range. */
	readonly changed = output<DashboardPeriodQuery>();
	/** Every complete choice, whatever the list of choices. */
	readonly picked = output<PeriodChoice>();

	readonly selected = signal<PeriodPreset>(DEFAULT_PRESET);
	readonly fromDate = signal<NgbDate | null>(null);
	readonly toDate = signal<NgbDate | null>(null);
	readonly hoveredDate = signal<NgbDate | null>(null);

	/** The last day that can be picked: today, and no further than the API's limit from the start. */
	readonly isDateDisabled = (date: { year: number; month: number; day: number }): boolean => {
		const candidate = new Date(date.year, date.month - 1, date.day);
		if (candidate > new Date()) return true;
		const from = this.fromDate();
		if (!from || this.toDate()) return false;
		const limit = new Date(from.year, from.month - 1 + CUSTOM_RANGE_MAX_MONTHS, from.day);
		return candidate > limit;
	};

	readonly today = toNgbDate(new Date());

	ngOnInit(): void {
		this.selected.set(this.start());
	}

	/** The choice goes out to every listener that can take it: the dashboard only knows its own six. */
	private emit(choice: PeriodChoice): void {
		this.picked.emit(choice);
		if (DASHBOARD_PRESETS.has(choice.period)) this.changed.emit(choice as DashboardPeriodQuery);
	}

	label(): string {
		const from = this.fromDate();
		const to = this.toDate();
		return this.selected() === 'custom' && from && to
			? `${this.formatter.format(from)} – ${this.formatter.format(to)}`
			: '';
	}

	choose(preset: PeriodPreset, dropdown: NgbDropdown): void {
		this.selected.set(preset);
		if (preset === 'custom') return;
		this.fromDate.set(null);
		this.toDate.set(null);
		this.emit({ period: preset });
		dropdown.close();
	}

	onDateSelection(date: NgbDate, dropdown: NgbDropdown): void {
		const from = this.fromDate();
		if (from && !this.toDate() && !date.before(from)) {
			this.toDate.set(date);
			this.emit({
				period: 'custom',
				from: this.formatter.format(from),
				to: this.formatter.format(date),
			});
			dropdown.close();
			return;
		}
		this.fromDate.set(date);
		this.toDate.set(null);
	}

	isHovered(date: NgbDate): boolean {
		const from = this.fromDate();
		const hovered = this.hoveredDate();
		return Boolean(from && !this.toDate() && hovered && date.after(from) && date.before(hovered));
	}

	isInside(date: NgbDate): boolean {
		const from = this.fromDate();
		const to = this.toDate();
		return Boolean(from && to && date.after(from) && date.before(to));
	}

	isRange(date: NgbDate): boolean {
		return (
			date.equals(this.fromDate()) || date.equals(this.toDate()) || this.isInside(date) || this.isHovered(date)
		);
	}
}
