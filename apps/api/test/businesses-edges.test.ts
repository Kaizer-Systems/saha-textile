import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { BusinessesService } from '../src/orders-setup/businesses.service';

const write = {
	legalName: 'Boutique Ltd',
	tradeName: 'Boutique',
	businessType: 'privateLimited' as const,
	kind: 'regular' as const,
	gstin: '27AAPFU0939F1ZV',
	pan: null,
	stateCode: '27',
	registeredAddress: { line: '1 Road', city: 'Mumbai', pin: '400001' },
	contacts: [{ name: 'Rina', email: null, mobile: null, isAccounts: true }],
	sellsToUs: true,
	customer: { zoneId: 'zone_w', creditLimitINR: 200000, creditDays: 30 },
	supplier: null,
	notes: null,
	active: true,
};

async function setup(options: { purchases?: boolean; balances?: { receivable: number; payable: number } } = {}) {
	const saved: Array<Record<string, unknown>> = [];
	const balances = options.balances ?? { receivable: 500, payable: 200 };
	const zones = new Map([
		['zone_retail', { id: 'zone_retail', code: 'RETAIL', name: 'Retail', status: 'live' }],
		['zone_w', { id: 'zone_w', code: 'W', name: 'Wholesale', status: 'live' }],
	]);
	const service = new BusinessesService(
		{
			save: async (business: Record<string, unknown>, _revision: number | null) => {
				const next = { ...business, revision: Number(business['revision'] ?? 0) + 1 };
				saved.push(next);
				return next;
			},
			findById: async () => saved.at(-1) ?? null,
			list: async () => ({
				items: saved
					.slice(-1)
					.concat([
						{ ...saved.at(-1), id: 'biz_seller', roles: { supplier: true, customer: null } } as never,
					]),
				total: 2,
				counts: { all: 2, supplier: 1 },
			}),
			searchBuyers: async () => [
				saved.at(-1),
				{
					...saved.at(-1),
					id: 'biz_other_zone',
					contacts: [],
					roles: {
						supplier: false,
						customer: {
							zoneId: 'zone_gone',
							creditLimitINR: 1000,
							creditDays: 0,
							standing: 'active',
							standingReason: null,
							standingBy: null,
							standingAt: null,
						},
					},
				},
				{ ...saved.at(-1), id: 'biz_seller', roles: { supplier: true, customer: null } },
			],
		} as never,
		{
			balance: async (_id: string, side: 'receivable' | 'payable') => balances[side],
			list: async () => ({
				rows: [
					{ id: 'l1', amountINR: 300 },
					{ id: 'l2', amountINR: -100 },
				],
				total: 2,
				openingINR: 50,
			}),
		} as never,
		{ findById: async (id: string) => zones.get(id) ?? null, list: async () => [...zones.values()] } as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
		{ issue: async () => 'RC/26-27/000001' } as never,
		null,
		options.purchases
			? ({
					forSupplier: async () => [
						{ status: 'posted', totals: { totalINR: 1000 }, paidINR: 400, credits: [] },
						{ status: 'draft', totals: { totalINR: 9999 }, paidINR: 0 },
					],
				} as never)
			: null,
	);
	const created = await service.create(write as never, 'adm', true, true);
	return { service, saved, created };
}

describe('businesses: lists, buyers and balances', () => {
	it('lists a buyer with its zone and credit, and a seller with what we owe it from its bills', async () => {
		const { service } = await setup({ purchases: true });
		const page = await service.list({ role: 'all', page: 1, pageSize: 10 } as never);
		expect(page.items[0]).toMatchObject({
			buysFromUs: true,
			zone: { code: 'W' },
			creditLimitINR: 200000,
			creditUsedINR: 500,
			owesUsINR: 500,
			standing: 'active',
		});
		expect(page.items[1]).toMatchObject({
			buysFromUs: false,
			zone: null,
			creditLimitINR: null,
			creditUsedINR: null,
			standing: null,
			weOweINR: 800,
		});
		expect(page.counts).toEqual({ all: 2, customer: 0, supplier: 1, both: 0, creditOnHold: 0, blocked: 0 });
	});

	it('counts only our own payable entries when purchases are not wired in', async () => {
		const { service } = await setup();
		expect(await service.payableINR('biz_1')).toBe(200);
		expect(await service.receivableINR('biz_1')).toBe(500);
	});

	it('finds buyers only, on RETAIL when their zone is gone, with the accounts contact’s phone or none', async () => {
		const { service } = await setup();
		const buyers = await service.searchBuyers('bout', 5);
		expect(buyers.map((row) => [row.id, row.zone.code, row.phone])).toEqual([
			[expect.stringMatching(/^biz_/), 'W', null],
			['biz_other_zone', 'RETAIL', null],
		]);
		expect(buyers[0]?.creditAvailableINR).toBe(199500);
	});
});

describe('businesses: changes', () => {
	it('needs the revision that was edited, and keeps credit as it was for someone who may not set it', async () => {
		const { service, created } = await setup();
		await expect(service.update(created.id, { ...write } as never, 'adm', true, false)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		const kept = await service.update(
			created.id,
			{ ...write, revision: 1, customer: { zoneId: 'zone_w', creditLimitINR: 1, creditDays: 1 } } as never,
			'adm',
			false,
			false,
		);
		expect(kept.roles.customer).toMatchObject({
			zoneId: 'zone_w',
			creditLimitINR: 200000,
			creditDays: 30,
			standing: 'active',
		});
		const dropped = await service.update(
			created.id,
			{ ...write, revision: 2, customer: null, pan: null } as never,
			'adm',
			true,
			true,
		);
		expect(dropped.roles.customer).toBeNull();
	});

	it('sets standing and zone only for a business that buys from us', async () => {
		const { service, created } = await setup();
		const held = await service.setStanding(
			created.id,
			{ standing: 'creditOnHold', reason: 'late' } as never,
			'adm',
		);
		expect(held.roles.customer).toMatchObject({
			standing: 'creditOnHold',
			standingReason: 'late',
			standingBy: 'adm',
		});
		expect((await service.setZone(created.id, 'zone_retail', 'adm')).roles.customer?.zoneId).toBe('zone_retail');
		await service.update(created.id, { ...write, revision: 3, customer: null } as never, 'adm', true, true);
		await expect(
			service.setStanding(created.id, { standing: 'blocked', reason: null } as never, 'adm'),
		).rejects.toBeInstanceOf(ConflictException);
		await expect(service.setZone(created.id, 'zone_w', 'adm')).rejects.toBeInstanceOf(ConflictException);
	});

	it('runs a statement’s balance from its opening, the payable side from unpaid bills', async () => {
		const { service, created } = await setup({ purchases: true });
		expect(
			await service.statement(created.id, { side: 'receivable', page: 1, pageSize: 10 } as never),
		).toMatchObject({
			openingINR: 50,
			closingINR: 250,
			rows: [{ balanceINR: 350 }, { balanceINR: 250 }],
		});
		expect(
			(await service.statement(created.id, { side: 'payable', page: 1, pageSize: 10 } as never)).openingINR,
		).toBe(650);
	});

	it('saves the set-off setting', async () => {
		const { service, created } = await setup();
		expect((await service.setSetOff(created.id, { mode: 'never' } as never, 'adm')).setOff).toEqual({
			mode: 'never',
		});
	});
});
