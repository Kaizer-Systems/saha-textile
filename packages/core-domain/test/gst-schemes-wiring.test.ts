import { describe, expect, it } from 'vitest';

import { compositionRefuses } from '../src/company/company-rules';
import { dueFromRules } from '../src/gst/gst-calendar';
import { gstr1 } from '../src/gst/gstr1-rules';
import { gstr3b, isdCreditInBooks, setOff, setOffPostings, type Gstr3bInput } from '../src/gst/gstr3b-rules';
import { buildInvoiceLines } from '../src/invoicing/tax-invoice-rules';
import { DUE_DATES_V2 } from '../src/templates/starter-packs';

import type { CreditNote, TaxInvoice } from '@saha-textile/contracts';

/**
 * QRMP, composition and the ISD wired through the returns: the due dates of RS-DUE v2 (IFF on the 13th and PMT-06 on
 * the 25th in a quarter's first two months, CMP-08 on the 18th after the quarter, GSTR-4 by 30 April, GSTR-6 on the
 * 13th); a quarter's GSTR-1 leaving out what IFF reported; GSTR-3B taking ISD credit in 4A(4) and paying from the
 * PMT-06 deposits first; composition's bills of supply without tax and no sale outside its State.
 */

const heads = (igst: number, cgst = 0, sgst = 0) => ({ igst, cgst, sgst });
const ZERO = heads(0);
const RULES = DUE_DATES_V2.entries;
const WB = '19';

describe('RS-DUE version 2', () => {
	it('adds IFF, PMT-06, CMP-08, GSTR-4 and GSTR-6 to the six rules of version 1', () => {
		expect(RULES.map((e) => e.key)).toEqual([
			'gstr1_monthly',
			'gstr1_qrmp',
			'gstr3b_monthly',
			'gstr3b_qrmp_22',
			'gstr3b_qrmp_24',
			'gstr9_annual',
			'iff_qrmp',
			'pmt06_qrmp',
			'cmp08_quarter',
			'gstr4_annual',
			'gstr6_monthly',
		]);
	});

	it('falls IFF due on the 13th and PMT-06 on the 25th, only in a quarter’s first two months', () => {
		expect(dueFromRules(RULES, 'IFF', '2026-10', 'qrmp', WB)).toBe('2026-11-13');
		expect(dueFromRules(RULES, 'IFF', '2026-11', 'qrmp', WB)).toBe('2026-12-13');
		expect(dueFromRules(RULES, 'IFF', '2026-12', 'qrmp', WB)).toBeNull();
		expect(dueFromRules(RULES, 'PMT-06', '2026-11', 'qrmp', WB)).toBe('2026-12-25');
		expect(dueFromRules(RULES, 'PMT-06', '2027-03', 'qrmp', WB)).toBeNull();
		// Not for a monthly filer.
		expect(dueFromRules(RULES, 'IFF', '2026-11', 'monthly', WB)).toBeNull();
	});

	it('falls CMP-08 due on the 18th after each quarter, whatever the scheme, and nothing in between', () => {
		expect(dueFromRules(RULES, 'CMP-08', '2026-12', 'monthly', WB)).toBe('2027-01-18');
		expect(dueFromRules(RULES, 'CMP-08', '2027-03', 'qrmp', WB)).toBe('2027-04-18');
		expect(dueFromRules(RULES, 'CMP-08', '2026-11', 'monthly', WB)).toBeNull();
	});

	it('falls GSTR-4 due on 30 April after the year, and GSTR-6 on the 13th of each month', () => {
		expect(dueFromRules(RULES, 'GSTR-4', '2027-03', 'monthly', WB)).toBe('2027-04-30');
		expect(dueFromRules(RULES, 'GSTR-6', '2026-11', 'monthly', WB)).toBe('2026-12-13');
		expect(dueFromRules(RULES, 'GSTR-6', '2026-12', 'qrmp', WB)).toBe('2027-01-13');
	});

	it('keeps QRMP’s GSTR-1 and GSTR-3B to the quarter’s last month', () => {
		expect(dueFromRules(RULES, 'GSTR-1', '2026-11', 'qrmp', WB)).toBeNull();
		expect(dueFromRules(RULES, 'GSTR-1', '2026-12', 'qrmp', WB)).toBe('2027-01-13');
		expect(dueFromRules(RULES, 'GSTR-3B', '2026-12', 'qrmp', WB)).toBe('2027-01-24');
	});
});

