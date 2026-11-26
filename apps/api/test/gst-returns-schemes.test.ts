import type { GstReturnDraft, TaxRuleEntry } from '@saha-textile/contracts';
import { DUE_DATES_V2 } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { GstReturnsService } from '../src/gst/gst-returns.service';
import type { Gstr1Between } from '../src/gst/gst-schemes.service';

/**
 * The returns service with the other kinds of taxpayer (G1–G3, G7): a QRMP quarter's GSTR-1 worked out through the
 * service's own GSTR-1, the other returns handed to the schemes service and kept with their 6A file and ISD shares,
 * and a composition GSTIN's calendar with its yearly GSTR-4 and no GSTR-9.
 */

const at = '2026-11-28T06:00:00.000Z';
const terms = (from: string, over: Record<string, unknown> = {}) => ({
	from,
	kind: 'regular',
	scheme: 'monthly',
	compositionRatePercent: null,
	lastYearTurnoverINR: 0,
	eInvoice: false,
	eInvoiceThirtyDays: false,
	annualReturn: true,
	reconciliationStatement: false,
	hsnDigits: 4,
	...over,
});
const REGISTRATIONS: Record<string, unknown> = {
	reg_q: { id: 'reg_q', gstin: '19AAACQ1234A1Z5', stateCode: '19', terms: [terms('2026-04-01', { scheme: 'qrmp' })] },
	reg_isd: {
		id: 'reg_isd',
		gstin: '19AAACI1234A1Z5',
		stateCode: '19',
		terms: [terms('2026-04-01', { kind: 'isd' })],
	},
	reg_c: {
		id: 'reg_c',
		gstin: '19AAACC1234A1Z5',
		stateCode: '19',
		terms: [terms('2025-04-01', { kind: 'composition' })],
	},
};
const SHARES = [
	{
		registrationId: 'reg_q',
		gstin: '19AAACQ1234A1Z5',
		ratioPercent: 100,
		credit: { igst: 0, cgst: 90, sgst: 90 },
		from: { igst: 0, cgst: 90, sgst: 90 },
		invoiceNumber: 'ISD2611-1',
	},
];

function build(
	options: { drafts?: Partial<GstReturnDraft>[]; filings?: unknown[]; rules?: readonly TaxRuleEntry[] } = {},
) {
	const drafts = {
		find: async (registrationId: string, returnType: string, month: string) =>
			(options.drafts ?? []).find(
				(d) => d.gstRegistrationId === registrationId && d.returnType === returnType && d.month === month,
			) ?? null,
		listForRegistration: async (registrationId: string) =>
			(options.drafts ?? []).filter((d) => d.gstRegistrationId === registrationId),
		save: vi.fn(async (next: GstReturnDraft, expectedVersion: number | null) => ({
			...next,
			version: expectedVersion === null ? 0 : expectedVersion + 1,
		})),
	};
	const invoices = { listForGstin: vi.fn(async () => []), get: vi.fn(async () => null) };
	/** The schemes service, using the GSTR-1 it is handed the way the real one does. */
	const schemes = {
		quarterGstr1: vi.fn(async (registration: never, month: string, between: Gstr1Between) =>
			between(registration, '2026-10-01', '2026-12-31', month, new Set(['TI/1'])),
		),
		quarterGstr3b: vi.fn(),
		work: vi.fn(
			async (registration: never, write: { month: string }, _existing: unknown, between: Gstr1Between) => {
				const month = await between(registration, `${write.month}-01`, `${write.month}-30`, write.month);
				return {
					summary: month.summary,
					problems: [],
					portal: { from: 'schemes' },
					setOff: null,
					inward6a: { gstin: '19AAACI1234A1Z5', fp: '112026' },
					isdShares: SHARES,
				};
			},
		),
	};
	const service = new GstReturnsService(
		drafts as never,
		{ list: async () => options.filings ?? [] } as never,
		{ getRegistration: async (id: string) => REGISTRATIONS[id] ?? null } as never,
		invoices as never,
		{ listForGstin: async () => [] } as never,
		{ listForGstin: async () => [] } as never,
		{ ruleSetEntries: async () => [...(options.rules ?? DUE_DATES_V2.entries)] },
		{ findById: async () => null } as never,
		{ collect: vi.fn() },
		schemes as never,
	);
	return { service, drafts, invoices, schemes };
}
const prepare = (gstRegistrationId: string, returnType: string, month: string) =>
	({ gstRegistrationId, returnType, month, adjustments: [], pmt06Method: 'self_assessment' }) as never;
const accountant = { userId: 'adm_acc', permissions: ['accounts.post'] } as never;

describe('a QRMP quarter’s GSTR-1', () => {
	it('is worked out over the whole quarter by the service’s own GSTR-1, less what the IFFs reported', async () => {
		const { service, schemes, invoices } = build();
		const prepared = await service.prepare(prepare('reg_q', 'GSTR-1', '2026-12'), accountant, new Date(at));
		expect(schemes.quarterGstr1).toHaveBeenCalledWith(REGISTRATIONS['reg_q'], '2026-12', expect.any(Function));
		expect(invoices.listForGstin).toHaveBeenCalledWith('19AAACQ1234A1Z5', '2026-10-01', '2026-12-31');
		expect(prepared).toMatchObject({ returnType: 'GSTR-1', status: 'prepared', setOff: null, isdShares: null });
	});
});

