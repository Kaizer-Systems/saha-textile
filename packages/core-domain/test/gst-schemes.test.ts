import { describe, expect, it } from 'vitest';

import {
	IFF_LIMIT_PAISE,
	type Gstr6aLine,
	type IsdRecipient,
	type ThreeBBooks,
	cmp08,
	coveredMonths,
	gstr4,
	gstr6,
	iffReturn,
	isQuarterEnd,
	isdDistribution,
	parseGstr6a,
	pmt06,
	portalPeriod,
	previousQuarterEnd,
	quarterOf,
	quarterBooks,
	reportedInIff,
	returnsFor,
} from '../src/gst/gst-schemes';

/**
 * The other kinds of GST taxpayer, checked against the law: QRMP (IFF up to ₹50 lakh a month, rule 59(2); PMT-06 at
 * 35% of the last quarter's cash or all of its last month's when filed monthly, or self-assessed, rule 61A);
 * composition (CMP-08 at half the rate to CGST and half to SGST with reverse-charge tax, rule 62; GSTR-4 tables 4A–4C,
 * 5 and 6); and the input service distributor (rule 39: credit shared by turnover, IGST as IGST, CGST and SGST kept in
 * the ISD's State and as IGST elsewhere; GSTR-6A in, GSTR-6 out).
 */

const heads = (igst: number, cgst = 0, sgst = 0) => ({ igst, cgst, sgst });
const ZERO = heads(0);

describe('periods and quarters', () => {
	it('writes a month as the portal does, MMYYYY', () => {
		expect(portalPeriod('2026-11')).toBe('112026');
		expect(portalPeriod('2027-03')).toBe('032027');
	});

	it('ends quarters in June, September, December and March', () => {
		expect(['2026-03', '2026-06', '2026-09', '2026-12'].map(isQuarterEnd)).toEqual([true, true, true, true]);
		expect(['2026-01', '2026-02', '2026-04', '2026-11'].map(isQuarterEnd)).toEqual([false, false, false, false]);
	});

	it('names a month’s quarter by its three months and its last, January to March in the same year', () => {
		expect(quarterOf('2026-11')).toEqual({ months: ['2026-10', '2026-11', '2026-12'], last: '2026-12' });
		expect(quarterOf('2026-10')).toEqual({ months: ['2026-10', '2026-11', '2026-12'], last: '2026-12' });
		expect(quarterOf('2027-01')).toEqual({ months: ['2027-01', '2027-02', '2027-03'], last: '2027-03' });
		expect(quarterOf('2026-06')).toEqual({ months: ['2026-04', '2026-05', '2026-06'], last: '2026-06' });
	});

	it('finds the quarter before, across a year’s end', () => {
		expect(previousQuarterEnd('2026-11')).toBe('2026-09');
		expect(previousQuarterEnd('2027-02')).toBe('2026-12');
		expect(previousQuarterEnd('2026-04')).toBe('2026-03');
	});
});

