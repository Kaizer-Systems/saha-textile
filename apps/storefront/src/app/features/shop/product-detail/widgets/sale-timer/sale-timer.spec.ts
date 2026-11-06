import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaleTimer } from './sale-timer';

const NOW = new Date('2026-11-07T00:00:00Z').getTime();
const at = (ms: number) => new Date(NOW + ms).toISOString();
const DAY = 86_400_000;

const render = (start: string | null, end: string | null, platform = 'browser') => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
	TestBed.overrideComponent(SaleTimer, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(SaleTimer);
	const timer = fixture.componentInstance;
	timer.startDate = start;
	timer.endDate = end;
	timer.ngOnChanges();
	return { fixture, timer };
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('SaleTimer', () => {
	it('shows nothing without both dates', () => {
		expect(render(null, at(DAY)).timer.remainingTime).toBeNull();
		expect(render(at(-DAY), null).timer.remainingTime).toBeNull();
	});

	it('shows nothing before the sale starts or after it ends', () => {
		expect(render(at(DAY), at(2 * DAY)).timer.remainingTime).toBeNull();
		expect(render(at(-2 * DAY), at(-DAY)).timer.remainingTime).toBeNull();
	});

	it('counts down during the sale', () => {
		const { timer } = render(at(-DAY), at(DAY + 3_661_000));
		expect(timer.remainingTime).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
		vi.advanceTimersByTime(1000);
		expect(timer.remainingTime).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 0 });
	});

	it('stops at zero when the sale ends', () => {
		const { timer } = render(at(-DAY), at(2000));
		vi.advanceTimersByTime(3000);
		expect(timer.remainingTime).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
	});

	it('never ticks on the server', () => {
		const { timer } = render(at(-DAY), at(DAY), 'server');
		const first = timer.remainingTime;
		vi.advanceTimersByTime(5000);
		expect(timer.remainingTime).toBe(first);
	});

	it('counts to the start if the clock goes back, and stops ticking with no dates', () => {
		const { timer } = render(at(-1000), at(DAY));
		vi.setSystemTime(NOW - 5000);
		vi.advanceTimersByTime(1000);
		expect(timer.remainingTime?.seconds).toBe(3);
		const held = timer.remainingTime;
		timer.startDate = null;
		vi.advanceTimersByTime(1000);
		expect(timer.remainingTime).toBe(held);
	});

	it('stops when destroyed', () => {
		const { fixture, timer } = render(at(-DAY), at(DAY));
		const held = timer.remainingTime;
		fixture.destroy();
		vi.advanceTimersByTime(5000);
		expect(timer.remainingTime).toBe(held);
		expect(() => render(null, null).fixture.destroy()).not.toThrow();
	});
});