describe('the other kinds of return', () => {
	it('refuse GSTR-1 and GSTR-3B for a composition or ISD GSTIN, which file CMP-08 and GSTR-6 instead', async () => {
		const { service, schemes, drafts } = build();
		for (const [registration, returnType] of [
			['reg_c', 'GSTR-1'],
			['reg_c', 'GSTR-3B'],
			['reg_isd', 'GSTR-1'],
			['reg_isd', 'GSTR-3B'],
		] as const)
			await expect(
				service.prepare(prepare(registration, returnType, '2026-12'), accountant, new Date(at)),
			).rejects.toMatchObject({ response: { message: 'gst_return_not_for_this_gstin' } });
		expect(
			[schemes.quarterGstr1, schemes.quarterGstr3b, schemes.work, drafts.save].map((f) => f.mock.calls.length),
		).toEqual([0, 0, 0, 0]);
	});

	it('are worked out by the schemes service and kept with their GSTR-6A file and ISD shares', async () => {
		const existing = {
			id: 'gsr_isd',
			gstRegistrationId: 'reg_isd',
			returnType: 'GSTR-6',
			month: '2026-11',
			status: 'prepared',
			version: 2,
		} as const;
		const { service, schemes, drafts, invoices } = build({ drafts: [existing] });
		const prepared = await service.prepare(prepare('reg_isd', 'GSTR-6', '2026-11'), accountant, new Date(at));
		expect(schemes.work).toHaveBeenCalledWith(
			REGISTRATIONS['reg_isd'],
			expect.objectContaining({ returnType: 'GSTR-6' }),
			existing,
			expect.any(Function),
		);
		// The month GSTR-1 it asked for went through the service's own.
		expect(invoices.listForGstin).toHaveBeenCalledWith('19AAACI1234A1Z5', '2026-11-01', '2026-11-30');
		expect(drafts.save).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'gsr_isd',
				portal: { from: 'schemes' },
				inward6a: { gstin: '19AAACI1234A1Z5', fp: '112026' },
				isdShares: SHARES,
				adjustments: [],
			}),
			2,
		);
		expect(prepared.version).toBe(3);
	});
});

describe('a composition GSTIN’s calendar', () => {
	/** 10 May 2027: the last twelve months run from May 2026 to April 2027. */
	const calendar = (options: Parameters<typeof build>[0] = {}) =>
		build(options).service.calendar({ gstRegistrationId: 'reg_c', chip: 'all' }, new Date('2027-05-10T06:00:00Z'));
	const gstr4 = async (options: Parameters<typeof build>[0] = {}) =>
		(await calendar(options)).rows.filter((r) => r.returnType === 'GSTR-4');

	it('lists CMP-08 each quarter and the year’s GSTR-4 in March, never GSTR-9', async () => {
		const { rows } = await calendar();
		expect([...new Set(rows.map((r) => r.returnType))].sort()).toEqual(['CMP-08', 'GSTR-4']);
		expect(rows.filter((r) => r.returnType === 'CMP-08').map((r) => r.period)).toEqual([
			'2027-03',
			'2026-12',
			'2026-09',
			'2026-06',
		]);
		expect(await gstr4()).toEqual([
			{
				returnType: 'GSTR-4',
				period: '2027-03',
				dueOn: '2027-04-30',
				status: 'not_started',
				arn: null,
				draftId: null,
			},
		]);
	});

	it('shows GSTR-4 filed with its ARN, or as its draft stands', async () => {
		const filed = await gstr4({
			filings: [
				{ gstRegistrationId: 'reg_c', returnType: 'GSTR-4', month: '2027-03', arn: 'AA1904271234567' },
				{ gstRegistrationId: 'reg_q', returnType: 'GSTR-4', month: '2027-03', arn: 'AA1904279999999' },
			],
		});
		expect(filed[0]).toMatchObject({ status: 'filed', arn: 'AA1904271234567', draftId: null });
		const drafted = await gstr4({
			drafts: [
				{
					id: 'gsr_cmp',
					gstRegistrationId: 'reg_c',
					returnType: 'CMP-08',
					month: '2027-03',
					status: 'approved',
				},
				{ id: 'gsr_g4', gstRegistrationId: 'reg_c', returnType: 'GSTR-4', month: '2027-03', status: 'checked' },
			],
		});
		expect(drafted[0]).toMatchObject({ status: 'checked', arn: null, draftId: 'gsr_g4' });
	});

	it('leaves GSTR-4 out when the due-date rules give it no date', async () => {
		expect(await gstr4({ rules: DUE_DATES_V2.entries.filter((e) => e.due?.returnType !== 'GSTR-4') })).toEqual([]);
	});
});
