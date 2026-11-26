import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { BusinessesService } from '../src/orders-setup/businesses.service';

const write = {
	legalName: 'Nila Traders',
	tradeName: 'Nila',
	businessType: 'proprietorship' as const,
	gstin: null,
	pan: null,
	stateCode: '99',
	registeredAddress: { line: '1 Road', city: 'Kolkata', pin: '700001' },
	contacts: [{ name: 'Rina', email: null, mobile: null, isAccounts: false }],
	sellsToUs: false,
	customer: null,
	notes: null,
	active: true,
};

const customerRole = {
	zoneId: 'zone_retail',
	creditLimitINR: 50_000,
	creditDays: 15,
	standing: 'active',
	standingReason: null,
	standingBy: null,
	standingAt: null,
};

interface Setup {
	zones?: Array<Record<string, unknown>>;
	stored?: Record<string, unknown> | null;
	rows?: { receivable: unknown[]; payable: unknown[] };
	found?: unknown[];
}

function setup(options: Setup = {}) {
	let stored = options.stored === undefined ? null : options.stored;
	const appended: Array<Record<string, unknown>> = [];
	const zones = options.zones ?? [
		{ id: 'zone_retail', code: 'RETAIL', name: 'Retail', status: 'live' },
		{ id: 'zone_w', code: 'W', name: 'Wholesale', status: 'live' },
		{ id: 'zone_old', code: 'OLD', name: 'Old', status: 'archived' },
	];
	const service = new BusinessesService(
		{
			save: async (business: Record<string, unknown>) => {
				stored = { ...business, revision: Number(business['revision'] ?? 0) + 1 };
				return stored;
			},
			findById: async () => stored,
			list: async () => ({
				items: [{ id: 'biz_1', legalName: 'Nila', roles: { supplier: false, customer: null }, active: true }],
				total: 1,
				counts: { customer: 1 },
			}),
			searchBuyers: async () => options.found ?? [],
		} as never,
		{
			balance: async () => 0,
			list: async (_id: string, side: 'receivable' | 'payable') => ({
				rows: (options.rows ?? { receivable: [], payable: [] })[side],
				total: 0,
				openingINR: 0,
			}),
			append: async (entry: Record<string, unknown>) => {
				appended.push(entry);
				return entry;
			},
		} as never,
		{
			findById: async (id: string) => zones.find((zone) => zone.id === id) ?? null,
			list: async () => zones,
		} as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({ outer: false }) } as never,
		{ issue: async (kind: string) => (kind === 'receipt' ? 'RC/26-27/000002' : 'JV/26-27/000003') } as never,
	);
	return { service, appended, current: () => stored };
}