describe('IFF in a QRMP quarter’s first two months', () => {
	const item = (txval: number, iamt = 0, camt = 0, samt = 0) => ({
		num: 1,
		itm_det: { txval, rt: 5, iamt, camt, samt, csamt: 0 },
	});
	const portal = {
		b2b: [
			{
				ctin: '27AAKFR1234M1Z5',
				inv: [
					{ inum: 'TI/1', val: 1_050, itms: [item(1_000, 50)] },
					// An item written flat, and one that isn't an item at all.
					{ inum: 'TI/2', val: 2_100, itms: [{ txval: 2_000, camt: 50, samt: 50 }, 'x'] },
				],
			},
			'not a party',
			{ ctin: '19AAGCB5678K1Z1' },
		],
		cdnr: [
			{
				ctin: '27AAKFR1234M1Z5',
				nt: [
					{ ntty: 'C', nt_num: 'CN/1', itms: [item(500, 25)] },
					{ ntty: 'D', nt_num: 'DN/1', itms: [item(100, 5)] },
					'not a note',
				],
			},
			'not a party',
		],
		b2cs: [{ sply_ty: 'INTRA', txval: 99_999 }],
	};

	it('reports only the B2B invoices and the notes to registered buyers, credit notes less', () => {
		expect(iffReturn({ gstin: '19DBYPS6736R1ZZ', month: '2026-11', portal })).toEqual({
			summary: [
				{ table: '4A', records: 2, taxable: 3_000, tax: 150 },
				{ table: '9B', records: 3, taxable: -400, tax: -20 },
			],
			problems: [],
			portal: { gstin: '19DBYPS6736R1ZZ', fp: '112026', b2b: portal.b2b, cdnr: portal.cdnr },
		});
	});

	it('says when the month’s invoices pass ₹50 lakh, to report them in the quarter’s GSTR-1 instead', () => {
		// ₹50,00,000 in paise.
		expect(IFF_LIMIT_PAISE).toBe(50_00_000_00);
		const over = { b2b: [{ ctin: 'X', inv: [{ inum: 'TI/9', val: 50_00_000.01 }] }] };
		expect(iffReturn({ gstin: 'G', month: '2026-11', portal: over }).problems).toEqual([
			{ table: '4A', problem: 'iff_over_limit', document: '2026-11' },
		]);
		const exactly = { b2b: [{ ctin: 'X', inv: [{ inum: 'TI/9', val: 50_00_000 }, 'odd'] }] };
		expect(iffReturn({ gstin: 'G', month: '2026-11', portal: exactly }).problems).toEqual([]);
		expect(iffReturn({ gstin: 'G', month: '2026-11', portal: {} }).summary).toEqual([
			{ table: '4A', records: 0, taxable: 0, tax: 0 },
			{ table: '9B', records: 0, taxable: 0, tax: 0 },
		]);
	});

	it('lists the numbers an IFF reported, past odd parties and documents without one', () => {
		const reported = reportedInIff({
			...portal,
			b2b: [...portal.b2b, { inv: [{ val: 5 }, { inum: '' }] }],
			cdnr: [...portal.cdnr, 'x', { nt: [{ nt_num: 7 }] }],
		});
		expect([...reported]).toEqual(['TI/1', 'TI/2', 'CN/1', 'DN/1']);
		expect(reportedInIff({}).size).toBe(0);
	});
});

