import { TestBed } from '@angular/core/testing';

import { NgbDate, type NgbDropdown } from '@ng-bootstrap/ng-bootstrap';
import { DASHBOARD_CUSTOM_RANGE_MAX_MONTHS } from '@saha-textile/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CUSTOM_RANGE_MAX_MONTHS, PeriodPicker } from './period-picker';

const setup = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(PeriodPicker, { set: { imports: [], template: '' } });
	const picker = TestBed.createComponent(PeriodPicker).componentInstance;
	const emitted: unknown[] = [];
	picker.changed.subscribe((value) => emitted.push(value));
	const dropdown = { close: vi.fn() };
	return { picker, emitted, dropdown, menu: dropdown as unknown as NgbDropdown };
};
const day = (year: number, month: number, date: number) => new NgbDate(year, month, date);

afterEach(() => vi.useRealTimers());

describe('PeriodPicker', () => {
	it('keeps its limit in step with the contracts', () => {
		expect(CUSTOM_RANGE_MAX_MONTHS).toBe(DASHBOARD_CUSTOM_RANGE_MAX_MONTHS);
	});

	it('starts on the last 12 months with no label of its own', () => {
		const { picker } = setup();
		expect(picker.selected()).toBe('last_12_months');
		expect(picker.label()).toBe('');
	});

	it('emits a preset and closes', () => {
		const { picker, emitted, dropdown, menu } = setup();
		picker.choose('last_quarter', menu);
		expect(emitted).toEqual([{ period: 'last_quarter' }]);
		expect(dropdown.close).toHaveBeenCalledOnce();
	});

	it('stays open and silent on Custom until both days are picked', () => {
		const { picker, emitted, dropdown, menu } = setup();
		picker.choose('custom', menu);
		picker.onDateSelection(day(2026, 8, 1), menu);
		expect(emitted).toEqual([]);
		expect(dropdown.close).not.toHaveBeenCalled();
		expect(picker.label()).toBe('');

		picker.onDateSelection(day(2026, 10, 31), menu);
		expect(emitted).toEqual([{ period: 'custom', from: '2026-08-01', to: '2026-10-31' }]);
		expect(dropdown.close).toHaveBeenCalledOnce();
		expect(picker.label()).toBe('2026-08-01 – 2026-10-31');
	});

	it('accepts a single day', () => {
		const { picker, emitted, menu } = setup();
		picker.onDateSelection(day(2026, 8, 1), menu);
		picker.onDateSelection(day(2026, 8, 1), menu);
		expect(emitted).toEqual([{ period: 'custom', from: '2026-08-01', to: '2026-08-01' }]);
	});

	it('starts again when the second pick is earlier, or a range is already set', () => {
		const { picker, emitted, menu } = setup();
		picker.onDateSelection(day(2026, 8, 10), menu);
		picker.onDateSelection(day(2026, 8, 1), menu);
		expect(picker.fromDate()).toEqual(day(2026, 8, 1));
		expect(emitted).toEqual([]);
		picker.onDateSelection(day(2026, 8, 5), menu);
		picker.onDateSelection(day(2026, 9, 1), menu);
		expect(picker.fromDate()).toEqual(day(2026, 9, 1));
		expect(picker.toDate()).toBeNull();
	});

	it('clears a custom range when a preset is chosen', () => {
		const { picker, menu } = setup();
		picker.selected.set('custom');
		picker.onDateSelection(day(2026, 8, 1), menu);
		picker.onDateSelection(day(2026, 8, 2), menu);
		picker.choose('last_30_days', menu);
		expect(picker.fromDate()).toBeNull();
		expect(picker.toDate()).toBeNull();
		expect(picker.label()).toBe('');
	});

	it('refuses days in the future, and past the limit from the start', () => {
		vi.useFakeTimers({ now: new Date(2026, 10, 7, 12) });
		const { picker, menu } = setup();
		expect(picker.isDateDisabled({ year: 2026, month: 11, day: 7 })).toBe(false);
		expect(picker.isDateDisabled({ year: 2026, month: 11, day: 8 })).toBe(true);

		picker.onDateSelection(day(2023, 1, 15), menu);
		expect(picker.isDateDisabled({ year: 2025, month: 1, day: 15 })).toBe(false);
		expect(picker.isDateDisabled({ year: 2025, month: 1, day: 16 })).toBe(true);

		picker.onDateSelection(day(2023, 2, 1), menu);
		expect(picker.isDateDisabled({ year: 2026, month: 1, day: 1 })).toBe(false);
	});

	it('shades the range and the hover', () => {
		const { picker, menu } = setup();
		picker.onDateSelection(day(2026, 8, 1), menu);
		picker.hoveredDate.set(day(2026, 8, 10));
		expect(picker.isHovered(day(2026, 8, 5))).toBe(true);
		expect(picker.isHovered(day(2026, 8, 20))).toBe(false);
		expect(picker.isRange(day(2026, 8, 1))).toBe(true);
		expect(picker.isRange(day(2026, 8, 5))).toBe(true);
		expect(picker.isRange(day(2026, 8, 20))).toBe(false);

		picker.onDateSelection(day(2026, 8, 7), menu);
		expect(picker.isHovered(day(2026, 8, 5))).toBe(false);
		expect(picker.isInside(day(2026, 8, 5))).toBe(true);
		expect(picker.isRange(day(2026, 8, 7))).toBe(true);
	});

	it('shades nothing before a start is picked', () => {
		const { picker } = setup();
		expect(picker.isInside(day(2026, 8, 5))).toBe(false);
		expect(picker.isHovered(day(2026, 8, 5))).toBe(false);
	});
});
