import { describe, expect, it } from 'vitest';

import {
	ITC_REVERSAL_SOURCES,
	type Gstr3bInput,
	type Rule37Bill,
	day180,
	gstr3b,
	outwardFromGstr1,
	reversedInBooks,
	rule37,
	setOff,
} from '../src/gst/gstr3b-rules';

/**
 * GSTR-3B (accounts brief G6, Q7), checked against the law: the set-off order of s.49(5), s.49A and rule 88A; reverse
 * charge paid in cash only (s.49(4)) and its credit in 4A(3); credit taken back for goods lost or written off
 * (s.17(5)(h)) in 4B(1) and for bills unpaid after 180 days (rule 37) in 4B(2), as Notification 14/2022-CT and Circular
 * 170/02/2022 place them; outward supplies from the filed GSTR-1.
 */

const heads = (igst: number, cgst: number, sgst: number) => ({ igst, cgst, sgst });
const ZERO = heads(0, 0, 0);
/** Rupees to paise, for figures read off the approved pictures. */
const p = (rupees: number) => Math.round(rupees * 100);

describe('the set-off (s.49(5), s.49A, rule 88A)', () => {
	it('works the approved Q7 picture: IGST credit first, CGST and SGST credit on their own heads, the rest in cash', () => {
		const result = setOff(heads(p(18_400), p(48_200), p(48_200)), heads(p(22_100), p(31_500), p(31_500)));
		expect(result).toEqual({
			liability: heads(p(18_400), p(48_200), p(48_200)),
			credit: heads(p(22_100), p(31_500), p(31_500)),
			igstUsed: heads(p(18_400), p(3_700), 0),
			cgstUsed: { cgst: p(31_500), igst: 0 },
			sgstUsed: { sgst: p(31_500), igst: 0 },
			cash: heads(0, p(13_000), p(16_700)),
			carried: ZERO,
		});
	});

	it('pays IGST left over from CGST credit, then SGST credit, and carries what is left', () => {
		const result = setOff(heads(100_000, 0, 0), heads(30_000, 50_000, 40_000));
		expect(result).toMatchObject({
			igstUsed: heads(30_000, 0, 0),
			cgstUsed: { cgst: 0, igst: 50_000 },
			sgstUsed: { sgst: 0, igst: 20_000 },
			cash: ZERO,
			carried: heads(0, 0, 20_000),
		});
	});

	it('uses IGST credit up before CGST and SGST credit, then carries the CGST and SGST credit forward', () => {
		const result = setOff(heads(10_000, 10_000, 10_000), heads(50_000, 5_000, 5_000));
		expect(result).toMatchObject({
			igstUsed: heads(10_000, 10_000, 10_000),
			cgstUsed: { cgst: 0, igst: 0 },
			sgstUsed: { sgst: 0, igst: 0 },
			cash: ZERO,
			carried: heads(20_000, 5_000, 5_000),
		});
	});

	it('never pays SGST from CGST credit, nor CGST from SGST credit', () => {
		expect(setOff(heads(0, 0, 10_000), heads(0, 10_000, 0))).toMatchObject({
			cash: heads(0, 0, 10_000),
			carried: heads(0, 10_000, 0),
		});
		expect(setOff(heads(0, 10_000, 0), heads(0, 0, 10_000))).toMatchObject({
			cash: heads(0, 10_000, 0),
			carried: heads(0, 0, 10_000),
		});
	});

	it('pays everything in cash without credit, and carries everything without tax', () => {
		expect(setOff(heads(1, 2, 3), ZERO)).toMatchObject({ cash: heads(1, 2, 3), carried: ZERO });
		expect(setOff(ZERO, heads(1, 2, 3))).toMatchObject({ cash: ZERO, carried: heads(1, 2, 3) });
	});
});

const item = (txval: number, iamt: number, camt = 0, samt = 0) => ({
	itm_det: { txval, rt: 5, iamt, camt, samt, csamt: 0 },
});