describe('the quarter’s GSTR-3B and PMT-06', () => {
	const month = (over: Partial<ThreeBBooks> = {}): ThreeBBooks => ({
		selfInvoices: [],
		twoBImported: true,
		itc2b: ZERO,
		acceptedNotInBooks: 0,
		reversedInBooks: ZERO,
		rule37: ZERO,
		reclaimed: ZERO,
		...over,
	});

	it('adds a quarter’s months together, 2B imported only when every month has one', () => {
		const october = month({
			selfInvoices: [{ taxable: 10_000, igst: 0, cgst: 900, sgst: 900 }],
			itc2b: heads(1_000, 200, 200),
			acceptedNotInBooks: 1,
			reversedInBooks: heads(0, 10, 10),
			rule37: heads(5),
			reclaimed: heads(2),
			isdCredit: heads(300, 40, 40),
		});
		const november = month({ itc2b: heads(500, 100, 100), twoBImported: false });
		const december = month({
			selfInvoices: [{ taxable: 5_000, igst: 900, cgst: 0, sgst: 0 }],
			isdCredit: heads(0, 10, 10),
		});
		expect(quarterBooks([october, november, december])).toEqual({
			selfInvoices: [
				{ taxable: 10_000, igst: 0, cgst: 900, sgst: 900 },
				{ taxable: 5_000, igst: 900, cgst: 0, sgst: 0 },
			],
			twoBImported: false,
			itc2b: heads(1_500, 300, 300),
			acceptedNotInBooks: 1,
			reversedInBooks: heads(0, 10, 10),
			rule37: heads(5),
			reclaimed: heads(2),
			isdCredit: heads(300, 50, 50),
		});
		expect(quarterBooks([october, december]).twoBImported).toBe(true);
		expect(quarterBooks([])).toEqual({ ...month(), isdCredit: ZERO });
	});

	it('pays 35% of the last quarter’s cash by fixed sum, each head rounded up to a rupee', () => {
		const result = pmt06({
			gstin: 'G',
			month: '2026-11',
			method: 'fixed_sum',
			lastQuarter: { cash: heads(1_234_567, 100_000, 1), monthly: false },
			month3b: null,
		});
		// 35% of ₹12,345.67 is ₹4,320.98 → ₹4,321; of ₹1,000, ₹350; of a paisa, a rupee.
		expect(result.deposit).toEqual(heads(432_100, 35_000, 100));
		expect(result.problems).toEqual([]);
		expect(result.summary).toEqual([
			{ table: 'pmt06_igst', records: 0, taxable: 0, tax: 4_321 },
			{ table: 'pmt06_cgst', records: 0, taxable: 0, tax: 350 },
			{ table: 'pmt06_sgst', records: 0, taxable: 0, tax: 1 },
		]);
		expect(result.portal).toEqual({
			gstin: 'G',
			ret_period: '112026',
			reason: 'FIXED_SUM',
			igst: { tax: 4_321 },
			cgst: { tax: 350 },
			sgst: { tax: 1 },
		});
	});

	it('pays all of the last month’s cash by fixed sum when the last quarter was filed monthly', () => {
		const result = pmt06({
			gstin: 'G',
			month: '2026-10',
			method: 'fixed_sum',
			lastQuarter: { cash: heads(50_050, 20_000, 20_000), monthly: true },
			month3b: null,
		});
		expect(result.deposit).toEqual(heads(50_100, 20_000, 20_000));
	});

	it('asks nothing by fixed sum after a quarter with no cash paid, and says so', () => {
		for (const lastQuarter of [null, { cash: ZERO, monthly: false }]) {
			const result = pmt06({ gstin: 'G', month: '2026-11', method: 'fixed_sum', lastQuarter, month3b: null });
			expect(result.deposit).toEqual(ZERO);
			expect(result.problems).toEqual([
				{ table: 'pmt06', problem: 'pmt06_no_last_quarter', document: '2026-11' },
			]);
		}
	});

	it('pays the month’s own cash and reverse-charge tax by self-assessment, once the month is worked out', () => {
		const result = pmt06({
			gstin: 'G',
			month: '2026-11',
			method: 'self_assessment',
			lastQuarter: null,
			month3b: { cash: heads(10_000, 5_050, 5_050), reverseCharge: heads(0, 900, 900) },
		});
		expect(result.deposit).toEqual(heads(10_000, 6_000, 6_000));
		expect(result.portal['reason']).toBe('SELF_ASSESSMENT');
		const unworked = pmt06({
			gstin: 'G',
			month: '2026-11',
			method: 'self_assessment',
			lastQuarter: null,
			month3b: null,
		});
		expect(unworked.deposit).toEqual(ZERO);
		expect(unworked.problems).toEqual([{ table: 'pmt06', problem: 'pmt06_month_not_worked', document: '2026-11' }]);
	});
});

