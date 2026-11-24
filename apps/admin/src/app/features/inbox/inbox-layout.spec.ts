import { afterEach, describe, expect, it, vi } from 'vitest';

import { RAIL_KEY, RAIL_OPEN_FROM, initialRail, pageRange, saveRail } from './inbox-layout';

describe('Inbox folder rail (redesign R2, owner answer Q1)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.removeItem(RAIL_KEY);
	});

	it('starts open on wide screens and as icons below, until the person chooses', () => {
		expect(initialRail(RAIL_OPEN_FROM)).toBe('open');
		expect(initialRail(RAIL_OPEN_FROM - 1)).toBe('icons');
	});

	it('keeps each person’s own choice in this browser, whatever the width', () => {
		saveRail('icons');
		expect(localStorage.getItem(RAIL_KEY)).toBe('icons');
		expect(initialRail(1920)).toBe('icons');
		saveRail('open');
		expect(initialRail(1024)).toBe('open');
	});

	it('ignores a stored value it does not know', () => {
		localStorage.setItem(RAIL_KEY, 'wide');
		expect(initialRail(1024)).toBe('icons');
	});

	it('still works when the browser blocks its store', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(initialRail(1600)).toBe('open');
		expect(() => saveRail('icons')).not.toThrow();
	});
});

describe('Inbox page range ("1–20 of about 132")', () => {
	it('says where the page sits, and the total only when Gmail’s estimate makes sense', () => {
		expect(pageRange(0, 20, 20, 132)).toEqual({ start: 1, end: 20, total: 132 });
		expect(pageRange(1, 20, 20, 132)).toEqual({ start: 21, end: 40, total: 132 });
		expect(pageRange(2, 20, 5, 30)).toEqual({ start: 41, end: 45, total: null });
		expect(pageRange(0, 0, 7, null)).toEqual({ start: 1, end: 7, total: null });
	});

	it('says nothing for an empty list', () => {
		expect(pageRange(0, 20, 0, 132)).toBeNull();
	});
});
