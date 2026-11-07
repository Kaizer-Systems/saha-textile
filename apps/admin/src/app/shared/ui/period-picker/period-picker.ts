import { Component, inject, output, signal } from '@angular/core';

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

type Preset = 'last_12_months' | 'last_30_days' | 'last_month' | 'last_quarter' | 'current_quarter' | 'custom';

const PRESETS: readonly Preset[] = [
	'last_12_months',
	'last_30_days',
	'last_month',
	'last_quarter',
	'current_quarter',
	'custom',
];

const DEFAULT_PRESET: Preset = 'last_12_months';

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
export class PeriodPicker {
	readonly formatter = inject(NgbDateParserFormatter);

	/** Emits only a complete choice, so a tile never asks for half a custom range. */
	readonly changed = output<DashboardPeriodQuery>();

	readonly presets = PRESETS;
	readonly selected = signal<Preset>(DEFAULT_PRESET);
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

	label(): string {
		const from = this.fromDate();
		const to = this.toDate();
		return this.selected() === 'custom' && from && to
			? `${this.formatter.format(from)} – ${this.formatter.format(to)}`
			: '';
	}

	choose(preset: Preset, dropdown: NgbDropdown): void {
		this.selected.set(preset);
		if (preset === 'custom') return;
		this.fromDate.set(null);
		this.toDate.set(null);
		this.changed.emit({ period: preset });
		dropdown.close();
	}

	onDateSelection(date: NgbDate, dropdown: NgbDropdown): void {
		const from = this.fromDate();
		if (from && !this.toDate() && !date.before(from)) {
			this.toDate.set(date);
			this.changed.emit({
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
