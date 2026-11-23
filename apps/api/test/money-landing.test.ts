import { MoneyLanding } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { MoneyLandingController, MoneyLandingService } from '../src/ledger/money-landing';

/** Where money lands (Postings and Convert brief AP1, AP-D1). */

const chart = {
	groups: [
		{ id: 'g_bank', systemKey: 'bank_accounts', roles: [], parentId: null },
		{ id: 'g_cash', systemKey: 'cash_in_hand', roles: [], parentId: null },
		{ id: 'g_other', systemKey: null, roles: [], parentId: null },
	],
	ledgers: [
		{ id: 'led_hdfc', groupId: 'g_bank', active: true, systemKey: null, roles: [] },
		{ id: 'led_cash', groupId: 'g_cash', active: true, systemKey: 'cash', roles: [] },
		{ id: 'led_rent', groupId: 'g_other', active: true, systemKey: 'rent', roles: [] },
		{ id: 'led_old', groupId: 'g_bank', active: false, systemKey: null, roles: [] },
	],
};

function setup() {
	let stored = MoneyLanding.parse({});
	const store = {
		get: async () => stored,
		save: async (next: MoneyLanding, expected: string | null) => {
			if (expected !== stored.updatedAt) throw new Error('money_landing_changed');
			stored = next;
		},
	};
	const service = new MoneyLandingService(store, { chart: async () => chart } as never);
	return { service, store };
}
const write = (patch: Record<string, unknown> = {}) => ({
	receivedByGateway: null,
	receivedByUpi: null,
	receivedByBank: null,
	cashOnDelivery: null,
	paidByBank: null,
	paidInCash: null,
	...patch,
});

describe('where money lands', () => {
	it('saves a bank account for bank money and a cash ledger for cash, and refuses the wrong kind', async () => {
		const { service } = setup();
		const now = new Date('2026-11-24T10:00:00.000Z');
		const saved = await service.save(
			write({
				receivedByBank: 'led_hdfc',
				paidByBank: 'led_hdfc',
				paidInCash: 'led_cash',
				receivedByUpi: 'led_rent',
			}),
			'adm_owner',
			now,
		);
		expect(saved).toMatchObject({
			receivedByBank: 'led_hdfc',
			updatedBy: 'adm_owner',
			updatedAt: now.toISOString(),
		});
		expect(await service.get()).toEqual(saved);
		for (const patch of [
			{ receivedByBank: 'led_cash' },
			{ paidInCash: 'led_hdfc' },
			{ receivedByGateway: 'led_old' },
			{ paidByBank: 'led_none' },
		])
			await expect(service.save(write(patch), null)).rejects.toThrow('money_landing_wrong_ledger');
	});

	it('refuses a save over a newer one, and serves the setting', async () => {
		const { service, store } = setup();
		const raced = { ...store, get: async () => MoneyLanding.parse({ updatedAt: 'stale' }) };
		const stale = new MoneyLandingService(raced, { chart: async () => chart } as never);
		await expect(stale.save(write(), null)).rejects.toThrow('money_landing_changed');
		const routes = new MoneyLandingController(service);
		expect(
			(await routes.save(write({ paidInCash: 'led_cash' }), { userId: 'adm_owner' } as never)).paidInCash,
		).toBe('led_cash');
		expect((await routes.save(write(), undefined)).updatedBy).toBeNull();
		expect((await routes.get()).paidInCash).toBeNull();
	});
});
