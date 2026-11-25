import type { GstRegistration, GstReturnDraft, GstReturnPrepare } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { GstSchemesService } from '../src/gst/gst-schemes.service';

/**
 * The other kinds of taxpayer's returns (accounts brief G1–G3, G7): QRMP's IFF, quarterly GSTR-1 and GSTR-3B and
 * PMT-06; composition's CMP-08 and GSTR-4; an input service distributor's GSTR-6. The core rules run for real; the
 * stores are in memory.
 */

const refusal = (code: string) => ({ response: { message: code } });
const ZERO = { igst: 0, cgst: 0, sgst: 0 };

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
	hsnDigits: 6,
	...over,
});
const registration = (id: string, gstin: string, stateCode: string, list: unknown[]) =>
	({ id, gstin, stateCode, terms: list }) as unknown as GstRegistration;

const ISD_GSTIN = '19AAACI1234A1Z5';
/** QRMP all year. */
const QRMP = registration('reg_q', '19AAACQ1234A1Z5', '19', [terms('2026-04-01', { scheme: 'qrmp' })]);
/** Monthly until September, QRMP from October. */
const SWITCHED = registration('reg_s', '19AAACS1234A1Z5', '19', [
	terms('2026-10-01', { scheme: 'qrmp' }),
	terms('2026-04-01'),
]);
const MONTHLY = registration('reg_m', '19AAACM1234A1Z5', '19', [terms('2026-04-01')]);
/** Composition at the default rate (none set) and at 5%. */
const COMPOSITION = registration('reg_c', '19AAACC1234A1Z5', '19', [terms('2026-04-01', { kind: 'composition' })]);
const RESTAURANT = registration('reg_r', '19AAACR1234A1Z5', '19', [
	terms('2026-04-01', { kind: 'composition', compositionRatePercent: 5 }),
]);
const ISD = registration('reg_isd', ISD_GSTIN, '19', [terms('2026-04-01', { kind: 'isd' })]);
/** Registered only from 2027. */
const LATER = registration('reg_later', '19AAACL1234A1Z5', '19', [terms('2027-04-01')]);
/** The ISD's recipients: a regular GSTIN in its State and a casual one in Maharashtra. */
const KOLKATA = registration('reg_kol', '19AAACK1234A1Z5', '19', [terms('2025-04-01')]);
const MUMBAI = registration('reg_mum', '27AAACK1234A1Z5', '27', [terms('2025-04-01', { kind: 'casual' })]);

const prepare = (returnType: string, month: string, over: Partial<GstReturnPrepare> = {}) =>
	({
		gstRegistrationId: 'reg',
		returnType,
		month,
		adjustments: [],
		pmt06Method: 'self_assessment',
		...over,
	}) as GstReturnPrepare;

/** A GSTR-1 portal file with one B2B invoice. */
const b2b = (number: string) => ({
	b2b: [
		{
			ctin: '19AABCG1234A1Z5',
			inv: [{ inum: number, val: 1050, itms: [{ itm_det: { txval: 1000, camt: 25, samt: 25 } }] }],
		},
	],
	cdnr: [{ ctin: '19AABCG1234A1Z5', nt: [{ nt_num: `CN-${number}`, ntty: 'C', itms: [] }] }],
});

/** GSTR-3B's books for a month, with a reverse-charge self-invoice when asked. */
const books = (rcmIgst = 0) => ({
	selfInvoices: rcmIgst ? [{ taxable: rcmIgst * 10, igst: rcmIgst, cgst: 0, sgst: 0 }] : [],
	twoBImported: false,
	itc2b: ZERO,
	acceptedNotInBooks: 0,
	reversedInBooks: ZERO,
	rule37: ZERO,
	reclaimed: ZERO,
});

const draft = (registrationId: string, returnType: string, month: string, over: Partial<GstReturnDraft> = {}) =>
	({ id: `${returnType}_${month}`, gstRegistrationId: registrationId, returnType, month, ...over }) as GstReturnDraft;
const setOff = (cash: typeof ZERO, reverseChargeCash = ZERO) =>
	({ cash, reverseChargeCash }) as unknown as GstReturnDraft['setOff'];

