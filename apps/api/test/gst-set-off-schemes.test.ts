import { BadRequestException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GstReturnDraft } from '@saha-textile/contracts';
import { setOff, type TaxHeads } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { GstSetOffController } from '../src/gst/gst-set-off.controller';
import { GstSetOffService } from '../src/gst/gst-set-off.service';

/**
 * Paying the other taxpayers' returns (accounts brief G1–G3, G7): PMT-06 into the GST cash ledger, CMP-08's composition
 * tax booked and paid, a QRMP GSTR-3B paid from its deposits first, and an ISD's GSTR-6 distribution.
 */

const at = '2026-12-18T06:00:00.000Z';
const GSTIN = '19DBYPS6736R1ZZ';
const refusal = (code: string) => ({ response: { message: code } });
const heads = (igst: number, cgst: number, sgst: number): TaxHeads => ({ igst, cgst, sgst });
const NONE = heads(0, 0, 0);

/** A set-off with only cash to pay, as PMT-06 and CMP-08 keep it. */
const cashOnly = (cash: TaxHeads, reverseChargeCash = NONE) => ({ ...setOff(NONE, NONE), cash, reverseChargeCash });

const draft = (over: Partial<GstReturnDraft> = {}): GstReturnDraft =>
	({
		id: 'gsr_1',
		gstRegistrationId: 'reg_wb',
		gstin: GSTIN,
		returnType: 'PMT-06',
		month: '2026-10',
		status: 'approved',
		summary: [],
		problems: [],
		portal: {},
		preparedBy: 'adm_acc',
		preparedAt: at,
		checkedBy: 'adm_acc',
		checkedAt: at,
		approvedBy: 'adm_ca',
		approvedAt: at,
		arn: null,
		filedOn: null,
		setOff: cashOnly(heads(10_000, 0, 0)),
		adjustments: [],
		setOffVoucherId: null,
		challanVoucherId: null,
		version: 3,
		...over,
	}) as GstReturnDraft;

const LOCATIONS = [
	{
		id: 'loc_bar',
		active: true,
		warehouse: true,
		shipsOnline: true,
		createdAt: '2026-01-01',
		gstRegistrationId: 'reg_wb',
	},
	{
		id: 'loc_tr',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-01-03',
		gstRegistrationId: 'reg_tr',
	},
	{
		id: 'loc_mum',
		active: true,
		warehouse: false,
		shipsOnline: false,
		createdAt: '2026-01-04',
		gstRegistrationId: 'reg_mum',
	},
];
const ROLE_LEDGERS: Record<string, string> = {
	gst_cash_ledger: 'led_gst_cash',
	composition_tax: 'led_comp_tax',
	composition_tax_payable: 'led_comp_payable',
};

const write = (over: Record<string, unknown> = {}) =>
	({ bankAccountId: 'bank_1', paidOn: '2026-12-18', challan: 'CPIN26120001', version: 3, ...over }) as never;
const ca = { userId: 'adm_ca', permissions: ['accounts.post'] } as never;

function build(options: { draft?: GstReturnDraft; saveFails?: unknown } = {}) {
	const posted: { kind: string; date: string; lines: unknown[] }[] = [];
	const ledger = {
		post: vi.fn(async (request: { kind: string; date: string; lines: unknown[] }) => {
			posted.push(request);
			return { id: `jv_${posted.length}`, number: `JV/26-27/00000${posted.length}` };
		}),
		ensureRoleLedger: vi.fn(
			async (role: string, _name: string, _group: string, _by: string | null) => ROLE_LEDGERS[role],
		),
	};
	const drafts = {
		save: vi.fn(async (next: GstReturnDraft, expectedVersion: number) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			return { ...next, version: expectedVersion + 1 };
		}),
	};
	const service = new GstSetOffService(
		{ get: async () => options.draft ?? draft() } as never,
		drafts as never,
		{ get: async () => ({ id: 'bank_1', ledgerId: 'led_hdfc' }) } as never,
		{ list: async () => LOCATIONS } as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
		ledger as never,
	);
	return { service, ledger, drafts, posted };
}