describe('composition: CMP-08 and GSTR-4', () => {
	const quarter = (
		quarterEnd: string,
		turnoverPaise: number,
		rcm = { igst: 0, cgst: 0, sgst: 0, taxable: 0, records: 0 },
	) => cmp08({ gstin: '19AAGCB5678K1Z1', quarterEnd, ratePercent: 1, turnoverPaise, bills: 120, reverseCharge: rcm });

	it('charges 1% of the quarter’s turnover, half CGST and half SGST, with the reverse-charge tax, all in cash', () => {
		const result = quarter('2026-12', 100_000_000, {
			igst: 0,
			cgst: 9_000,
			sgst: 9_000,
			taxable: 100_000,
			records: 1,
		});
		expect(result.tax).toEqual(heads(0, 509_000, 509_000));
		expect(result.summary).toEqual([
			{ table: 'cmp_outward', records: 120, taxable: 1_000_000, tax: 10_000 },
			{ table: 'cmp_rcm', records: 1, taxable: 1_000, tax: 180 },
			{ table: 'cmp_total', records: 0, taxable: 0, tax: 10_180 },
		]);
		expect(result.portal).toEqual({
			gstin: '19AAGCB5678K1Z1',
			ret_period: '122026',
			rate: 1,
			outward_supplies: { txval: 1_000_000, iamt: 0, camt: 5_000, samt: 5_000, csamt: 0 },
			inward_rcm: { txval: 1_000, iamt: 0, camt: 90, samt: 90, csamt: 0 },
			tax_payable: { iamt: 0, camt: 5_090, samt: 5_090, csamt: 0 },
		});
		expect(result.problems).toEqual([]);
	});

	it('rounds each half to the paisa, and says when credit notes take the turnover below nothing', () => {
		expect(quarter('2026-12', 333).tax).toEqual(heads(0, 2, 2));
		expect(quarter('2026-12', -10_000).problems).toEqual([
			{ table: 'cmp_outward', problem: 'cmp08_turnover_below_zero', document: '2026-12' },
		]);
	});

	const purchase = (supplierGstin: string | null, taxable: number, tax: number, reverseCharge: boolean) => ({
		supplierGstin,
		taxable,
		igst: 0,
		cgst: tax / 2,
		sgst: tax / 2,
		reverseCharge,
	});
	const year = [
		quarter('2026-06', 100_000_000, { igst: 0, cgst: 9_000, sgst: 9_000, taxable: 100_000, records: 1 }).portal,
		quarter('2026-09', 50_000_000).portal,
		quarter('2026-12', 20_000_000).portal,
		quarter('2027-03', 30_000_000).portal,
	];
	const purchases = [
		purchase('27AAKFR1234M1Z5', 100_000, 5_000, false),
		purchase('27AAKFR1234M1Z5', 50_000, 2_500, false),
		purchase('19ABCDE1234F1Z5', 100_000, 18_000, true),
		purchase(null, 50_000, 9_000, true),
		// From an unregistered supplier, no reverse charge: in none of 4A, 4B or 4C.
		purchase(null, 20_000, 0, false),
	];

	it('lists GSTR-4’s inward supplies, the year’s CMP-08s and the turnover by rate', () => {
		expect(gstr4({ gstin: 'G', year: '2026-27', cmp08s: year, purchases })).toEqual({
			summary: [
				{ table: 'gstr4_4a', records: 2, taxable: 1_500, tax: 75 },
				{ table: 'gstr4_4b', records: 1, taxable: 1_000, tax: 180 },
				{ table: 'gstr4_4c', records: 1, taxable: 500, tax: 90 },
				{ table: 'gstr4_5', records: 4, taxable: 2_000_000, tax: 20_180 },
				{ table: 'gstr4_6', records: 0, taxable: 2_000_000, tax: 20_000 },
			],
			problems: [],
			portal: {
				gstin: 'G',
				fy: '2026-27',
				inward: {
					registered: { txval: 1_500, tax: 75 },
					registered_rcm: { txval: 1_000, tax: 180 },
					unregistered_rcm: { txval: 500, tax: 90 },
				},
				cmp08_summary: { txval: 2_000_000, tax: 20_180 },
				outward_by_rate: [{ rate: 1, txval: 2_000_000, tax: 20_000 }],
			},
		});
	});

	it('says how many quarters’ CMP-08 are missing, and reads an odd file as nothing', () => {
		const odd = { outward_supplies: 'x', tax_payable: null, rate: 'one' };
		const short = gstr4({ gstin: 'G', year: '2026-27', cmp08s: [...year.slice(0, 2), odd], purchases: [] });
		expect(short.problems).toEqual([{ table: '5', problem: 'gstr4_quarters_missing', document: '1' }]);
		expect(short.summary[3]).toEqual({ table: 'gstr4_5', records: 3, taxable: 1_500_000, tax: 15_180 });
		expect(short.portal['outward_by_rate']).toEqual([{ rate: 1, txval: 1_500_000, tax: 15_000 }]);
		expect(gstr4({ gstin: 'G', year: '2026-27', cmp08s: [], purchases: [] }).portal['outward_by_rate']).toEqual([
			{ rate: 0, txval: 0, tax: 0 },
		]);
	});
});