function build(
	options: {
		drafts?: GstReturnDraft[];
		filings?: { gstRegistrationId: string; returnType: string; month: string }[];
		/** Invoices by `gstin|from`. */
		invoices?: Record<string, { status: string; taxableINR: number }[]>;
		selfInvoices?: unknown[];
		entries?: unknown[];
		rcmIgst?: number;
	} = {},
) {
	const drafts = {
		find: vi.fn(
			async (registrationId: string, returnType: string, month: string) =>
				(options.drafts ?? []).find(
					(d) => d.gstRegistrationId === registrationId && d.returnType === returnType && d.month === month,
				) ?? null,
		),
	};
	const invoices = {
		listForGstin: vi.fn(
			async (gstin: string, from: string, _to: string) => options.invoices?.[`${gstin}|${from}`] ?? [],
		),
	};
	const selfInvoices = { issuedForGstin: vi.fn(async () => options.selfInvoices ?? []) };
	const entries = { postedBetween: vi.fn(async () => options.entries ?? []) };
	const inputs = { collect: vi.fn(async () => books(options.rcmIgst)) };
	const service = new GstSchemesService(
		{ listRegistrations: async () => [ISD, KOLKATA, MUMBAI, COMPOSITION, LATER] } as never,
		invoices as never,
		drafts as never,
		{ list: async () => options.filings ?? [] } as never,
		selfInvoices as never,
		entries as never,
		inputs as never,
	);
	return { service, drafts, invoices, selfInvoices, entries, inputs };
}
/** The returns service's GSTR-1 between two days, answering one portal file. */
const between = (portal: Record<string, unknown> = {}) =>
	vi.fn(async (..._args: unknown[]) => ({ summary: [], problems: [], portal }));

describe('QRMP’s quarterly GSTR-1', () => {
	it('is for a quarter’s last month only', async () => {
		await expect(build().service.quarterGstr1(QRMP, '2026-11', between())).rejects.toMatchObject(
			refusal('gst_return_quarter_end_only'),
		);
	});

	it('works out the quarter, leaving out what the filed IFFs of its first two months reported', async () => {
		const { service } = build({
			drafts: [
				draft('reg_q', 'IFF', '2026-10', { portal: b2b('TI/1') }),
				// Prepared, never filed: what it holds is still reported in the quarter.
				draft('reg_q', 'IFF', '2026-11', { portal: b2b('TI/2') }),
			],
			filings: [{ gstRegistrationId: 'reg_q', returnType: 'IFF', month: '2026-10' }],
		});
		const run = between({ b2b: [] });
		expect(await service.quarterGstr1(QRMP, '2026-12', run)).toEqual({
			summary: [],
			problems: [],
			portal: { b2b: [] },
		});
		expect(run).toHaveBeenCalledWith(QRMP, '2026-10-01', '2026-12-31', '2026-12', new Set(['TI/1', 'CN-TI/1']));
		const none = between();
		await build().service.quarterGstr1(QRMP, '2027-03', none);
		expect(none).toHaveBeenCalledWith(QRMP, '2027-01-01', '2027-03-31', '2027-03', new Set());
	});
});

describe('QRMP’s quarterly GSTR-3B', () => {
	it('is for a quarter’s last month only', async () => {
		await expect(build().service.quarterGstr3b(QRMP, prepare('GSTR-3B', '2026-10'), {})).rejects.toMatchObject(
			refusal('gst_return_quarter_end_only'),
		);
	});

	it('adds the quarter’s books and counts only PMT-06 deposits that were paid', async () => {
		const paid = { igst: 10_000, cgst: 500, sgst: 500 };
		const one = build({
			rcmIgst: 1_800,
			drafts: [
				draft('reg_q', 'PMT-06', '2026-10', { challanVoucherId: 'jv_1', setOff: setOff(paid) }),
				// A challan with no set-off kept: nothing to count.
				draft('reg_q', 'PMT-06', '2026-11', { challanVoucherId: 'jv_2', setOff: null }),
			],
		});
		const result = await one.service.quarterGstr3b(QRMP, prepare('GSTR-3B', '2026-12'), {});
		expect(one.inputs.collect.mock.calls).toEqual([
			['reg_q', '2026-10'],
			['reg_q', '2026-11'],
			['reg_q', '2026-12'],
		]);
		expect(result.deposited).toEqual(paid);
		// Three months of ₹18 reverse-charge IGST.
		expect(result.reverseChargeCash).toEqual({ igst: 5_400, cgst: 0, sgst: 0 });

		const two = build({
			// Worked out but never paid by challan.
			drafts: [draft('reg_q', 'PMT-06', '2027-01', { challanVoucherId: null, setOff: setOff(paid) })],
		});
		expect((await two.service.quarterGstr3b(QRMP, prepare('GSTR-3B', '2027-03'), {})).deposited).toEqual(ZERO);
	});
});

