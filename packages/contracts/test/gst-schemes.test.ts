import { describe, expect, it } from 'vitest';

import { TaxRuleEntry } from '../src/accounts-templates';
import {
	GstCalendarRow,
	GstDistributionPost,
	GstDraftType,
	GstReturnDraft,
	GstReturnPrepare,
	GstSetOff,
} from '../src/gst-returns';
import { GST_RETURN_LOCKS, GstReturnFiling, GstReturnFilingWrite, GstReturnType, filingMonths } from '../src/ledger';
import { TaxInvoice } from '../src/tax-invoice';

/**
 * The other kinds of GST taxpayer in the contracts (accounts brief G1–G3, G8): QRMP's IFF and PMT-06, composition's
 * CMP-08 and GSTR-4 with bills of supply, and an ISD's GSTR-6; what each filing locks, and a quarter's months.
 */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const RETURNS = ['GSTR-1', 'GSTR-3B', 'IFF', 'PMT-06', 'CMP-08', 'GSTR-4', 'GSTR-6'];

describe('returns filed and what they lock', () => {
	it('records seven kinds of return', () => {
		expect(GstReturnType.options).toEqual(RETURNS);
		expect(GstDraftType.options).toEqual(RETURNS);
		refused(GstReturnType.safeParse('GSTR-9').success);
	});

	it('locks sales for GSTR-1 and IFF, sales and purchases for GSTR-3B and CMP-08, purchases for GSTR-6, nothing for a payment or the year', () => {
		expect(GST_RETURN_LOCKS).toEqual({
			'GSTR-1': ['sales'],
			'GSTR-3B': ['sales', 'purchases'],
			IFF: ['sales'],
			'PMT-06': [],
			'CMP-08': ['sales', 'purchases'],
			'GSTR-4': [],
			'GSTR-6': ['purchases'],
		});
		expect(Object.keys(GST_RETURN_LOCKS)).toEqual(RETURNS);
	});

	const filing = {
		gstRegistrationId: 'gst_wb',
		gstin: '19AAGCB5678K1Z1',
		returnType: 'CMP-08',
		month: '2026-12',
		arn: 'aa191226 123456x',
		filedOn: '2027-01-15',
		at: '2027-01-15T10:00:00.000Z',
	};

	it('keeps a filing for its month alone unless it covers more, up to twelve', () => {
		const alone = GstReturnFiling.parse(filing);
		expect(alone).toMatchObject({ arn: 'AA191226123456X', acknowledgement: null, by: null, months: [] });
		expect(filingMonths(alone)).toEqual(['2026-12']);
		const quarter = GstReturnFiling.parse({ ...filing, months: ['2026-10', '2026-11', '2026-12'] });
		expect(filingMonths(quarter)).toEqual(['2026-10', '2026-11', '2026-12']);
		expect(filingMonths(quarter)).not.toBe(quarter.months);
		accepted(GstReturnFiling.safeParse({ ...filing, months: Array.from({ length: 12 }, () => '2026-12') }).success);
		refused(GstReturnFiling.safeParse({ ...filing, months: Array.from({ length: 13 }, () => '2026-12') }).success);
		refused(GstReturnFiling.safeParse({ ...filing, months: ['2026-13'] }).success);
		refused(GstReturnFiling.safeParse({ ...filing, returnType: 'GSTR-9' }).success);
	});

	it('marks a return filed without the months, which come from the return itself', () => {
		const { gstin: _gstin, at: _at, ...write } = filing;
		expect(GstReturnFilingWrite.parse({ ...write, months: ['2026-10'] })).not.toHaveProperty('months');
		expect(GstReturnFilingWrite.parse({ ...write, returnType: 'GSTR-6' }).returnType).toBe('GSTR-6');
	});
});