/** A filed GSTR-1's portal file, in rupees, as gstr1() writes it. */
const gstr1Portal = {
	gstin: '19DBYPS6736R1ZZ',
	fp: '112026',
	b2b: [{ ctin: '27AAKFR1234M1Z5', inv: [{ inum: 'TI/1', itms: [item(1_000, 50), item(3_088.98, 556.02)] }] }],
	b2cl: [
		{ pos: '27', inv: [{ inum: 'TI/3', itms: [item(200_000, 10_000)] }] },
		{ pos: '09', inv: [{ inum: 'TI/8', itms: [item(150_000, 7_500)] }] },
	],
	b2cs: [
		{ sply_ty: 'INTRA', pos: '19', typ: 'OE', txval: 500, rt: 5, iamt: 0, camt: 12.5, samt: 12.5 },
		{ sply_ty: 'INTER', pos: '27', typ: 'OE', txval: 95_238.1, rt: 5, iamt: 4_761.9, camt: 0, samt: 0 },
		{ sply_ty: 'INTER', pos: '07', typ: 'OE', txval: 1_000, rt: 5, iamt: 50, camt: 0, samt: 0 },
	],
	// An export under LUT, its item written flat.
	exp: [{ exp_typ: 'WOPAY', inv: [{ inum: 'TI/6', itms: [{ txval: 6_000, rt: 5, iamt: 0, csamt: 0 }] }] }],
	cdnr: [
		{
			ctin: '27AAKFR1234M1Z5',
			nt: [
				{ ntty: 'C', nt_num: 'CN/2', itms: [item(1_500, 270)] },
				{ ntty: 'D', nt_num: 'DN/1', itms: [item(1_500, 270)] },
			],
		},
	],
	cdnur: [
		{ typ: 'B2CL', ntty: 'C', nt_num: 'CN/3', pos: '27', itms: [item(50_000, 2_500)] },
		// Takes Uttar Pradesh's small sale right back to nothing.
		{ typ: 'B2CL', ntty: 'C', nt_num: 'CN/7', pos: '07', itms: [item(1_000, 50)] },
		{ typ: 'EXPWOP', ntty: 'C', nt_num: 'CN/4', pos: '96', itms: [item(3_000, 0)] },
		{ typ: 'EXPWP', ntty: 'D', nt_num: 'DN/9', pos: '96', itms: [item(100, 5)] },
	],
	hsn: { hsn_b2b: [], hsn_b2c: [] },
};

describe('outward supplies from the filed GSTR-1', () => {
	const outward = outwardFromGstr1(gstr1Portal);

	it('adds B2B, B2CL and B2CS into 3.1(a), credit notes less and debit notes more', () => {
		// ₹4,088.98 + ₹3,50,000 + ₹96,738.10 − ₹1,500 + ₹1,500 − ₹50,000 − ₹1,000.
		expect(outward.taxable).toEqual({
			taxable: p(399_827.08),
			igst: p(20_367.92),
			cgst: p(12.5),
			sgst: p(12.5),
			records: 10,
		});
	});

	it('puts exports and the notes on them in 3.1(b), whether or not IGST was paid', () => {
		expect(outward.zeroRated).toEqual({ taxable: p(3_100), igst: p(5), records: 3 });
	});

	it('lists inter-State supplies to unregistered buyers by place of supply for 3.2, a State netted to nothing left out', () => {
		expect(outward.unregisteredInterState).toEqual([
			{ pos: '09', taxable: p(150_000), igst: p(7_500) },
			{ pos: '27', taxable: p(245_238.1), igst: p(12_261.9) },
		]);
	});

	it('reads an empty or odd file as nothing: amounts that are not numbers, notes without a place', () => {
		expect(outwardFromGstr1({})).toEqual({
			taxable: { taxable: 0, igst: 0, cgst: 0, sgst: 0, records: 0 },
			zeroRated: { taxable: 0, igst: 0, records: 0 },
			unregisteredInterState: [],
		});
		const odd = outwardFromGstr1({
			b2b: [
				{
					inv: [
						{ itms: [{ itm_det: { txval: '100', iamt: Number.POSITIVE_INFINITY } }, 'x'] },
						{ inum: 'no items' },
					],
				},
			],
			cdnur: [
				{ typ: 'B2CL', ntty: 'D', pos: null, itms: [item(10, 0.5)] },
				{ typ: 'B2CL', ntty: 'D', itms: [item(20, 1)] },
			],
		});
		expect(odd.taxable).toEqual({ taxable: p(30), igst: p(1.5), cgst: 0, sgst: 0, records: 4 });
		// A place that is not a code files under none; a note with no place at all stays out of 3.2.
		expect(odd.unregisteredInterState).toEqual([{ pos: '', taxable: p(10), igst: p(0.5) }]);
	});
});