describe('preparing a scheme’s return', () => {
	it('refuses a month the GSTIN wasn’t registered in', async () => {
		await expect(build().service.work(LATER, prepare('IFF', '2026-10'), null, between())).rejects.toMatchObject(
			refusal('gst_registration_not_in_force'),
		);
	});

	it('refuses a return that isn’t this GSTIN’s', async () => {
		const { service } = build();
		const refused = (reg: GstRegistration, type: string, month: string) =>
			expect(service.work(reg, prepare(type, month), null, between())).rejects.toMatchObject(
				refusal('gst_return_not_for_this_gstin'),
			);
		await refused(MONTHLY, 'IFF', '2026-10');
		await refused(QRMP, 'IFF', '2026-12');
		await refused(MONTHLY, 'PMT-06', '2026-10');
		await refused(QRMP, 'PMT-06', '2026-12');
		await refused(QRMP, 'CMP-08', '2026-12');
		await refused(QRMP, 'GSTR-4', '2027-03');
		await refused(COMPOSITION, 'GSTR-4', '2026-12');
		await refused(QRMP, 'GSTR-6', '2026-11');
	});

	it('makes an IFF from the month’s B2B invoices and notes', async () => {
		const run = between(b2b('TI/7'));
		const work = await build().service.work(QRMP, prepare('IFF', '2026-10'), null, run);
		expect(run).toHaveBeenCalledWith(QRMP, '2026-10-01', '2026-10-31', '2026-10');
		expect(work.summary[0]).toEqual({ table: '4A', records: 1, taxable: 1000, tax: 50 });
		expect(work.portal).toMatchObject({ gstin: QRMP.gstin, fp: '102026' });
		expect([work.setOff, work.inward6a, work.isdShares]).toEqual([null, null, null]);
	});
});

describe('PMT-06', () => {
	it('by fixed sum: 35% of a QRMP quarter’s cash, all of a monthly one’s, nothing without a last quarter', async () => {
		const cash = { igst: 10_000, cgst: 0, sgst: 0 };
		const fixed = prepare('PMT-06', '2027-01', { pmt06Method: 'fixed_sum' });
		const qrmp = build({
			drafts: [
				draft('reg_q', 'GSTR-3B', '2026-12', { setOff: setOff(cash, { igst: 0, cgst: 1_000, sgst: 1_000 }) }),
			],
		});
		const share = await qrmp.service.work(QRMP, fixed, null, between());
		expect(qrmp.drafts.find).toHaveBeenCalledWith('reg_q', 'GSTR-3B', '2026-12');
		expect(share.setOff).toMatchObject({ cash: { igst: 3_500, cgst: 400, sgst: 400 }, reverseChargeCash: ZERO });
		expect(share.portal).toMatchObject({ reason: 'FIXED_SUM' });

		const monthly = build({ drafts: [draft('reg_s', 'GSTR-3B', '2026-09', { setOff: setOff(cash) })] });
		const all = await monthly.service.work(
			SWITCHED,
			prepare('PMT-06', '2026-10', { pmt06Method: 'fixed_sum' }),
			null,
			between(),
		);
		expect(all.setOff?.cash).toEqual(cash);

		const none = await build().service.work(QRMP, fixed, null, between());
		expect(none.problems).toEqual([{ table: 'pmt06', problem: 'pmt06_no_last_quarter', document: '2027-01' }]);
		expect(none.setOff?.cash).toEqual(ZERO);
	});

	it('by self-assessment: the month’s own GSTR-3B worked out, reverse charge included', async () => {
		const { service, inputs } = build({ rcmIgst: 1_850 });
		const run = between();
		const work = await service.work(QRMP, prepare('PMT-06', '2026-11'), null, run);
		expect(run).toHaveBeenCalledWith(QRMP, '2026-11-01', '2026-11-30', '2026-11');
		expect(inputs.collect).toHaveBeenCalledWith('reg_q', '2026-11');
		// Whole rupees, never short.
		expect(work.setOff).toMatchObject({ cash: { igst: 1_900, cgst: 0, sgst: 0 }, deposited: null });
		expect(work.portal).toMatchObject({ reason: 'SELF_ASSESSMENT' });
	});
});