describe('a quarter’s GSTR-1 after IFF', () => {
	const RANG = '19DBYPS6736R1ZZ';
	const invoice = (id: string, number: string): TaxInvoice => ({
		id,
		number,
		date: '2026-11-10',
		gstRegistrationId: 'gst_wb',
		gstin: RANG,
		locationId: 'loc',
		orderId: 'ord',
		orderNumber: 'ST-1',
		shipmentId: null,
		seller: { name: 'Saha Textile', gstin: RANG, address: '', stateCode: '19' },
		buyer: { name: 'Boutique', gstin: RANG, address: '', stateCode: '19' },
		placeOfSupply: '19',
		interState: false,
		lines: [
			{
				lineId: 'l1',
				sku: 'S',
				title: 'Saree',
				hsn: '50072010',
				quantity: 1,
				unit: 'PCS',
				unitPriceINR: 1_050,
				ratePercent: 5,
				taxableINR: 1_000,
				cgstINR: 25,
				sgstINR: 25,
				igstINR: 0,
				totalINR: 1_050,
			},
		],
		shippingINR: 0,
		taxableINR: 1_000,
		cgstINR: 25,
		sgstINR: 25,
		igstINR: 0,
		roundOffINR: 0,
		totalINR: 1_050,
		ratesPendingCa: false,
		billOfSupply: false,
		status: 'issued',
		cancellation: null,
		voucherId: null,
		createdBy: null,
		createdAt: '2026-11-10T06:00:00.000Z',
	});
	const i1 = invoice('ti_1', 'TI/1');
	const i2 = invoice('ti_2', 'TI/2');
	const credit = {
		...i1,
		id: 'cn_1',
		number: 'CN/1',
		status: 'issued',
		kind: 'goods_returned',
		date: '2026-11-20',
		invoiceId: 'ti_1',
		invoiceNumber: 'TI/1',
		invoiceDate: '2026-11-10',
		returnId: null,
		reason: 'Returned',
		refundTo: 'original_payment',
		lines: i1.lines.map((l) => ({
			...l,
			outcome: 'restock',
			unitCostINR: null,
			layerId: null,
			holdId: null,
			delivery: false,
			note: '',
		})),
		deadline: '2027-11-30',
		refund: null,
		debitNoteId: null,
		version: 0,
		issuedAt: null,
		issuedBy: null,
	} as unknown as CreditNote;
	const run = (reportedInIff?: ReadonlySet<string>) =>
		gstr1({
			gstin: RANG,
			month: '2026-12',
			invoices: [i1, i2],
			creditNotes: [credit],
			debitNotes: [],
			originals: new Map([
				[i1.id, i1],
				[i2.id, i2],
			]),
			hsnDigits: 6,
			...(reportedInIff ? { reportedInIff } : {}),
		});

	it('reports every B2B invoice and note without an IFF', () => {
		const all = run();
		expect(all.portal.b2b[0]?.inv.map((i) => i.inum)).toEqual(['TI/1', 'TI/2']);
		expect(all.portal.cdnr[0]?.nt.map((n) => n.nt_num)).toEqual(['CN/1']);
		expect(run(new Set()).portal.b2b[0]?.inv).toHaveLength(2);
	});

	it('leaves out of 4A and 9B what an IFF reported, but keeps it in the HSN summary and table 13', () => {
		const quarter = run(new Set(['TI/1', 'CN/1']));
		expect(quarter.portal.b2b[0]?.inv.map((i) => i.inum)).toEqual(['TI/2']);
		expect(quarter.portal.cdnr).toEqual([]);
		expect(quarter.summary.find((r) => r.table === '4A')).toEqual({
			table: '4A',
			records: 1,
			taxable: 1_000,
			tax: 50,
		});
		expect(quarter.summary.find((r) => r.table === '9B')?.records).toBe(0);
		// Two pieces sold, one back, all in the HSN summary; both invoices and the note in table 13.
		expect(quarter.portal.hsn.hsn_b2b[0]).toMatchObject({ qty: 1, txval: 1_000 });
		expect(quarter.portal.doc_issue.doc_det.map((d) => [d.doc_num, d.docs[0]?.totnum])).toEqual([
			[1, 2],
			[5, 1],
		]);
	});
});