const month: Gstr3bInput = {
	gstin: '19DBYPS6736R1ZZ',
	month: '2026-11',
	gstr1Portal,
	// Legal fees from an advocate, 18% under reverse charge, in West Bengal.
	selfInvoices: [{ taxable: p(1_000), igst: 0, cgst: p(90), sgst: p(90) }],
	twoBImported: true,
	itc2b: heads(p(15_000), p(3_000), p(3_000)),
	acceptedNotInBooks: 0,
	reversedInBooks: heads(0, p(100), p(100)),
	rule37: heads(p(200), 0, 0),
	reclaimed: heads(p(50), 0, 0),
	adjustments: [],
};

describe('a month’s GSTR-3B', () => {
	const result = gstr3b(month);

	it('sums its tables in rupees: 4C is 4A less 4B, and table 6 the cash with reverse charge', () => {
		expect(result.summary).toEqual([
			{ table: '3.1a', records: 10, taxable: 399_827.08, tax: 20_392.92 },
			{ table: '3.1b', records: 3, taxable: 3_100, tax: 5 },
			{ table: '3.1d', records: 1, taxable: 1_000, tax: 180 },
			{ table: '4A', records: 0, taxable: 0, tax: 21_230 },
			{ table: '4B', records: 0, taxable: 0, tax: 400 },
			{ table: '4C', records: 0, taxable: 0, tax: 20_830 },
			{ table: '6', records: 0, taxable: 0, tax: 180 },
		]);
		expect(result.problems).toEqual([]);
	});

	it('sets output tax, exports’ IGST included, against the net credit, and keeps reverse charge for cash', () => {
		expect(result.setOff).toEqual({
			liability: heads(2_037_292, 1_250, 1_250),
			credit: heads(1_485_000, 299_000, 299_000),
			igstUsed: heads(1_485_000, 0, 0),
			cgstUsed: { cgst: 1_250, igst: 297_750 },
			sgstUsed: { sgst: 1_250, igst: 254_542 },
			cash: ZERO,
			carried: heads(0, 0, 43_208),
		});
		expect(result.reverseChargeCash).toEqual(heads(0, p(90), p(90)));
	});

	it('writes the portal file: outward supplies, 3.2 by State, credit by kind, taken back and net', () => {
		const amt = (iamt: number, camt: number, samt: number) => ({ iamt, camt, samt, csamt: 0 });
		expect(result.portal).toEqual({
			gstin: '19DBYPS6736R1ZZ',
			ret_period: '112026',
			sup_details: {
				osup_det: { txval: 399_827.08, ...amt(20_367.92, 12.5, 12.5) },
				osup_zero: { txval: 3_100, iamt: 5, csamt: 0 },
				osup_nil_exmp: { txval: 0 },
				isup_rev: { txval: 1_000, ...amt(0, 90, 90) },
				osup_nongst: { txval: 0 },
			},
			inter_sup: {
				unreg_details: [
					{ pos: '09', txval: 150_000, iamt: 7_500 },
					{ pos: '27', txval: 245_238.1, iamt: 12_261.9 },
				],
				comp_details: [],
				uin_details: [],
			},
			itc_elg: {
				itc_avl: [
					{ ty: 'IMPG', ...amt(0, 0, 0) },
					{ ty: 'IMPS', ...amt(0, 0, 0) },
					{ ty: 'ISRC', ...amt(0, 90, 90) },
					{ ty: 'ISD', ...amt(0, 0, 0) },
					// 2B's accepted credit and rule 37 credit brought back.
					{ ty: 'OTH', ...amt(15_050, 3_000, 3_000) },
				],
				itc_rev: [
					{ ty: 'RUL', ...amt(0, 100, 100) },
					{ ty: 'OTH', ...amt(200, 0, 0) },
				],
				itc_net: amt(14_850, 2_990, 2_990),
				itc_inelg: [
					{ ty: 'RUL', ...amt(0, 0, 0) },
					{ ty: 'OTH', ...amt(0, 0, 0) },
				],
			},
			inward_sup: {
				isup_details: [
					{ ty: 'GST', inter: 0, intra: 0 },
					{ ty: 'NONGST', inter: 0, intra: 0 },
				],
			},
			intr_ltfee: { intr_details: amt(0, 0, 0) },
		});
	});
});

