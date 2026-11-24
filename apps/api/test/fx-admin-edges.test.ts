import { ConflictException } from '@nestjs/common';
import type { Currency } from '@saha-textile/contracts';
import type { SiteSettingsRepository } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { FxAdminService } from '../src/fx/fx-admin.service';

const currency = (code: string, inrPerUnit: number, over: Partial<Currency> = {}): Currency => ({
	code,
	symbol: code,
	enabled: true,
	rateFromINR: 1 / inrPerUnit,
	paypalActive: true,
	paypalPct: 0,
	paypalFixed: 0,
	rateSetBy: 'fetch',
	rateSetById: null,
	rateSetAt: '2026-11-19T07:00:00.000Z',
	...over,
});

function memory(initial: Currency[] = []) {
	const rows = new Map(initial.map((c) => [c.code, c]));
	const store = new Map<string, unknown>();
	const settings = {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
	};
	return {
		currencies: {
			listAll: async () => [...rows.values()],
			listEnabled: async () => [...rows.values()].filter((c) => c.enabled),
			findByCode: async (code: string) => rows.get(code) ?? null,
			upsert: vi.fn(async (c: Currency) => (rows.set(c.code, c), c)),
		},
		// The port's methods are generic over the setting key; the test store is not.
		settings: settings as typeof settings & Pick<SiteSettingsRepository, 'get' | 'set'>,
		rows,
		store,
	};
}

const harness = (initial: Currency[] = [], options: { superAdmin?: boolean; rates?: Record<string, number> } = {}) => {
	const repo = memory(initial);
	const fx = {
		usesKey: false,
		getAllRatesFromINR: vi.fn(async () => options.rates ?? { USD: 1 / 88.42, GBP: 1 / 116.95 }),
		getRateFromINR: vi.fn(),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const service = new FxAdminService(
		repo.settings as never,
		repo.currencies as never,
		fx,
		{ findByKey: async () => ({ id: 'role-super' }) } as never,
		{ findActive: async () => (options.superAdmin ? { id: 'a' } : null) } as never,
		{ findById: async (id: string) => (id === 'admin-1' ? { displayName: 'Moulik Patra' } : null) } as never,
		audit as never,
	);
	return { service, repo, fx, audit };
};

describe('Admin › Currencies: the remaining cases', () => {
	it('lets nobody signed out change the markup, and names nobody for a rate set by someone unknown, with no date', async () => {
		const { service } = harness([
			currency('USD', 88.42, { rateSetBy: 'staff', rateSetById: 'admin-gone', rateSetAt: null }),
		]);
		const overview = await service.overview(null);
		expect(overview.canEditMarkup).toBe(false);
		expect(overview.currencies.find((row) => row.code === 'USD')).toMatchObject({ setByName: null, setAt: null });
	});

	it('refuses a stale save, naming who saved last when it can', async () => {
		const { service } = harness([], { superAdmin: true });
		const first = await service.overview('admin-1');
		const write = { ...first.settings, dailyFetch: { enabled: false, time: '07:00' } } as never;
		await service.saveSettings(write, 'admin-gone');
		const stale = service.saveSettings(write, 'admin-1');
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await stale.catch((error: ConflictException) =>
			expect(error.getResponse()).toMatchObject({
				issues: [expect.objectContaining({ code: 'stale_revision' })],
			}),
		);
	});

	it('adds a currency outside the launch list under its own code, and switches one on without a new rate', async () => {
		const { service, repo } = harness([
			currency('USD', 88.42, { rateSetBy: null, rateSetById: null, rateSetAt: null, enabled: false }),
		]);
		await service.setRate('chf', { inrPerUnit: 98, enabled: true } as never, 'admin-1');
		expect(repo.rows.get('CHF')).toMatchObject({ symbol: 'CHF', rateSetBy: 'staff', enabled: true });
		await service.setRate('USD', { enabled: true } as never, 'admin-1');
		expect(repo.rows.get('USD')).toMatchObject({
			enabled: true,
			rateSetBy: null,
			rateSetById: null,
			rateSetAt: null,
		});
	});

	it('records nothing when there is no audit store', async () => {
		const { service, audit } = harness([currency('USD', 88.42)]);
		Object.defineProperty(service, 'audit', { value: null });
		await service.setRate('USD', { enabled: false } as never, 'admin-1');
		expect(audit.append).not.toHaveBeenCalled();
	});
});
