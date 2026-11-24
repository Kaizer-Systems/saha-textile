import { describe, expect, it } from 'vitest';

import {
	GstReturnDraft,
	GstReturnPrepare,
	GstSetOff,
	GstTaxHeads,
	Gstr2bChip,
	Gstr2bDecision,
	Gstr2bImport,
	Gstr2bImportWrite,
	Gstr2bLine,
	Gstr2bQuery,
	Gstr2bResult,
	Gstr2bRow,
	Gstr2bView,
	Gstr3bAdjustment,
	ImsAction,
} from '../src/gst-returns';

/** GSTR-2B against our purchases (accounts brief G5) and GSTR-3B's set-off and changes (G6, Q7): what the screens send. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const heads = { igst: 0, cgst: 1_300_000, sgst: 1_670_000 };
const setOff = {
	liability: { igst: 1_840_000, cgst: 4_820_000, sgst: 4_820_000 },
	credit: { igst: 2_210_000, cgst: 3_150_000, sgst: 3_150_000 },
	igstUsed: { igst: 1_840_000, cgst: 370_000, sgst: 0 },
	cgstUsed: { cgst: 3_150_000, igst: 0 },
	sgstUsed: { sgst: 3_150_000, igst: 0 },
	cash: heads,
	carried: { igst: 0, cgst: 0, sgst: 0 },
	reverseChargeCash: { igst: 0, cgst: 9_000, sgst: 9_000 },
};
const adjustment = { table: '4A', igst: -100_000, cgst: 0, sgst: 0, reason: 'Duplicate bill on the portal' };

describe('GSTR-3B’s set-off and changes', () => {
	it('keeps tax by head in whole paise, credit taken back as less than nothing', () => {
		expect(GstTaxHeads.parse({ igst: -5, cgst: 0, sgst: 7 })).toEqual({ igst: -5, cgst: 0, sgst: 7 });
		refused(GstTaxHeads.safeParse({ igst: 0.5, cgst: 0, sgst: 0 }).success);
		refused(GstTaxHeads.safeParse({ igst: 0, cgst: 0 }).success);
	});

	it('keeps each credit’s use, the cash, what is carried and the reverse charge apart', () => {
		expect(GstSetOff.parse(setOff)).toEqual(setOff);
		const { reverseChargeCash: _rc, ...withoutReverseCharge } = setOff;
		refused(GstSetOff.safeParse(withoutReverseCharge).success);
		refused(GstSetOff.safeParse({ ...setOff, cgstUsed: { cgst: 0, sgst: 0 } }).success);
	});

	it('takes a change to 3.1(d), 4A or 4B with its reason, trimmed, up to 200 letters', () => {
		expect(Gstr3bAdjustment.parse({ ...adjustment, reason: '  Duplicate bill on the portal ' })).toEqual(
			adjustment,
		);
		for (const table of ['3.1d', '4A', '4B'])
			accepted(Gstr3bAdjustment.safeParse({ ...adjustment, table }).success);
		refused(Gstr3bAdjustment.safeParse({ ...adjustment, table: '3.1a' }).success);
		refused(Gstr3bAdjustment.safeParse({ ...adjustment, reason: '   ' }).success);
		accepted(Gstr3bAdjustment.safeParse({ ...adjustment, reason: 'x'.repeat(200) }).success);
		refused(Gstr3bAdjustment.safeParse({ ...adjustment, reason: 'x'.repeat(201) }).success);
		refused(Gstr3bAdjustment.safeParse({ ...adjustment, igst: 1.5 }).success);
	});

	it('keeps a GSTR-3B draft’s set-off, changes and vouchers, none until prepared and posted', () => {
		const draft = {
			id: 'gstd_3b',
			gstRegistrationId: 'gst_wb',
			gstin: '19DBYPS6736R1ZZ',
			returnType: 'GSTR-3B',
			month: '2026-11',
			status: 'prepared',
			summary: [],
			problems: [],
			portal: {},
			preparedBy: null,
			preparedAt: '2026-12-15T05:00:00.000Z',
		};
		expect(GstReturnDraft.parse(draft)).toMatchObject({
			setOff: null,
			adjustments: [],
			setOffVoucherId: null,
			challanVoucherId: null,
		});
		const posted = {
			...draft,
			setOff,
			adjustments: [adjustment],
			setOffVoucherId: 'vch_setoff',
			challanVoucherId: 'vch_challan',
		};
		expect(GstReturnDraft.parse(posted)).toMatchObject({
			setOff,
			adjustments: [adjustment],
			setOffVoucherId: 'vch_setoff',
			challanVoucherId: 'vch_challan',
		});
		refused(GstReturnDraft.safeParse({ ...draft, adjustments: [{ ...adjustment, reason: '' }] }).success);
	});

	it('prepares a GSTR-3B with up to 30 changes, none by default', () => {
		const ask = { gstRegistrationId: 'gst_wb', returnType: 'GSTR-3B', month: '2026-11' };
		expect(GstReturnPrepare.parse(ask).adjustments).toEqual([]);
		accepted(
			GstReturnPrepare.safeParse({ ...ask, adjustments: Array.from({ length: 30 }, () => adjustment) }).success,
		);
		refused(
			GstReturnPrepare.safeParse({ ...ask, adjustments: Array.from({ length: 31 }, () => adjustment) }).success,
		);
	});
});

const twoBMoney = { taxable: 1_000_000, igst: 180_000, cgst: 0, sgst: 0 };
const line = {
	...twoBMoney,
	key: '27AAKFR1234M1Z5|invoice|RT26270041',
	kind: 'invoice',
	supplierGstin: '27AAKFR1234M1Z5',
	supplierName: 'Rang Textiles',
	number: 'RT/26-27/0041',
	date: '2026-11-05',
	supplierPeriod: '2026-11',
	filedOn: '2026-12-11',
	reverseCharge: false,
	itcAvailable: true,
	reason: null,
};
const row = {
	key: line.key,
	result: 'matched',
	kind: 'invoice',
	supplierGstin: line.supplierGstin,
	supplierName: 'Rang Textiles',
	number: line.number,
	date: line.date,
	reverseCharge: false,
	itcAvailable: true,
	books: twoBMoney,
	twoB: twoBMoney,
	entryId: 'pe_1',
	entryNumber: 'PE/26-27/0001',
	action: 'accept',
};

describe('GSTR-2B against our purchases', () => {
	it('names the portal’s actions, a hold for bills it has not seen, each result and the chips', () => {
		expect(ImsAction.options).toEqual(['accept', 'reject', 'pending', 'held']);
		expect(Gstr2bResult.options).toEqual(['matched', 'different', 'only_2b', 'only_books', 'note']);
		expect(Gstr2bChip.options).toEqual(['all', 'matched', 'different', 'only_2b', 'only_books', 'note']);
	});

	it('keeps a 2B line in whole paise, with the supplier’s period and filing day when 2B gives them', () => {
		expect(Gstr2bLine.parse(line)).toEqual(line);
		accepted(Gstr2bLine.safeParse({ ...line, supplierPeriod: null, filedOn: null, reason: 'P' }).success);
		refused(Gstr2bLine.safeParse({ ...line, taxable: 10.5 }).success);
		refused(Gstr2bLine.safeParse({ ...line, kind: 'refund' }).success);
		refused(Gstr2bLine.safeParse({ ...line, supplierPeriod: '112026' }).success);
		refused(Gstr2bLine.safeParse({ ...line, date: '05-11-2026' }).success);
	});

	it('keeps an import with what was done on the portal for each line, never a hold', () => {
		const imported = {
			id: 'g2b_1',
			gstRegistrationId: 'gst_wb',
			gstin: '19DBYPS6736R1ZZ',
			month: '2026-11',
			generatedOn: '2026-12-14',
			lines: [line],
			notRead: [{ section: 'b2ba', count: 2 }],
			decisions: { [line.key]: 'accept' },
			importedBy: 'adm_1',
			importedByName: 'Accountant',
			importedAt: '2026-12-15T05:00:00.000Z',
			version: 0,
		};
		expect(Gstr2bImport.parse(imported)).toEqual(imported);
		refused(Gstr2bImport.safeParse({ ...imported, decisions: { [line.key]: 'held' } }).success);
		refused(Gstr2bImport.safeParse({ ...imported, notRead: [{ section: 'isd', count: -1 }] }).success);
		refused(Gstr2bImport.safeParse({ ...imported, month: '2026-13' }).success);
	});

	it('imports the file as downloaded, an object, for a registration', () => {
		const write = { gstRegistrationId: 'gst_wb', file: { data: { gstin: '19DBYPS6736R1ZZ' } } };
		expect(Gstr2bImportWrite.parse(write)).toEqual(write);
		refused(Gstr2bImportWrite.safeParse({ ...write, file: 'gstr2b.json' }).success);
		refused(Gstr2bImportWrite.safeParse({ file: write.file }).success);
	});

	it('opens a month on every row', () => {
		expect(Gstr2bQuery.parse({ gstRegistrationId: 'gst_wb', month: '2026-11' })).toEqual({
			gstRegistrationId: 'gst_wb',
			month: '2026-11',
			chip: 'all',
		});
		expect(Gstr2bQuery.parse({ gstRegistrationId: 'gst_wb', month: '2026-11', chip: 'only_2b' }).chip).toBe(
			'only_2b',
		);
		refused(Gstr2bQuery.safeParse({ gstRegistrationId: 'gst_wb', month: '2026-11', chip: 'held' }).success);
		refused(Gstr2bQuery.safeParse({ gstRegistrationId: 'gst_wb', month: '11-2026' }).success);
	});

	it('shows a row with our bill and 2B’s side by side, either missing, and a held bill', () => {
		expect(Gstr2bRow.parse(row)).toEqual(row);
		accepted(
			Gstr2bRow.safeParse({ ...row, result: 'only_2b', books: null, entryId: null, entryNumber: null }).success,
		);
		accepted(
			Gstr2bRow.safeParse({ ...row, key: 'books|pe_1', result: 'only_books', twoB: null, action: 'held' })
				.success,
		);
		refused(Gstr2bRow.safeParse({ ...row, action: 'approve' }).success);
		refused(Gstr2bRow.safeParse({ ...row, books: { ...twoBMoney, igst: 0.5 } }).success);
	});

	it('shows the month with every chip counted, the credit to claim, and whether 3B locked it', () => {
		const counts = { all: 1, matched: 1, different: 0, only_2b: 0, only_books: 0, note: 0 };
		const view = {
			gstin: '19DBYPS6736R1ZZ',
			month: '2026-11',
			importId: 'g2b_1',
			importedAt: '2026-12-15T05:00:00.000Z',
			importedByName: 'Accountant',
			generatedOn: '2026-12-14',
			notRead: [],
			counts,
			rows: [row],
			claim: { igst: 180_000, cgst: 0, sgst: 0 },
			locked: false,
			version: 3,
		};
		expect(Gstr2bView.parse(view)).toEqual(view);
		accepted(
			Gstr2bView.safeParse({ ...view, importId: null, importedAt: null, generatedOn: null, rows: [] }).success,
		);
		const { note: _note, ...fewer } = counts;
		refused(Gstr2bView.safeParse({ ...view, counts: fewer }).success);
		refused(Gstr2bView.safeParse({ ...view, claim: { igst: 0.5, cgst: 0, sgst: 0 } }).success);
	});

	it('records accept, reject or pending for one line at a version, a key of 1 to 120 letters', () => {
		const decision = { gstRegistrationId: 'gst_wb', month: '2026-11', key: line.key, action: 'reject', version: 3 };
		expect(Gstr2bDecision.parse(decision)).toEqual(decision);
		refused(Gstr2bDecision.safeParse({ ...decision, action: 'held' }).success);
		refused(Gstr2bDecision.safeParse({ ...decision, key: '' }).success);
		accepted(Gstr2bDecision.safeParse({ ...decision, key: 'k'.repeat(120) }).success);
		refused(Gstr2bDecision.safeParse({ ...decision, key: 'k'.repeat(121) }).success);
		refused(Gstr2bDecision.safeParse({ ...decision, version: -1 }).success);
	});
});