describe('the new returns’ drafts', () => {
	const setOff = {
		liability: { igst: 0, cgst: 0, sgst: 0 },
		credit: { igst: 0, cgst: 0, sgst: 0 },
		igstUsed: { igst: 0, cgst: 0, sgst: 0 },
		cgstUsed: { cgst: 0, igst: 0 },
		sgstUsed: { sgst: 0, igst: 0 },
		cash: { igst: 0, cgst: 1_300_000, sgst: 1_670_000 },
		carried: { igst: 0, cgst: 0, sgst: 0 },
		reverseChargeCash: { igst: 0, cgst: 0, sgst: 0 },
	};

	it('keeps a QRMP set-off’s PMT-06 deposits, or none', () => {
		expect(GstSetOff.parse(setOff)).not.toHaveProperty('deposited');
		expect(GstSetOff.parse({ ...setOff, deposited: null }).deposited).toBeNull();
		expect(
			GstSetOff.parse({ ...setOff, deposited: { igst: 0, cgst: 500_000, sgst: 2_000_000 } }).deposited,
		).toEqual({
			igst: 0,
			cgst: 500_000,
			sgst: 2_000_000,
		});
		refused(GstSetOff.safeParse({ ...setOff, deposited: { igst: 0.5, cgst: 0, sgst: 0 } }).success);
	});

	const draft = {
		id: 'gstd_6',
		gstRegistrationId: 'gst_isd',
		gstin: '19AAACS1234K1ZD',
		returnType: 'GSTR-6',
		month: '2026-11',
		status: 'approved',
		summary: [],
		problems: [],
		portal: {},
		preparedBy: null,
		preparedAt: '2026-12-10T05:00:00.000Z',
	};
	const share = {
		registrationId: 'reg_mh',
		gstin: '27AAACS1234K1ZB',
		ratioPercent: 30,
		credit: { igst: 84_000, cgst: 0, sgst: 0 },
		from: { igst: 30_000, cgst: 27_000, sgst: 27_000 },
		invoiceNumber: 'ISD2611-2',
	};

	it('leaves the ISD and composition fields out until a return has them', () => {
		const parsed = GstReturnDraft.parse(draft);
		for (const key of ['distributionVoucherId', 'inward6a', 'isdShares', 'expenseVoucherId'])
			expect(parsed).not.toHaveProperty(key);
	});

	it('keeps a GSTR-6’s GSTR-6A file, each recipient’s share and the distribution posted, and CMP-08’s expense', () => {
		const filled = {
			...draft,
			inward6a: { gstin: '19AAACS1234K1ZD', fp: '112026' },
			isdShares: [share],
			distributionVoucherId: 'vch_isd_2611',
			expenseVoucherId: null,
		};
		expect(GstReturnDraft.parse(filled)).toMatchObject(filled);
		accepted(
			GstReturnDraft.safeParse({ ...draft, inward6a: null, isdShares: null, distributionVoucherId: null })
				.success,
		);
		refused(GstReturnDraft.safeParse({ ...draft, isdShares: [{ ...share, credit: { igst: 1 } }] }).success);
		refused(GstReturnDraft.safeParse({ ...draft, isdShares: [{ ...share, registrationId: '' }] }).success);
		refused(GstReturnDraft.safeParse({ ...draft, inward6a: 'gstr6a.json' }).success);
	});

	it('posts a distribution at the draft’s version', () => {
		expect(GstDistributionPost.parse({ version: 3 })).toEqual({ version: 3 });
		refused(GstDistributionPost.safeParse({}).success);
		refused(GstDistributionPost.safeParse({ version: -1 }).success);
	});

	it('prepares PMT-06 by self-assessment unless fixed sum is chosen, and GSTR-6 from a GSTR-6A file when given', () => {
		const ask = { gstRegistrationId: 'gst_wb', returnType: 'PMT-06', month: '2026-11' };
		expect(GstReturnPrepare.parse(ask)).toEqual({ ...ask, adjustments: [], pmt06Method: 'self_assessment' });
		expect(GstReturnPrepare.parse({ ...ask, pmt06Method: 'fixed_sum' }).pmt06Method).toBe('fixed_sum');
		refused(GstReturnPrepare.safeParse({ ...ask, pmt06Method: 'estimate' }).success);
		const six = GstReturnPrepare.parse({ ...ask, returnType: 'GSTR-6', inward6a: { fp: '112026' } });
		expect(six.inward6a).toEqual({ fp: '112026' });
		refused(GstReturnPrepare.safeParse({ ...ask, inward6a: ['x'] }).success);
	});

	it('lists the new returns in the calendar, a GSTR-4 by its financial year', () => {
		const row = { period: '2026-12', dueOn: '2027-01-18', status: 'not_started', arn: null, draftId: null };
		for (const returnType of ['IFF', 'PMT-06', 'CMP-08', 'GSTR-6'])
			accepted(GstCalendarRow.safeParse({ ...row, returnType }).success);
		accepted(
			GstCalendarRow.safeParse({ ...row, returnType: 'GSTR-4', period: '2026-27', dueOn: '2027-04-30' }).success,
		);
	});
});

describe('bills of supply and the new due dates', () => {
	it('marks a composition seller’s invoice as a bill of supply, an ordinary one not', () => {
		const invoice = {
			id: 'ti_1',
			number: 'BS/26-27/000001',
			date: '2026-11-10',
			gstRegistrationId: 'gst_cmp',
			gstin: '19AAGCB5678K1Z1',
			locationId: 'loc',
			orderId: 'ord',
			orderNumber: 'ST-1',
			seller: { name: 'Saha Textile', gstin: '19AAGCB5678K1Z1', stateCode: '19' },
			buyer: { name: 'Buyer', stateCode: '19' },
			placeOfSupply: '19',
			interState: false,
			lines: [
				{
					lineId: 'l1',
					sku: 'S',
					title: 'Saree',
					hsn: '50072010',
					quantity: 1,
					unitPriceINR: 1_050,
					ratePercent: 0,
					taxableINR: 1_050,
					totalINR: 1_050,
				},
			],
			taxableINR: 1_050,
			cgstINR: 0,
			sgstINR: 0,
			igstINR: 0,
			roundOffINR: 0,
			totalINR: 1_050,
			createdAt: '2026-11-10T06:00:00.000Z',
		};
		expect(TaxInvoice.parse(invoice).billOfSupply).toBe(false);
		expect(TaxInvoice.parse({ ...invoice, billOfSupply: true }).billOfSupply).toBe(true);
		refused(TaxInvoice.safeParse({ ...invoice, billOfSupply: 'yes' }).success);
	});

	it('takes due-date rules for IFF, PMT-06, CMP-08, GSTR-4 and GSTR-6', () => {
		const entry = { key: 'cmp08_quarter', name: 'CMP-08', ratePercent: 0, from: '2019-04-01' };
		for (const returnType of ['IFF', 'PMT-06', 'CMP-08', 'GSTR-4', 'GSTR-6'])
			expect(TaxRuleEntry.parse({ ...entry, due: { returnType, day: 18 } }).due?.returnType).toBe(returnType);
		refused(TaxRuleEntry.safeParse({ ...entry, due: { returnType: 'GSTR-2', day: 18 } }).success);
	});
});