describe('paying a PMT-06 deposit', () => {
	it('pays the deposit into the GST cash ledger, made in the books the first time', async () => {
		const { service, ledger, posted } = build();
		const saved = await service.post('gsr_1', write(), ca);
		expect(ledger.ensureRoleLedger).toHaveBeenCalledWith(
			'gst_cash_ledger',
			'GST electronic cash ledger',
			'loans_and_advances',
			'adm_ca',
		);
		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({
			kind: 'payment',
			date: '2026-12-18',
			lines: [
				{ ledger: { id: 'led_gst_cash' }, locationId: 'loc_bar', debitPaise: 10_000 },
				{ ledger: { id: 'led_hdfc' }, locationId: 'loc_bar', creditPaise: 10_000 },
			],
		});
		expect(saved).toMatchObject({ setOffVoucherId: null, challanVoucherId: 'jv_1', expenseVoucherId: null });
	});

	it('refuses a deposit of nothing', async () => {
		const empty = build({ draft: draft({ setOff: cashOnly(NONE) }) });
		await expect(empty.service.post('gsr_1', write(), undefined)).rejects.toMatchObject(
			refusal('gst_set_off_nothing'),
		);
		expect(empty.ledger.ensureRoleLedger).toHaveBeenCalledWith(
			'gst_cash_ledger',
			'GST electronic cash ledger',
			'loans_and_advances',
			null,
		);
	});
});

describe('paying a CMP-08', () => {
	const cmp08 = (cash: TaxHeads, rcm: TaxHeads) =>
		draft({ returnType: 'CMP-08', month: '2026-12', setOff: cashOnly(cash, rcm) });

	it('books the quarter’s composition tax as an expense on its last day, then pays it with the reverse-charge tax', async () => {
		const { service, ledger, posted } = build({ draft: cmp08(heads(0, 7_500, 7_500), heads(0, 2_500, 2_500)) });
		const saved = await service.post('gsr_1', write(), ca);
		expect(ledger.ensureRoleLedger.mock.calls.map((c) => c.slice(0, 3))).toEqual([
			['composition_tax', 'Composition tax', 'indirect_expenses'],
			['composition_tax_payable', 'Composition tax payable', 'duties_and_taxes'],
		]);
		expect(posted[0]).toEqual({
			kind: 'journal',
			date: '2026-12-31',
			narration: `Composition tax on the quarter's turnover, CMP-08 2026-12 · ${GSTIN}`,
			source: { type: 'compositionTax', id: 'gsr_1', number: null },
			idempotencyKey: 'compositionTax:gsr_1',
			lines: [
				{ ledger: { id: 'led_comp_tax' }, locationId: 'loc_bar', debitPaise: 10_000 },
				{ ledger: { id: 'led_comp_payable' }, locationId: 'loc_bar', creditPaise: 10_000 },
			],
		});
		expect(posted[1]).toMatchObject({
			kind: 'payment',
			lines: [
				{ ledger: { id: 'led_comp_payable' }, locationId: 'loc_bar', debitPaise: 10_000 },
				{ ledger: { role: 'rcm_payable' }, locationId: 'loc_bar', debitPaise: 5_000 },
				{ ledger: { id: 'led_hdfc' }, locationId: 'loc_bar', creditPaise: 15_000 },
			],
		});
		expect(saved).toMatchObject({ expenseVoucherId: 'jv_1', challanVoucherId: 'jv_2', setOffVoucherId: null });
		expect(saved.challan).toMatchObject({ amountPaise: 15_000, challanNumber: 'JV/26-27/000002' });
	});

	it('books nothing when the quarter had no turnover, and pays no reverse-charge tax when there was none', async () => {
		const rcmOnly = build({ draft: cmp08(heads(1_800, 0, 0), heads(1_800, 0, 0)) });
		await rcmOnly.service.post('gsr_1', write(), ca);
		expect(rcmOnly.posted).toHaveLength(1);
		expect(rcmOnly.posted[0]?.lines).toEqual([
			{ ledger: { role: 'rcm_payable' }, locationId: 'loc_bar', debitPaise: 1_800 },
			{ ledger: { id: 'led_hdfc' }, locationId: 'loc_bar', creditPaise: 1_800 },
		]);

		const taxOnly = build({ draft: cmp08(heads(0, 5_000, 5_000), NONE) });
		await taxOnly.service.post('gsr_1', write(), ca);
		expect(taxOnly.posted[1]?.lines).toEqual([
			{ ledger: { id: 'led_comp_payable' }, locationId: 'loc_bar', debitPaise: 10_000 },
			{ ledger: { id: 'led_hdfc' }, locationId: 'loc_bar', creditPaise: 10_000 },
		]);
	});
});