describe('the input service distributor', () => {
	const file = {
		gstin: '19AAACS1234K1ZD',
		fp: '112026',
		b2b: [
			{
				ctin: '19AAACL5678M1Z2',
				inv: [
					{
						inum: 'LEG/26-27/41',
						idt: '05-11-2026',
						itms: [{ num: 1, itm_det: { txval: 10_000, iamt: 1_800 } }, { num: 2 }, 'x'],
					},
				],
			},
		],
		cdn: [
			{
				ctin: '19AAACL5678M1Z2',
				nt: [
					{ nt_num: 'CN-7', nt_dt: '2026-11-20', itms: [{ itm_det: { txval: 1_000, camt: 90, samt: 90 } }] },
				],
			},
		],
	};

	it('reads GSTR-6A’s invoices and credit notes, days as written in the file', () => {
		expect(parseGstr6a(file)).toEqual({
			gstin: '19AAACS1234K1ZD',
			month: '2026-11',
			lines: [
				{
					key: '19AAACL5678M1Z2|LEG/26-27/41',
					kind: 'invoice',
					supplierGstin: '19AAACL5678M1Z2',
					number: 'LEG/26-27/41',
					date: '2026-11-05',
					taxable: 1_000_000,
					igst: 180_000,
					cgst: 0,
					sgst: 0,
				},
				{
					key: '19AAACL5678M1Z2|CN-7',
					kind: 'credit',
					supplierGstin: '19AAACL5678M1Z2',
					number: 'CN-7',
					date: '2026-11-20',
					taxable: 100_000,
					igst: 0,
					cgst: 9_000,
					sgst: 9_000,
				},
			],
		});
		expect(parseGstr6a({ gstin: '19AAACS1234K1ZD', fp: '112026' }).lines).toEqual([]);
		expect(
			parseGstr6a({ gstin: '19AAACS1234K1ZD', fp: '112026', b2b: [{ inv: [{ inum: '1' }] }] }).lines[0],
		).toMatchObject({
			supplierGstin: '',
			date: '',
		});
	});

	it('refuses a file without a GSTIN and month, and a party or document it can’t read', () => {
		expect(() => parseGstr6a({ ...file, gstin: '19aaacs1234k1zd' })).toThrow('gstr6a_file_unreadable');
		expect(() => parseGstr6a({ ...file, fp: '2026-11' })).toThrow('gstr6a_file_unreadable');
		expect(() => parseGstr6a({ ...file, b2b: ['not a party'] })).toThrow('gstr6a_line_unreadable');
		expect(() => parseGstr6a({ ...file, b2b: [{ inv: ['not a document'] }] })).toThrow('gstr6a_line_unreadable');
		expect(() => parseGstr6a({ ...file, cdn: [{ nt: [{ nt_dt: '01-11-2026' }] }] })).toThrow(
			'gstr6a_line_unreadable',
		);
	});

	const line = (kind: Gstr6aLine['kind'], number: string, igst: number, cgst: number, sgst: number): Gstr6aLine => ({
		key: `S|${number}`,
		kind,
		supplierGstin: 'S',
		number,
		date: '2026-11-05',
		taxable: 1_000_000,
		igst,
		cgst,
		sgst,
	});
	const lines = [line('invoice', 'INV-1', 100_001, 90_001, 90_001), line('credit', 'CN-1', 0, 1, 1)];
	const recipient = (
		registrationId: string,
		gstin: string,
		stateCode: string,
		turnoverPaise: number,
	): IsdRecipient => ({
		registrationId,
		gstin,
		stateCode,
		turnoverPaise,
	});
	const kolkata = recipient('reg_wb', '19AAACS1234K2ZC', '19', 6_000_000);
	const mumbai = recipient('reg_mh', '27AAACS1234K1ZB', '27', 3_000_000);
	const delhi = recipient('reg_dl', '07AAACS1234K1ZE', '07', 1_000_000);
	const idle = recipient('reg_ka', '29AAACS1234K1Z8', '29', 0);
	const distribute = (recipients: IsdRecipient[], from = lines) =>
		isdDistribution({ isdGstin: '19AAACS1234K1ZD', isdState: '19', month: '2026-11', lines: from, recipients });

	it('shares the month’s credit by turnover, IGST as IGST, CGST and SGST kept in the State and as IGST elsewhere', () => {
		const result = distribute([kolkata, mumbai, delhi, idle]);
		expect(result.credit).toEqual(heads(100_001, 90_000, 90_000));
		expect(result.problems).toEqual([]);
		expect(result.shares).toEqual([
			{
				registrationId: 'reg_wb',
				gstin: '19AAACS1234K2ZC',
				ratioPercent: 60,
				// 60% of each head, and the paisa left over goes to the largest share.
				credit: heads(60_001, 54_000, 54_000),
				from: heads(60_001, 54_000, 54_000),
				invoiceNumber: 'ISD2611-1',
			},
			{
				registrationId: 'reg_mh',
				gstin: '27AAACS1234K1ZB',
				ratioPercent: 30,
				credit: heads(84_000, 0, 0),
				from: heads(30_000, 27_000, 27_000),
				invoiceNumber: 'ISD2611-2',
			},
			{
				registrationId: 'reg_dl',
				gstin: '07AAACS1234K1ZE',
				ratioPercent: 10,
				credit: heads(28_000, 0, 0),
				from: heads(10_000, 9_000, 9_000),
				invoiceNumber: 'ISD2611-3',
			},
		]);
		const shared = result.shares.reduce((s, r) => s + r.from.igst + r.from.cgst + r.from.sgst, 0);
		expect(shared).toBe(100_001 + 90_000 + 90_000);
	});

	it('gives each share’s ratio to two places', () => {
		const result = distribute([recipient('a', 'A', '19', 1), recipient('b', 'B', '19', 2)]);
		expect(result.shares.map((s) => s.ratioPercent)).toEqual([33.33, 66.67]);
	});

	it('distributes nothing with no recipient, none with turnover, or credit notes above the credit', () => {
		expect(distribute([])).toMatchObject({
			shares: [],
			problems: [{ table: 'isd', problem: 'isd_no_recipients', document: '2026-11' }],
		});
		expect(distribute([idle]).problems).toEqual([
			{ table: 'isd', problem: 'isd_no_turnover', document: '2026-11' },
		]);
		const below = [line('invoice', 'INV-1', 100, 0, 0), line('credit', 'CN-1', 200, 0, 0)];
		expect(distribute([kolkata], below)).toMatchObject({
			credit: heads(-100),
			shares: [],
			problems: [{ table: 'isd', problem: 'isd_credit_below_zero', document: '2026-11' }],
		});
		expect(distribute([], below).problems.map((p) => p.problem)).toEqual([
			'isd_no_recipients',
			'isd_credit_below_zero',
		]);
	});

	it('files GSTR-6: the credit received, its distribution and the ISD invoices', () => {
		const distribution = distribute([kolkata, mumbai, delhi]);
		const result = gstr6({ isdGstin: '19AAACS1234K1ZD', month: '2026-11', day: '2026-12-10', lines, distribution });
		expect(result.summary).toEqual([
			{ table: 'gstr6_3', records: 2, taxable: 0, tax: 2_800.01 },
			{ table: 'gstr6_5', records: 3, taxable: 0, tax: 2_800.01 },
			{ table: 'gstr6_8', records: 3, taxable: 0, tax: 0 },
		]);
		expect(result.problems).toEqual([]);
		expect(result.portal['fp']).toBe('112026');
		expect(result.portal['b2b']).toEqual([
			{
				ctin: 'S',
				inum: 'INV-1',
				idt: '05-11-2026',
				txval: 10_000,
				iamt: 1_000.01,
				camt: 900.01,
				samt: 900.01,
				csamt: 0,
			},
		]);
		expect(result.portal['cdn']).toEqual([
			{
				ctin: 'S',
				nt_num: 'CN-1',
				nt_dt: '05-11-2026',
				txval: 10_000,
				iamt: 0,
				camt: 0.01,
				samt: 0.01,
				csamt: 0,
			},
		]);
		expect(result.portal['isd']).toEqual([
			{
				rcpgstin: '19AAACS1234K2ZC',
				docs: [{ docnum: 'ISD2611-1', docdt: '10-12-2026', iamt: 600.01, camt: 540, samt: 540, csamt: 0 }],
			},
			{
				rcpgstin: '27AAACS1234K1ZB',
				docs: [{ docnum: 'ISD2611-2', docdt: '10-12-2026', iamt: 840, camt: 0, samt: 0, csamt: 0 }],
			},
			{
				rcpgstin: '07AAACS1234K1ZE',
				docs: [{ docnum: 'ISD2611-3', docdt: '10-12-2026', iamt: 280, camt: 0, samt: 0, csamt: 0 }],
			},
		]);
	});

	it('carries a distribution’s problems into GSTR-6', () => {
		const distribution = distribute([]);
		expect(gstr6({ isdGstin: 'G', month: '2026-11', day: '2026-12-10', lines: [], distribution }).problems).toEqual(
			[{ table: 'isd', problem: 'isd_no_recipients', document: '2026-11' }],
		);
	});
});