describe('CMP-08', () => {
	const BILLS = {
		[`${COMPOSITION.gstin}|2026-10-01`]: [
			{ status: 'issued', taxableINR: 10_000 },
			{ status: 'cancelled', taxableINR: 5_000 },
		],
		[`${RESTAURANT.gstin}|2026-10-01`]: [{ status: 'issued', taxableINR: 10_000 }],
	};

	it('is for a quarter’s last month only', async () => {
		await expect(
			build().service.work(COMPOSITION, prepare('CMP-08', '2026-11'), null, between()),
		).rejects.toMatchObject(refusal('gst_return_quarter_end_only'));
	});

	it('taxes the quarter’s live bills at the rate (1% when none is set) and pays the reverse-charge tax', async () => {
		const { service, selfInvoices, invoices } = build({
			invoices: BILLS,
			selfInvoices: [{ taxableINR: 1_000, igstINR: 0, cgstINR: 25, sgstINR: 25 }],
		});
		const work = await service.work(COMPOSITION, prepare('CMP-08', '2026-12'), null, between());
		expect(invoices.listForGstin).toHaveBeenCalledWith(COMPOSITION.gstin, '2026-10-01', '2026-12-31');
		expect(selfInvoices.issuedForGstin).toHaveBeenCalledWith('reg_c', '2026-10-01', '2026-12-31');
		// ₹10,000 at 1%: ₹50 CGST and ₹50 SGST, plus the ₹25 + ₹25 reverse-charge tax, all paid in cash (posting
		// takes the reverse-charge part back out for its own ledger); the cancelled bill counts for nothing.
		expect(work.setOff).toMatchObject({
			cash: { igst: 0, cgst: 7_500, sgst: 7_500 },
			reverseChargeCash: { igst: 0, cgst: 2_500, sgst: 2_500 },
		});
		const restaurant = await build({ invoices: BILLS }).service.work(
			RESTAURANT,
			prepare('CMP-08', '2026-12'),
			null,
			between(),
		);
		expect(restaurant.setOff).toMatchObject({
			cash: { igst: 0, cgst: 25_000, sgst: 25_000 },
			reverseChargeCash: ZERO,
		});
	});
});

describe('GSTR-4', () => {
	it('reads the year’s CMP-08s it can find and the year’s purchases, bills and self-invoices', async () => {
		const { service, drafts, entries, selfInvoices } = build({
			drafts: [
				draft('reg_c', 'CMP-08', '2026-06', { portal: {} }),
				draft('reg_c', 'CMP-08', '2026-12', { portal: {} }),
			],
			entries: [
				{
					supplierGstin: '19AABCG1234A1Z5',
					totals: { taxableINR: 1_000, igstINR: 0, cgstINR: 25, sgstINR: 25 },
				},
			],
			selfInvoices: [{ taxableINR: 500, igstINR: 90, cgstINR: 0, sgstINR: 0 }],
		});
		const work = await service.work(COMPOSITION, prepare('GSTR-4', '2027-03'), null, between());
		expect(drafts.find.mock.calls.map((c) => c[2])).toEqual(['2026-06', '2026-09', '2026-12', '2027-03']);
		expect(entries.postedBetween).toHaveBeenCalledWith('2026-04-01', '2027-03-31');
		expect(selfInvoices.issuedForGstin).toHaveBeenCalledWith('reg_c', '2026-04-01', '2027-03-31');
		expect(work.summary.length).toBeGreaterThan(0);
		expect([work.setOff, work.inward6a, work.isdShares]).toEqual([null, null, null]);
	});
});

