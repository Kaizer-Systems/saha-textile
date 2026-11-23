import { describe, expect, it } from 'vitest';

import { defaultStockLocation } from '../src/locations/stock-location';

const loc = (
	id: string,
	patch: { active?: boolean; warehouse?: boolean; shipsOnline?: boolean; createdAt?: string } = {},
) => ({
	id,
	active: patch.active ?? true,
	warehouse: patch.warehouse ?? true,
	shipsOnline: patch.shipsOnline ?? false,
	createdAt: patch.createdAt ?? '2026-11-23T00:00:00.000Z',
});

describe('default stock location (accounts brief F4)', () => {
	it('picks the first active warehouse that ships online, else the first active warehouse', () => {
		expect(
			defaultStockLocation([
				loc('store', { createdAt: '2026-11-01T00:00:00.000Z' }),
				loc('online', { shipsOnline: true, createdAt: '2026-11-05T00:00:00.000Z' }),
			]),
		).toBe('online');
		expect(
			defaultStockLocation([
				loc('b', { createdAt: '2026-11-02T00:00:00.000Z' }),
				loc('a', { createdAt: '2026-11-01T00:00:00.000Z' }),
			]),
		).toBe('a');
		expect(
			defaultStockLocation([
				loc('office', { warehouse: false }),
				loc('off', { active: false, shipsOnline: true }),
			]),
		).toBeNull();
	});
});