describe('businesses: the last cases', () => {
	it('lists a business that sells nothing to us at nothing owed, and counts missing tabs as none', async () => {
		const page = await setup().service.list({ role: 'all', page: 1, pageSize: 10 } as never);
		expect(page.items[0]).toMatchObject({ weOweINR: 0, sellsToUs: false });
		expect(page.counts).toEqual({ all: 0, customer: 1, supplier: 0, both: 0, creditOnHold: 0, blocked: 0 });
	});

	it('answers "not found" for a business that does not exist', async () => {
		await expect(setup().service.get('biz_none')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('shows a buyer’s accounts phone, and a zone named Retail when no zone is known at all', async () => {
		const { service } = setup({
			zones: [],
			found: [
				{
					id: 'biz_1',
					legalName: 'Nila',
					tradeName: null,
					gstin: null,
					contacts: [{ isAccounts: true, mobile: { countryCallingCode: '91', number: '9830012345' } }],
					roles: { supplier: false, customer: customerRole },
				},
			],
		});
		expect(await service.searchBuyers('nila', 5)).toEqual([
			expect.objectContaining({
				phone: '+91 9830012345',
				zone: { id: 'zone_retail', code: 'RETAIL', name: 'Retail' },
			}),
		]);
	});

	it('creates a business that only we know about: no PAN, no state name, not a buyer', async () => {
		const { service } = setup();
		const created = await service.create(write as never, null, false, false);
		expect(created).toMatchObject({ pan: null, stateName: '', roles: { supplier: false, customer: null } });
	});

	it('turns a business into a buyer, in a new zone, with credit set by someone who may, or none otherwise', async () => {
		const { service } = setup({ stored: null });
		const made = await service.create(write as never, 'adm', true, true);
		const buyer = await service.update(
			made.id,
			{
				...write,
				revision: 1,
				stateCode: '98',
				customer: { zoneId: 'zone_w', creditLimitINR: 90_000, creditDays: 45 },
			} as never,
			'adm',
			true,
			true,
		);
		expect(buyer).toMatchObject({ stateName: '' });
		expect(buyer.roles.customer).toMatchObject({ zoneId: 'zone_w', creditLimitINR: 90_000, creditDays: 45 });
		const plain = setup({ stored: { ...made, roles: { supplier: false, customer: null } } });
		const noCredit = await plain.service.update(
			made.id,
			{
				...write,
				revision: 1,
				customer: { zoneId: 'zone_retail', creditLimitINR: 90_000, creditDays: 45 },
			} as never,
			'adm',
			false,
			false,
		);
		expect(noCredit.roles.customer).toMatchObject({ creditLimitINR: 0, creditDays: 0, standing: 'active' });
	});

	it('refuses a zone that does not exist or was archived', async () => {
		const { service } = setup();
		const buyer = { ...write, customer: { zoneId: 'zone_none', creditLimitINR: 0, creditDays: 0 } };
		await expect(service.create(buyer as never, 'adm', true, true)).rejects.toBeInstanceOf(BadRequestException);
		const archived = { ...write, customer: { zoneId: 'zone_old', creditLimitINR: 0, creditDays: 0 } };
		await expect(service.create(archived as never, 'adm', true, true)).rejects.toMatchObject({
			response: { issues: [{ code: 'zone_unknown' }] },
		});
	});

	it('takes receipts only from a buyer, inside the caller’s transaction when given, booked by "system" without a name', async () => {
		const seller = setup({ stored: { id: 'biz_1', roles: { supplier: true, customer: null } } });
		await expect(
			seller.service.recordReceipt('biz_1', { amountINR: 100, receivedOn: '2026-11-20' } as never, null),
		).rejects.toBeInstanceOf(ConflictException);
		const buyer = setup({ stored: { id: 'biz_1', roles: { supplier: false, customer: customerRole } } });
		const entry = await buyer.service.recordReceipt(
			'biz_1',
			{ amountINR: 100, receivedOn: '2026-11-20', method: 'upi', reference: null, note: null } as never,
			null,
			{ outer: true } as never,
		);
		expect(entry).toMatchObject({ amountINR: -100, by: 'system', documentNumber: 'RC/26-27/000002' });
	});

	it('reverses a set-off found on either side, booked by "system", and refuses one that does not exist', async () => {
		const setOff = (id: string, side: string) => ({
			id,
			businessId: 'biz_1',
			side,
			kind: 'setOff',
			amountINR: -500,
			documentType: 'journal',
			documentId: 'jv_1',
			documentNumber: 'JV/26-27/000001',
			note: null,
			reversalOf: null,
			agreement: null,
			at: '2026-11-20T10:00:00.000Z',
			by: 'adm',
		});
		const { service, appended } = setup({
			stored: { id: 'biz_1' },
			rows: { receivable: [setOff('led_r', 'receivable')], payable: [setOff('led_p', 'payable')] },
		});
		await expect(service.reverseSetOff('biz_1', 'jv_none', 'wrong', null)).rejects.toMatchObject({
			response: { issues: [{ code: 'setoff_missing' }] },
		});
		await service.reverseSetOff('biz_1', 'jv_1', 'entered twice', null);
		expect(appended.map((entry) => [entry['side'], entry['amountINR'], entry['by']])).toEqual([
			['receivable', 500, 'system'],
			['payable', 500, 'system'],
		]);
	});

	it('records a one-off agreed set-off on the day it was agreed, booked by "system" without a name', async () => {
		const { service, appended } = setup({ stored: { id: 'biz_1', setOff: { mode: 'never' } } });
		Object.assign(service, {
			ledger: {
				balance: async () => 1_000,
				append: async (entry: Record<string, unknown>) => {
					appended.push(entry);
					return entry;
				},
			},
		});
		await service.recordSetOff(
			'biz_1',
			{
				amountINR: 400,
				on: '2026-11-20',
				note: 'Agreed by letter',
				basis: { kind: 'oneOff', reference: 'Letter 7', signedOn: '2026-11-19', mediaId: 'med_7' },
			} as never,
			null,
		);
		expect(appended[0]).toMatchObject({
			agreement: { reference: 'Letter 7', signedOn: '2026-11-19', mediaId: 'med_7' },
			at: '2026-11-20T18:29:59.999Z',
			by: 'system',
		});
	});
});
