import { describe, expect, it } from 'vitest';

import {
	STOREFRONT_VISIBLE_PRODUCT_STATUSES,
	discontinuationPurgeDueAt,
	isDiscontinuationPurgeDue,
	isSearchIndexable,
	isStorefrontVisible,
	resolveProductStatusFilter,
} from '../src/index';

/** Owner-locked retention window; passed in as config, never hardcoded in the domain. */
const RETENTION_DAYS = 30;

describe('storefront visibility', () => {
	it('exposes only `live`', () => {
		expect(STOREFRONT_VISIBLE_PRODUCT_STATUSES).toEqual(['live']);
		expect(isStorefrontVisible('live')).toBe(true);
		for (const status of ['draft', 'disabled', 'discontinued'] as const) {
			expect(isStorefrontVisible(status)).toBe(false);
		}
	});

	it('keeps the search index aligned with the visible set', () => {
		expect(isSearchIndexable('live')).toBe(true);
		expect(isSearchIndexable('disabled')).toBe(false);
		expect(isSearchIndexable('discontinued')).toBe(false);
	});
});

describe('resolveProductStatusFilter', () => {
	it('defaults to the visible set when no audience is supplied (fails closed)', () => {
		expect(resolveProductStatusFilter()).toEqual(['live']);
		expect(resolveProductStatusFilter('public')).toEqual(['live']);
	});

	it('lets a public caller narrow within the visible set', () => {
		expect(resolveProductStatusFilter('public', 'live')).toEqual(['live']);
	});

	it('returns an empty allow-list when a public caller asks for a hidden status', () => {
		for (const status of ['draft', 'disabled', 'discontinued'] as const) {
			expect(resolveProductStatusFilter('public', status)).toEqual([]);
		}
	});

	it('lets an admin caller see everything or one chosen status', () => {
		expect(resolveProductStatusFilter('admin')).toBeUndefined();
		expect(resolveProductStatusFilter('admin', 'draft')).toEqual(['draft']);
		expect(resolveProductStatusFilter('admin', 'discontinued')).toEqual(['discontinued']);
	});
});

describe('discontinuation retention', () => {
	const discontinuedAt = new Date('2026-07-01T00:00:00.000Z');

	it('computes the purge date from the configured window', () => {
		expect(discontinuationPurgeDueAt(discontinuedAt, RETENTION_DAYS)?.toISOString()).toBe(
			'2026-07-31T00:00:00.000Z',
		);
	});

	it('accepts an ISO string as well as a Date', () => {
		expect(discontinuationPurgeDueAt('2026-07-01T00:00:00.000Z', RETENTION_DAYS)?.toISOString()).toBe(
			'2026-07-31T00:00:00.000Z',
		);
	});

	it('returns null for a product that was never discontinued', () => {
		expect(discontinuationPurgeDueAt(null, RETENTION_DAYS)).toBeNull();
		expect(discontinuationPurgeDueAt(undefined, RETENTION_DAYS)).toBeNull();
		expect(isDiscontinuationPurgeDue(null, RETENTION_DAYS, new Date())).toBe(false);
	});

	it('is not due before the window elapses, and is due on the boundary', () => {
		expect(isDiscontinuationPurgeDue(discontinuedAt, RETENTION_DAYS, new Date('2026-07-30T23:59:59.999Z'))).toBe(
			false,
		);
		expect(isDiscontinuationPurgeDue(discontinuedAt, RETENTION_DAYS, new Date('2026-07-31T00:00:00.000Z'))).toBe(
			true,
		);
		expect(isDiscontinuationPurgeDue(discontinuedAt, RETENTION_DAYS, new Date('2026-08-15T00:00:00.000Z'))).toBe(
			true,
		);
	});

	it('follows a reconfigured window rather than a baked-in 30 days', () => {
		expect(discontinuationPurgeDueAt(discontinuedAt, 7)?.toISOString()).toBe('2026-07-08T00:00:00.000Z');
		expect(discontinuationPurgeDueAt(discontinuedAt, 0)?.toISOString()).toBe(discontinuedAt.toISOString());
	});

	it('rejects nonsense input rather than silently purging early', () => {
		expect(() => discontinuationPurgeDueAt(discontinuedAt, -1)).toThrow(RangeError);
		expect(() => discontinuationPurgeDueAt(discontinuedAt, Number.NaN)).toThrow(RangeError);
		expect(() => discontinuationPurgeDueAt('not-a-date', RETENTION_DAYS)).toThrow(RangeError);
	});
});