describe('which returns a GSTIN files, and what a filing locks', () => {
	it('locks a quarter for CMP-08 and for QRMP’s GSTR-1 and GSTR-3B, otherwise only the month itself', () => {
		const q = ['2026-10', '2026-11', '2026-12'];
		expect(coveredMonths('CMP-08', '2026-12', null)).toEqual(q);
		expect(coveredMonths('GSTR-1', '2026-12', 'qrmp')).toEqual(q);
		expect(coveredMonths('GSTR-3B', '2026-11', 'qrmp')).toEqual(q);
		expect(coveredMonths('GSTR-1', '2026-11', 'monthly')).toEqual([]);
		expect(coveredMonths('IFF', '2026-11', 'qrmp')).toEqual([]);
		expect(coveredMonths('GSTR-6', '2026-11', null)).toEqual([]);
	});

	it('files CMP-08 under composition, GSTR-6 as an ISD, IFF and PMT-06 too under QRMP', () => {
		expect(returnsFor('composition', 'monthly')).toEqual(['CMP-08']);
		expect(returnsFor('isd', 'monthly')).toEqual(['GSTR-6']);
		expect(returnsFor('regular', 'qrmp')).toEqual(['IFF', 'PMT-06', 'GSTR-1', 'GSTR-3B']);
		expect(returnsFor('regular', 'monthly')).toEqual(['GSTR-1', 'GSTR-3B']);
		expect(returnsFor('casual', 'monthly')).toEqual(['GSTR-1', 'GSTR-3B']);
	});
});