describe('GSTR-3B’s checks and the accountant’s changes', () => {
	const bare: Gstr3bInput = {
		...month,
		gstr1Portal: {},
		selfInvoices: [],
		itc2b: ZERO,
		reversedInBooks: ZERO,
		rule37: ZERO,
		reclaimed: ZERO,
	};

	it('stops approval without a 2B for the month, or with lines accepted on the portal but not in our books', () => {
		expect(gstr3b({ ...bare, twoBImported: false, acceptedNotInBooks: 3 }).problems).toEqual([
			{ table: '4A', problem: 'gstr2b_missing', document: '2026-11' },
			{ table: '4A', problem: 'accepted_not_in_books', document: '3' },
		]);
	});

	it('flags credit raised above 2B (rule 36(4)) and a change without its reason, but not credit lowered', () => {
		const changed = gstr3b({
			...bare,
			adjustments: [
				{ table: '4A', igst: 0, cgst: 500, sgst: 0, reason: 'Bill entered late' },
				{ table: '4A', igst: -100, cgst: 0, sgst: 0, reason: '  ' },
				{ table: '4B', igst: 0, cgst: 0, sgst: 0, reason: 'Checked' },
			],
		});
		expect(changed.problems).toEqual([
			{ table: '4A', problem: 'credit_over_2b', document: '' },
			{ table: '4A', problem: 'adjustment_reason', document: '' },
		]);
		const lowered = gstr3b({
			...bare,
			adjustments: [{ table: '4A', igst: -100, cgst: 0, sgst: 0, reason: 'Duplicate on the portal' }],
		});
		expect(lowered.problems).toEqual([]);
	});

	it('adds a change to reverse charge to the cash, to 4A’s credit and to its credit taken back', () => {
		const changed = gstr3b({
			...bare,
			itc2b: heads(10_000, 0, 0),
			selfInvoices: [{ taxable: 10_000, igst: 1_800, cgst: 0, sgst: 0 }],
			adjustments: [
				{ table: '3.1d', igst: 200, cgst: 0, sgst: 0, reason: 'Freight missed' },
				{ table: '4A', igst: -1_000, cgst: 0, sgst: 0, reason: 'Duplicate on the portal' },
				{ table: '4B', igst: 300, cgst: 0, sgst: 0, reason: 'Samples given away' },
			],
		});
		expect(changed.reverseChargeCash).toEqual(heads(2_000, 0, 0));
		const elg = changed.portal['itc_elg'] as {
			itc_avl: { ty: string; iamt: number }[];
			itc_rev: { ty: string; iamt: number }[];
		};
		expect(elg.itc_avl.find((row) => row.ty === 'ISRC')?.iamt).toBe(20);
		expect(elg.itc_avl.find((row) => row.ty === 'OTH')?.iamt).toBe(90);
		expect(elg.itc_rev.find((row) => row.ty === 'RUL')?.iamt).toBe(3);
		// 4A: 90 + 20 = 110; 4B: 3; table 6: no output tax, so only the reverse charge.
		expect(changed.summary.find((row) => row.table === '4C')?.tax).toBe(107);
		expect(changed.summary.find((row) => row.table === '6')?.tax).toBe(20);
	});

	it('pays credit taken back beyond the credit there was like tax', () => {
		const owing = gstr3b({ ...bare, itc2b: heads(1_000, 0, 0), reversedInBooks: heads(6_000, 0, 500) });
		expect(owing.setOff.liability).toEqual(heads(5_000, 0, 500));
		expect(owing.setOff.credit).toEqual(ZERO);
		expect(owing.setOff.cash).toEqual(heads(5_000, 0, 500));
		expect(owing.summary.find((row) => row.table === '4C')?.tax).toBe(-55);
		expect(owing.summary.find((row) => row.table === '6')?.tax).toBe(55);
	});
});

describe('credit taken back in the books (s.17(5)(h))', () => {
	const ledgers = { igst: 'led_input_igst', cgst: 'led_input_cgst', sgst: 'led_input_sgst' };
	const line = (ledgerId: string, debitPaise: number, creditPaise: number, locationId = 'loc_kolkata') => ({
		ledgerId,
		locationId,
		debitPaise,
		creditPaise,
	});

	it('names the postings that take credit back and undo it', () => {
		expect(ITC_REVERSAL_SOURCES).toEqual([
			'stockAdjustment',
			'creditNoteInputTax',
			'creditNoteInputTaxCancel',
			'debitNoteInputTax',
		]);
	});

	it('adds input tax credited by those postings at the GSTIN’s locations, less what was restored', () => {
		const reversed = reversedInBooks(
			[
				{
					source: { type: 'stockAdjustment' },
					lines: [
						line('led_input_igst', 0, 1_800),
						line('led_stock_loss', 11_800, 0),
						line('led_input_cgst', 0, 450),
					],
				},
				{ source: { type: 'creditNoteInputTaxCancel' }, lines: [line('led_input_cgst', 150, 0)] },
				{ source: { type: 'debitNoteInputTax' }, lines: [line('led_input_sgst', 0, 450, 'loc_mumbai')] },
				{ source: { type: 'purchaseEntry' }, lines: [line('led_input_igst', 0, 9_999)] },
				{ source: null, lines: [line('led_input_igst', 0, 9_999)] },
				{ lines: [line('led_input_igst', 0, 9_999)] },
			],
			ledgers,
			new Set(['loc_kolkata', 'loc_barasat']),
		);
		expect(reversed).toEqual(heads(1_800, 300, 0));
	});
});