describe('GSTR-3B with ISD credit and PMT-06 deposits', () => {
	const bare: Gstr3bInput = {
		gstin: '19DBYPS6736R1ZZ',
		month: '2026-12',
		gstr1Portal: {},
		selfInvoices: [],
		twoBImported: true,
		itc2b: heads(10_000),
		acceptedNotInBooks: 0,
		reversedInBooks: ZERO,
		rule37: ZERO,
		reclaimed: ZERO,
		adjustments: [],
	};

	it('adds an ISD’s credit to 4A, in its own row', () => {
		const withIsd = gstr3b({ ...bare, isdCredit: heads(2_000, 300, 300) });
		expect(withIsd.summary.find((r) => r.table === '4A')?.tax).toBe(126);
		const avl = (withIsd.portal['itc_elg'] as { itc_avl: { ty: string; iamt: number; camt: number }[] }).itc_avl;
		expect(avl.find((r) => r.ty === 'ISD')).toEqual({ ty: 'ISD', iamt: 20, camt: 3, samt: 3, csamt: 0 });
		expect(avl.find((r) => r.ty === 'OTH')).toMatchObject({ iamt: 100 });
		const without = gstr3b(bare);
		expect(without.summary.find((r) => r.table === '4A')?.tax).toBe(100);
	});

	// The approved Q7 picture: cash 0 / 13,000 / 16,700, reverse charge 0 / 5,475 / 5,475.
	const q7 = setOff(heads(1_840_000, 4_820_000, 4_820_000), heads(2_210_000, 3_150_000, 3_150_000));
	const reverseCharge = heads(0, 547_500, 547_500);

	it('pays each head’s cash from the quarter’s PMT-06 deposits first, and the rest by challan', () => {
		// Deposited ₹5,000 CGST and ₹20,000 SGST: SGST needs only ₹16,700 of it.
		const posted = setOffPostings(q7, reverseCharge, heads(0, 500_000, 2_000_000));
		expect(posted.journal.slice(-3)).toEqual([
			{ role: 'output_cgst', debitPaise: 500_000 },
			{ role: 'output_sgst', debitPaise: 1_670_000 },
			{ role: 'gst_cash_ledger', creditPaise: 2_170_000 },
		]);
		expect(posted.challan).toEqual([
			{ role: 'output_cgst', debitPaise: 800_000 },
			{ role: 'rcm_payable', debitPaise: 1_095_000 },
		]);
		expect(posted.cashPaise).toBe(1_895_000);
		const debits = posted.journal.reduce((s, r) => s + (r.debitPaise ?? 0), 0);
		const credits = posted.journal.reduce((s, r) => s + (r.creditPaise ?? 0), 0);
		expect(debits).toBe(credits);
	});

	it('posts as before with no deposits', () => {
		expect(setOffPostings(q7, reverseCharge, null)).toEqual(setOffPostings(q7, reverseCharge));
		expect(setOffPostings(q7, reverseCharge).cashPaise).toBe(4_065_000);
	});

	it('reads 4A(4) from the ISD’s posted distribution at the GSTIN’s locations, never below nothing', () => {
		const ledgers = { igst: 'led_input_igst', cgst: 'led_input_cgst', sgst: 'led_input_sgst' };
		const line = (ledgerId: string, debitPaise: number, creditPaise: number, locationId = 'loc_kolkata') => ({
			ledgerId,
			locationId,
			debitPaise,
			creditPaise,
		});
		expect(
			isdCreditInBooks(
				[
					{
						source: { type: 'isdDistribution' },
						lines: [
							line('led_input_igst', 60_001, 0),
							line('led_input_cgst', 54_000, 0),
							line('led_input_sgst', 0, 100),
							line('led_isd_clearing', 0, 114_001),
							line('led_input_igst', 99_999, 0, 'loc_mumbai'),
						],
					},
					{ source: { type: 'stockAdjustment' }, lines: [line('led_input_igst', 5, 0)] },
					{ source: null, lines: [line('led_input_igst', 5, 0)] },
					{ lines: [line('led_input_igst', 5, 0)] },
				],
				ledgers,
				new Set(['loc_kolkata']),
			),
		).toEqual(heads(60_001, 54_000, 0));
	});
});

describe('composition sellers', () => {
	const registration = (kind: string) => ({
		stateCode: '19',
		terms: [{ from: '2026-04-01', kind, scheme: 'monthly' } as never],
	});

	it('refuses a sale outside its own State, abroad included, while under composition', () => {
		expect(compositionRefuses(registration('composition'), '2026-11-24', '19')).toBe(false);
		expect(compositionRefuses(registration('composition'), '2026-11-24', '27')).toBe(true);
		expect(compositionRefuses(registration('composition'), '2026-11-24', '96')).toBe(true);
		expect(compositionRefuses(registration('regular'), '2026-11-24', '27')).toBe(false);
		// Before its terms began, nothing is known: no refusal.
		expect(compositionRefuses(registration('composition'), '2026-03-31', '27')).toBe(false);
	});

	it('issues bills of supply: the whole price is the value, no tax, delivery included', () => {
		const built = buildInvoiceLines(
			[
				{
					lineId: 'a',
					sku: 'S1',
					title: 'Saree',
					hsn: '50072010',
					quantity: 1,
					unit: 'PCS',
					lineTotalINR: 1_050,
				},
				// No rate is looked up, so an HSN without one is no problem.
				{ lineId: 'b', sku: 'S2', title: 'Odd', hsn: '00000000', quantity: 2, unit: 'PCS', lineTotalINR: 200 },
			],
			{ interState: false, shippingINR: 105, composition: true },
		);
		expect(built.problems).toEqual([]);
		expect(built.lines.map((l) => [l.ratePercent, l.taxableINR, l.cgstINR + l.sgstINR + l.igstINR])).toEqual([
			[0, 1_050, 0],
			[0, 200, 0],
		]);
		expect(built.totals).toMatchObject({ taxableINR: 1_355, cgstINR: 0, sgstINR: 0, igstINR: 0, totalINR: 1_355 });
	});
});
