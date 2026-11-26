import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { LedgerService } from '../src/ledger/ledger.service';

/**
 * The ledgers the other taxpayers' payments post to, found by role or made once (G2, QRMP: the GST cash ledger,
 * composition tax and its payable), and a quarterly return's filing locking all three of its months (G8).
 */

const GROUPS = [
	{ id: 'grp_loans_and_advances', systemKey: 'loans_and_advances', nature: 'asset' },
	{ id: 'grp_duties_and_taxes', systemKey: 'duties_and_taxes', nature: 'liability' },
];
const terms = (from: string, scheme: string) => ({ from, kind: 'regular', scheme });

function build(options: { ledgers?: unknown[]; groups?: unknown[] } = {}) {
	const books = {
		seedChart: vi.fn(async () => undefined),
		chart: vi.fn(async () => ({ groups: options.groups ?? GROUPS, ledgers: options.ledgers ?? [] })),
		saveLedger: vi.fn(async () => undefined),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const gstReturns = { insert: vi.fn(async () => undefined) };
	const registrations: Record<string, unknown> = {
		reg_q: { id: 'reg_q', gstin: '19AAACQ1234A1Z5', terms: [terms('2026-04-01', 'qrmp')] },
		reg_m: { id: 'reg_m', gstin: '19AAACM1234A1Z5', terms: [terms('2026-04-01', 'monthly')] },
		// Registered only from 2027: no scheme in 2026.
		reg_new: { id: 'reg_new', gstin: '19AAACN1234A1Z5', terms: [terms('2027-04-01', 'qrmp')] },
	};
	const unused = {} as never;
	const service = new LedgerService(
		books as never,
		unused,
		unused,
		{ getRegistration: async (id: string) => registrations[id] ?? null } as never,
		unused,
		unused,
		audit as never,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		unused,
		gstReturns as never,
		unused,
		unused,
		{ startingChart: async () => ({ chart: { groups: [], ledgers: [] } }) } as never,
	);
	return { service, books, audit, gstReturns };
}

describe('a ledger playing a role', () => {
	it('is the active ledger with that role when the books have one', async () => {
		const { service, books } = build({
			ledgers: [
				{ id: 'led_old_cash', active: false, roles: ['gst_cash_ledger'] },
				{ id: 'led_gst_cash', active: true, roles: ['gst_cash_ledger'] },
			],
		});
		expect(
			await service.ensureRoleLedger(
				'gst_cash_ledger',
				'GST electronic cash ledger',
				'loans_and_advances',
				'adm_ca',
			),
		).toBe('led_gst_cash');
		expect(books.saveLedger).not.toHaveBeenCalled();
	});

	it('is made once in the group with the system key, with that role, and logged', async () => {
		const { service, books, audit } = build({
			ledgers: [{ id: 'led_gst_cash_off', active: false, roles: ['gst_cash_ledger'] }],
		});
		const id = await service.ensureRoleLedger(
			'composition_tax_payable',
			'Composition tax payable',
			'duties_and_taxes',
			'adm_ca',
		);
		expect(id).toMatch(/^led_/);
		expect(books.saveLedger).toHaveBeenCalledWith(
			expect.objectContaining({
				id,
				name: 'Composition tax payable',
				groupId: 'grp_duties_and_taxes',
				nature: 'liability',
				roles: ['composition_tax_payable'],
				active: true,
				updatedBy: 'adm_ca',
			}),
			null,
		);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'adm_ca',
				action: 'accounts.ledger.create',
				entityType: 'ledger',
				entityId: id,
			}),
			undefined,
		);
	});

	it('is refused when the books have no group to make it in', async () => {
		const refused = build({ groups: [] }).service.ensureRoleLedger(
			'composition_tax',
			'Composition tax',
			'indirect_expenses',
			null,
		);
		await expect(refused).rejects.toBeInstanceOf(BadRequestException);
		await expect(refused).rejects.toMatchObject({ response: { message: 'books_not_set_up' } });
	});
});

describe('the months a filing locks', () => {
	const file = (gstRegistrationId: string, returnType: string, month: string) =>
		({ gstRegistrationId, returnType, month, arn: 'AA1911260012345', filedOn: '2027-01-20' }) as never;

	it('is the quarter’s three for a QRMP GSTIN’s quarterly GSTR-1 and GSTR-3B, and for CMP-08', async () => {
		const { service, gstReturns } = build();
		expect((await service.markFiled(file('reg_q', 'GSTR-3B', '2026-12'), undefined)).months).toEqual([
			'2026-10',
			'2026-11',
			'2026-12',
		]);
		expect((await service.markFiled(file('reg_q', 'IFF', '2026-10'), undefined)).months).toEqual([]);
		expect((await service.markFiled(file('reg_m', 'GSTR-1', '2026-12'), undefined)).months).toEqual([]);
		expect(gstReturns.insert).toHaveBeenCalledTimes(3);
	});

	it('reads no scheme for a month before the GSTIN’s terms, so only CMP-08 covers a quarter', async () => {
		const { service } = build();
		expect((await service.markFiled(file('reg_new', 'GSTR-1', '2026-12'), undefined)).months).toEqual([]);
		expect((await service.markFiled(file('reg_new', 'CMP-08', '2026-12'), undefined)).months).toEqual([
			'2026-10',
			'2026-11',
			'2026-12',
		]);
	});
});