describe('GSTR-6 for an input service distributor', () => {
	const FILE = {
		gstin: ISD_GSTIN,
		fp: '112026',
		b2b: [
			{
				ctin: '27AAKFR1234M1Z2',
				inv: [
					{
						inum: 'S1',
						idt: '05-11-2026',
						itms: [{ itm_det: { txval: 1_000, iamt: 0, camt: 90, samt: 90 } }],
					},
				],
			},
		],
	};
	/** Kolkata sold ₹3,000 last year and Mumbai ₹1,000; a cancelled bill counts for nothing. */
	const LAST_YEAR = {
		[`${KOLKATA.gstin}|2025-04-01`]: [
			{ status: 'issued', taxableINR: 3_000 },
			{ status: 'cancelled', taxableINR: 9_000 },
		],
		[`${MUMBAI.gstin}|2025-04-01`]: [{ status: 'issued', taxableINR: 1_000 }],
	};

	it('needs a GSTR-6A file, given now or kept from the last prepare, that reads and is this GSTIN’s month', async () => {
		const { service } = build();
		const refused = (write: GstReturnPrepare, code: string) =>
			expect(service.work(ISD, write, null, between())).rejects.toMatchObject(refusal(code));
		await refused(prepare('GSTR-6', '2026-11'), 'gstr6a_needed');
		await refused(
			prepare('GSTR-6', '2026-11', { inward6a: { gstin: 'bad', fp: '112026' } }),
			'gstr6a_file_unreadable',
		);
		await refused(
			prepare('GSTR-6', '2026-11', { inward6a: { ...FILE, gstin: KOLKATA.gstin } }),
			'gstr6a_other_gstin',
		);
		await refused(prepare('GSTR-6', '2026-10', { inward6a: FILE }), 'gstr6a_other_month');
	});

	it('shares the credit among the other regular and casual GSTINs by last year’s turnover', async () => {
		const { service, invoices } = build({ invoices: LAST_YEAR });
		const existing = draft('reg_isd', 'GSTR-6', '2026-11', { inward6a: FILE });
		const work = await service.work(ISD, prepare('GSTR-6', '2026-11'), existing, between());
		// Only last year was read: everyone had turnover.
		expect(invoices.listForGstin.mock.calls).toEqual([
			[KOLKATA.gstin, '2025-04-01', '2026-03-31'],
			[MUMBAI.gstin, '2025-04-01', '2026-03-31'],
		]);
		expect(work.isdShares?.map((s) => [s.registrationId, s.ratioPercent, s.credit])).toEqual([
			['reg_kol', 75, { igst: 0, cgst: 6_750, sgst: 6_750 }],
			// Outside the ISD's State: CGST and SGST reach it as IGST.
			['reg_mum', 25, { igst: 4_500, cgst: 0, sgst: 0 }],
		]);
		expect(work.inward6a).toEqual(FILE);
		expect(work.inward6a).not.toBe(FILE);
		expect(work.setOff).toBeNull();
	});

	it('shares by the last quarter’s turnover when a recipient sold nothing last year', async () => {
		const { service, invoices } = build({
			invoices: {
				[`${KOLKATA.gstin}|2025-04-01`]: [{ status: 'issued', taxableINR: 3_000 }],
				[`${KOLKATA.gstin}|2026-07-01`]: [{ status: 'issued', taxableINR: 1_000 }],
				[`${MUMBAI.gstin}|2026-07-01`]: [{ status: 'issued', taxableINR: 1_000 }],
			},
		});
		const work = await service.work(ISD, prepare('GSTR-6', '2026-11', { inward6a: FILE }), null, between());
		expect(invoices.listForGstin.mock.calls.slice(2)).toEqual([
			[KOLKATA.gstin, '2026-07-01', '2026-09-30'],
			[MUMBAI.gstin, '2026-07-01', '2026-09-30'],
		]);
		expect(work.isdShares?.map((s) => s.ratioPercent)).toEqual([50, 50]);
	});
});