describe('rule 37: bills unpaid 180 days after their date', () => {
	it('counts 180 days from the bill’s date, through a leap February', () => {
		expect(day180('2026-01-01')).toBe('2026-06-30');
		expect(day180('2025-12-12')).toBe('2026-06-10');
		expect(day180('2026-12-31')).toBe('2027-06-29');
		expect(day180('2027-12-31')).toBe('2028-06-28');
	});

	/** ₹11,800 with ₹1,800 IGST, dated 12 December 2025: its 180 days end on 10 June 2026. */
	const bill = (over: Partial<Rule37Bill> = {}): Rule37Bill => ({
		entryId: 'pe_1',
		billDate: '2025-12-12',
		totalPaise: 1_180_000,
		creditedPaise: 0,
		tax: heads(180_000, 0, 0),
		payments: [{ paidOn: '2026-03-01', paise: 590_000 }],
		...over,
	});
	const months = (bills: Rule37Bill[], list: string[]) => list.map((m) => rule37(bills, m));
	const sum = (results: ReturnType<typeof rule37>[], pick: 'reversed' | 'reclaimed') =>
		results.reduce((total, r) => total + r[pick].igst + r[pick].cgst + r[pick].sgst, 0);

	it('takes nothing back before the 180 days end', () => {
		expect(rule37([bill()], '2026-05')).toEqual({
			reversed: heads(0, 0, 0),
			reclaimed: heads(0, 0, 0),
			entries: [],
		});
	});

	it('takes back, once, the credit on the part still unpaid at day 180', () => {
		// Half paid by day 180: half of ₹1,800.
		const around = months([bill()], ['2026-06', '2026-07']);
		expect(sum(around, 'reversed')).toBe(90_000);
		expect(around.flatMap((r) => r.entries)).toEqual([{ entryId: 'pe_1', reversed: 90_000, reclaimed: 0 }]);
	});

	it('takes nothing back from a bill paid in full, or settled by debit notes, within 180 days', () => {
		const paid = bill({ payments: [{ paidOn: '2026-06-10', paise: 1_180_000 }] });
		const credited = bill({ creditedPaise: 590_000 });
		expect(sum(months([paid, credited], ['2026-06', '2026-07', '2026-08']), 'reversed')).toBe(0);
	});

	it('brings credit back in the month a later payment is made, never more than was taken back', () => {
		const payments = [
			{ paidOn: '2026-03-01', paise: 590_000 },
			{ paidOn: '2026-09-15', paise: 295_000 },
			{ paidOn: '2026-11-02', paise: 400_000 },
		];
		const [sep, oct, nov, dec] = months([bill({ payments })], ['2026-09', '2026-10', '2026-11', '2026-12']);
		expect(sep?.reclaimed).toEqual(heads(45_000, 0, 0));
		expect(sep?.entries).toEqual([{ entryId: 'pe_1', reversed: 0, reclaimed: 45_000 }]);
		expect(oct?.entries).toEqual([]);
		// ₹4,000 paid where ₹2,950 was still owed: only that share comes back.
		expect(nov?.reclaimed).toEqual(heads(45_000, 0, 0));
		expect(dec).toEqual({ reversed: heads(0, 0, 0), reclaimed: heads(0, 0, 0), entries: [] });
	});

	it('shares the credit across the taxes as the bill does', () => {
		const intra = bill({ tax: heads(0, 90_000, 90_000) });
		const around = months([intra], ['2026-06', '2026-07']);
		expect(around.reduce((s, r) => s + r.reversed.cgst, 0)).toBe(45_000);
		expect(around.reduce((s, r) => s + r.reversed.sgst, 0)).toBe(45_000);
	});
});