describe('a QRMP quarter’s GSTR-3B paid from its PMT-06 deposits', () => {
	it('pays from the GST cash ledger first and the challan the rest', async () => {
		const quarter = {
			...setOff(heads(0, 2_500, 2_500), heads(0, 900, 900)),
			reverseChargeCash: NONE,
			deposited: heads(0, 1_000, 1_000),
		};
		const { service, ledger, posted } = build({
			draft: draft({ returnType: 'GSTR-3B', month: '2026-12', setOff: quarter }),
		});
		await service.post('gsr_1', write(), ca);
		expect(ledger.ensureRoleLedger).toHaveBeenCalledTimes(1);
		expect(posted[0]?.lines).toContainEqual({
			ledger: { id: 'led_gst_cash' },
			locationId: 'loc_bar',
			creditPaise: 2_000,
		});
		expect(posted[1]?.lines).toContainEqual({
			ledger: { id: 'led_hdfc' },
			locationId: 'loc_bar',
			creditPaise: 1_200,
		});
	});
});

describe('posting an ISD’s distribution (GSTR-6)', () => {
	const share = (registrationId: string, credit: TaxHeads, from: TaxHeads, n: number) => ({
		registrationId,
		gstin: `GSTIN-${registrationId}`,
		ratioPercent: 50,
		credit,
		from,
		invoiceNumber: `ISD2611-${n}`,
	});
	const SHARES = [
		share('reg_tr', heads(300, 600, 600), heads(300, 600, 600), 1),
		// In another State: the ISD's CGST and SGST reach it as IGST.
		share('reg_mum', heads(1_500, 0, 0), heads(300, 600, 600), 2),
	];
	const gstr6 = (over: Partial<GstReturnDraft> = {}) =>
		draft({ returnType: 'GSTR-6', month: '2026-11', setOff: null, isdShares: SHARES, ...over });

	it('moves the credit from the ISD’s input tax to each GSTIN’s at the month’s end, once, and keeps the voucher', async () => {
		const { service, drafts, posted } = build({ draft: gstr6({ status: 'filed' }) });
		const saved = await service.distribute('gsr_1', { version: 3 }, ca);
		expect(posted).toEqual([
			{
				kind: 'journal',
				date: '2026-11-30',
				narration: `ISD distribution, GSTR-6 2026-11 · ${GSTIN} (rule 39)`,
				source: { type: 'isdDistribution', id: 'gsr_1', number: null },
				idempotencyKey: 'isdDistribution:gsr_1',
				lines: [
					{ ledger: { role: 'input_igst' }, locationId: 'loc_tr', debitPaise: 300 },
					{ ledger: { role: 'input_igst' }, locationId: 'loc_bar', creditPaise: 300 },
					{ ledger: { role: 'input_cgst' }, locationId: 'loc_tr', debitPaise: 600 },
					{ ledger: { role: 'input_cgst' }, locationId: 'loc_bar', creditPaise: 600 },
					{ ledger: { role: 'input_sgst' }, locationId: 'loc_tr', debitPaise: 600 },
					{ ledger: { role: 'input_sgst' }, locationId: 'loc_bar', creditPaise: 600 },
					{ ledger: { role: 'input_igst' }, locationId: 'loc_mum', debitPaise: 1_500 },
					{ ledger: { role: 'input_igst' }, locationId: 'loc_bar', creditPaise: 300 },
					{ ledger: { role: 'input_cgst' }, locationId: 'loc_bar', creditPaise: 600 },
					{ ledger: { role: 'input_sgst' }, locationId: 'loc_bar', creditPaise: 600 },
				],
			},
		]);
		expect(drafts.save).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'approved', arn: null, filedOn: null, distributionVoucherId: 'jv_1' }),
			3,
		);
		expect(saved.version).toBe(4);
		const unsigned = build({ draft: gstr6() });
		await unsigned.service.distribute('gsr_1', { version: 3 }, undefined);
		expect(unsigned.ledger.post).toHaveBeenCalledWith(expect.anything(), { session: 'tx' }, null);
		expect(unsigned.drafts.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }), 3);
	});

	it('refuses what isn’t an approved GSTR-6 with shares, once, at the version read', async () => {
		const refused = (over: Partial<GstReturnDraft>, version: number, code: string) =>
			expect(build({ draft: gstr6(over) }).service.distribute('gsr_1', { version }, ca)).rejects.toMatchObject(
				refusal(code),
			);
		await refused({ returnType: 'GSTR-3B' }, 3, 'gst_distribution_not_isd');
		await refused({ isdShares: null }, 3, 'gst_distribution_not_isd');
		await refused({ isdShares: [] }, 3, 'gst_distribution_not_isd');
		await refused({ status: 'checked' }, 3, 'gst_set_off_not_approved');
		await refused({ distributionVoucherId: 'jv_old' }, 3, 'gst_set_off_posted');
		await expect(build({ draft: gstr6() }).service.distribute('gsr_1', { version: 2 }, ca)).rejects.toBeInstanceOf(
			ConflictException,
		);
		const nothing = [share('reg_tr', NONE, NONE, 1)];
		await expect(
			build({ draft: gstr6({ isdShares: nothing }) }).service.distribute('gsr_1', { version: 3 }, ca),
		).rejects.toBeInstanceOf(BadRequestException);
		await refused({ isdShares: nothing }, 3, 'gst_set_off_nothing');
	});

	it('answers someone saving the return first as a conflict, and passes on any other failure', async () => {
		const changed = build({ draft: gstr6(), saveFails: new Error('gst_draft_changed') });
		await expect(changed.service.distribute('gsr_1', { version: 3 }, ca)).rejects.toMatchObject({
			response: { message: 'gst_draft_changed' },
		});
		await expect(changed.service.distribute('gsr_1', { version: 3 }, ca)).rejects.toBeInstanceOf(ConflictException);
		const down = new Error('disk full');
		await expect(
			build({ draft: gstr6(), saveFails: down }).service.distribute('gsr_1', { version: 3 }, ca),
		).rejects.toBe(down);
		await expect(
			build({ draft: gstr6(), saveFails: 'odd' }).service.distribute('gsr_1', { version: 3 }, ca),
		).rejects.toBe('odd');
	});

	it('is a route of its own with accounts.post', () => {
		const setOffService = { distribute: vi.fn((...args: unknown[]) => ['distribute', ...args]) };
		const controller = new GstSetOffController(setOffService as never);
		expect(controller.distribute('gsr_1', { version: 3 }, ca)).toEqual(['distribute', 'gsr_1', { version: 3 }, ca]);
		expect(new Reflector().get(PERMISSIONS_KEY, GstSetOffController.prototype.distribute)).toEqual([
			'accounts.post',
		]);
	});
});
