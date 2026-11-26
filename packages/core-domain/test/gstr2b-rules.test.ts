import { describe, expect, it } from 'vitest';

import {
	type BooksBill,
	type Gstr2bLine,
	type Gstr2bRow,
	claimFrom2b,
	countResults,
	defaultAction,
	lastClaimMonth,
	parseGstr2b,
	reconcile2b,
} from '../src/gst/gstr2b-rules';

/**
 * GSTR-2B against our purchases (accounts brief G5), checked against the law: credit only for what the supplier
 * reported and 2B shows (s.16(2)(aa), rule 36(4)), never more than our own bill, nothing on reverse charge (claimed
 * through the self-invoice) or on a line 2B marks not available, a supplier's credit note taking credit back, and the
 * s.16(4) limit of 30 November after the bill's financial year.
 */

const RANG = '27AAKFR1234M1Z5';
const KANCHI = '33AABCK4321L1Z8';

/** The 2B file as the portal gives it, inside its `data` wrapper. */
const portalFile = () => ({
	chksum: 'x',
	data: {
		gstin: '19dbyps6736r1zz',
		rtnprd: '112026',
		gendt: '14-12-2026',
		version: '1.0',
		docdata: {
			b2b: [
				{
					ctin: RANG.toLowerCase(),
					trdnm: 'Rang Textiles',
					supprd: '112026',
					supfildt: '11-12-2026',
					inv: [
						{
							inum: 'RT/26-27/0041',
							dt: '05-11-2026',
							val: 11_800,
							pos: '19',
							rev: 'N',
							itcavl: 'Y',
							rsn: '',
							txval: 10_000,
							igst: 1_800,
							cgst: 0,
							sgst: 0,
							items: [{ num: 1, rt: 18, txval: 1, igst: 1 }],
						},
						// No totals: the items are added up.
						{
							inum: 'RT/26-27/0042',
							dt: '06-11-2026',
							rev: 'y',
							items: [
								{ num: 1, rt: 18, txval: 5_000, igst: 900, cgst: 0, sgst: 0 },
								{ num: 2, rt: 5, txval: 1_000, igst: 50 },
							],
						},
					],
				},
				'not a supplier',
				{
					ctin: KANCHI,
					inv: [
						{
							inum: 'KS-77',
							dt: '20-11-2026',
							itcavl: 'n',
							rsn: 'P',
							txval: 2_000.5,
							cgst: 50.01,
							sgst: 50.01,
							igst: 0,
						},
					],
				},
			],
			cdnr: [
				{
					ctin: RANG,
					trdnm: 'Rang Textiles',
					nt: [
						{ ntnum: 'CN-5', typ: 'C', dt: '25-11-2026', txval: 1_000, igst: 180, cgst: 0, sgst: 0 },
						{ ntnum: 'DN-2', typ: 'd', dt: '26-11-2026', txval: 500, igst: 90, cgst: 0, sgst: 0 },
						{ ntnum: 'N-9', dt: '27-11-2026', txval: 100, igst: 18, cgst: 0, sgst: 0 },
					],
				},
			],
			b2ba: [{ ctin: RANG, inv: [{ inum: 'A1' }, { inum: 'A2' }] }],
			cdnra: [{ ctin: RANG, nt: [{ ntnum: 'A3' }] }],
			impg: [{ boenum: '1001' }, { boenum: '1002' }],
			impgsez: [{ ctin: KANCHI, boe: [{ boenum: '1' }, { boenum: '2' }, { boenum: '3' }] }],
			ecom: [],
		},
	},
});

describe('reading the 2B file', () => {
	const read = parseGstr2b(portalFile());

	it('reads its GSTIN in capitals, its month and the day it was made', () => {
		expect(read).toMatchObject({ gstin: '19DBYPS6736R1ZZ', month: '2026-11', generatedOn: '2026-12-14' });
	});

	it('reads each supplier invoice with the supplier’s period and filing day, amounts in paise', () => {
		expect(read.lines[0]).toEqual({
			key: `${RANG}|invoice|RT26270041`,
			kind: 'invoice',
			supplierGstin: RANG,
			supplierName: 'Rang Textiles',
			number: 'RT/26-27/0041',
			date: '2026-11-05',
			supplierPeriod: '2026-11',
			filedOn: '2026-12-11',
			taxable: 1_000_000,
			igst: 180_000,
			cgst: 0,
			sgst: 0,
			reverseCharge: false,
			itcAvailable: true,
			reason: null,
		});
	});

	it('adds up the items of a document filed without totals, and reads reverse charge whatever its case', () => {
		expect(read.lines[1]).toMatchObject({ taxable: 600_000, igst: 95_000, cgst: 0, sgst: 0, reverseCharge: true });
	});

	it('keeps 2B’s own word that credit is not available, with its reason, and rounds amounts to the paisa', () => {
		expect(read.lines[2]).toMatchObject({
			key: `${KANCHI}|invoice|KS77`,
			supplierName: '',
			supplierPeriod: null,
			filedOn: null,
			taxable: 200_050,
			cgst: 5_001,
			sgst: 5_001,
			itcAvailable: false,
			reason: 'P',
		});
	});

	it('reads a debit note by its type D, and any other note as a credit note', () => {
		expect(read.lines.slice(3).map((l) => [l.kind, l.key])).toEqual([
			['credit', `${RANG}|credit|CN5`],
			['debit', `${RANG}|debit|DN2`],
			['credit', `${RANG}|credit|N9`],
		]);
	});

	it('counts the sections it does not match: amendments, ISD and imports, each document once', () => {
		expect(read.notRead).toEqual([
			{ section: 'b2ba', count: 2 },
			{ section: 'cdnra', count: 1 },
			{ section: 'impg', count: 2 },
			{ section: 'impgsez', count: 3 },
		]);
	});

	it('reads the file without its wrapper too, with no day made and nothing to set aside', () => {
		const { gendt: _gendt, ...bare } = portalFile().data;
		const unwrapped = parseGstr2b({ ...bare, docdata: { b2b: bare.docdata.b2b } });
		expect(unwrapped).toMatchObject({ gstin: '19DBYPS6736R1ZZ', month: '2026-11', generatedOn: null, notRead: [] });
		expect(unwrapped.lines).toHaveLength(3);
		expect(parseGstr2b({ gstin: 'X', rtnprd: '032027', docdata: {} })).toEqual({
			gstin: 'X',
			month: '2027-03',
			generatedOn: null,
			lines: [],
			notRead: [],
		});
	});

	it('reads an amount that is not a number as nothing', () => {
		const file = {
			gstin: 'X',
			rtnprd: '112026',
			docdata: { b2b: [{ ctin: RANG, inv: [{ inum: '1', dt: '01-11-2026', txval: '100', igst: Number.NaN }] }] },
		};
		expect(parseGstr2b(file).lines[0]).toMatchObject({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
	});

	it('refuses a file that is not a 2B: not an object, no GSTIN, no month, no documents', () => {
		const good = { gstin: 'X', rtnprd: '112026', docdata: {} };
		for (const bad of [
			null,
			'2B',
			[good],
			{ data: 'x' },
			{ ...good, gstin: '  ' },
			{ ...good, rtnprd: '132026' },
			{ ...good, rtnprd: '2026-11' },
			{ ...good, docdata: [] },
			{ gstin: 'X', rtnprd: '112026' },
		])
			expect(() => parseGstr2b(bad)).toThrow('gstr2b_file_unreadable');
	});

	it('refuses a document without its number, its day as dd-mm-yyyy, or its supplier’s GSTIN', () => {
		const file = (supplier: object) => ({ gstin: 'X', rtnprd: '112026', docdata: { b2b: [supplier] } });
		expect(() => parseGstr2b(file({ ctin: RANG, inv: [{ dt: '05-11-2026' }] }))).toThrow('gstr2b_line_unreadable');
		expect(() => parseGstr2b(file({ ctin: RANG, inv: [{ inum: '1', dt: '2026-11-05' }] }))).toThrow(
			'gstr2b_line_unreadable',
		);
		expect(() => parseGstr2b(file({ inv: [{ inum: '1', dt: '05-11-2026' }] }))).toThrow('gstr2b_line_unreadable');
		const note = { gstin: 'X', rtnprd: '112026', docdata: { cdnr: [{ ctin: RANG, nt: [{ dt: '05-11-2026' }] }] } };
		expect(() => parseGstr2b(note)).toThrow('gstr2b_line_unreadable');
	});
});

describe('the action a row starts with', () => {
	it('holds a bill only in our books, rejects what 2B says is not available, accepts what agrees', () => {
		expect(defaultAction('only_books', true)).toBe('held');
		expect(defaultAction('only_books', false)).toBe('held');
		expect(defaultAction('matched', false)).toBe('reject');
		expect(defaultAction('matched', true)).toBe('accept');
		expect(defaultAction('note', true)).toBe('accept');
		expect(defaultAction('different', true)).toBe('pending');
		expect(defaultAction('only_2b', true)).toBe('pending');
	});
});

/** A 2B line in paise. */
const line = (number: string, money: Partial<Gstr2bLine> = {}, kind: Gstr2bLine['kind'] = 'invoice'): Gstr2bLine => ({
	key: `${RANG}|${kind}|${number.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '')}`,
	kind,
	supplierGstin: RANG,
	supplierName: 'Rang Textiles',
	number,
	date: '2026-11-05',
	supplierPeriod: '2026-11',
	filedOn: '2026-12-11',
	taxable: 1_000_000,
	igst: 180_000,
	cgst: 0,
	sgst: 0,
	reverseCharge: false,
	itcAvailable: true,
	reason: null,
	...money,
});

const bill = (entryId: string, billNumber: string, money: Partial<BooksBill> = {}): BooksBill => ({
	entryId,
	entryNumber: `PE/26-27/${entryId}`,
	supplierGstin: RANG.toLowerCase(),
	supplierName: 'Rang Textiles Pvt Ltd',
	billNumber,
	billDate: '2026-11-05',
	taxable: 1_000_000,
	igst: 180_000,
	cgst: 0,
	sgst: 0,
	...money,
});

describe('2B against our bills', () => {
	const lines = [
		line('RT/26-27/0041'),
		line('RT/26-27/0042', { taxable: 1_000_099, igst: 180_100 }),
		line('RT/26-27/0043', { igst: 180_101 }),
		line('RT/26-27/0044', { supplierName: '' }),
		line('RT/26-27/0045', { itcAvailable: false }),
		line('CN-5', { taxable: 100_000, igst: 18_000 }, 'credit'),
	];
	const bills = [
		bill('1', 'rt 26 27 0041'),
		bill('2', 'RT/26-27/0042'),
		bill('3', 'RT-26-27-0043'),
		bill('4', 'RT/26-27/0099'),
		bill('5', 'CN-5'),
	];
	const rows = reconcile2b(lines, bills);
	const byNumber = (number: string) => rows.find((r) => r.number === number) as Gstr2bRow;

	it('matches a bill by the supplier’s GSTIN and its number, however the number is written', () => {
		expect(byNumber('RT/26-27/0041')).toMatchObject({
			result: 'matched',
			entryId: '1',
			entryNumber: 'PE/26-27/1',
			books: { taxable: 1_000_000, igst: 180_000, cgst: 0, sgst: 0 },
			twoB: { taxable: 1_000_000, igst: 180_000, cgst: 0, sgst: 0 },
			action: 'accept',
		});
	});

	it('calls amounts within ₹1 matched, and a paisa more different', () => {
		expect(byNumber('RT/26-27/0042')).toMatchObject({ result: 'matched', action: 'accept' });
		expect(byNumber('RT/26-27/0043')).toMatchObject({ result: 'different', action: 'pending' });
	});

	it('names a 2B invoice we have not entered only in 2B, and rejects one 2B marks not available', () => {
		expect(byNumber('RT/26-27/0044')).toMatchObject({
			result: 'only_2b',
			supplierName: '',
			books: null,
			entryId: null,
			entryNumber: null,
			action: 'pending',
		});
		expect(byNumber('RT/26-27/0045')).toMatchObject({ result: 'only_2b', itcAvailable: false, action: 'reject' });
	});

	it('takes a supplier’s note as a note, never matched to a bill of the same number', () => {
		expect(byNumber('CN-5')).toMatchObject({ result: 'note', kind: 'credit', books: null, action: 'accept' });
	});

	it('holds each bill left over as only in our books, keyed by its entry', () => {
		expect(rows.filter((r) => r.result === 'only_books')).toEqual([
			{
				key: 'books|4',
				result: 'only_books',
				kind: 'invoice',
				supplierGstin: RANG.toLowerCase(),
				supplierName: 'Rang Textiles Pvt Ltd',
				number: 'RT/26-27/0099',
				date: '2026-11-05',
				reverseCharge: false,
				itcAvailable: true,
				books: { taxable: 1_000_000, igst: 180_000, cgst: 0, sgst: 0 },
				twoB: null,
				entryId: '4',
				entryNumber: 'PE/26-27/4',
				action: 'held',
			},
			expect.objectContaining({ key: 'books|5', number: 'CN-5', action: 'held' }),
		]);
	});

	it('names the supplier from our bill when 2B leaves the name out', () => {
		const [row] = reconcile2b([line('RT/26-27/0041', { supplierName: '' })], [bill('1', 'RT/26-27/0041')]);
		expect(row?.supplierName).toBe('Rang Textiles Pvt Ltd');
	});

	it('uses what was done on the portal, never a recorded hold', () => {
		const decided = reconcile2b(lines, bills, {
			[`${RANG}|invoice|RT26270041`]: 'reject',
			[`${RANG}|invoice|RT26270043`]: 'held',
			[`${RANG}|invoice|RT26270044`]: 'accept',
			'books|4': 'accept',
		});
		const action = (number: string) => decided.find((r) => r.number === number)?.action;
		expect(action('RT/26-27/0041')).toBe('reject');
		expect(action('RT/26-27/0043')).toBe('pending');
		expect(action('RT/26-27/0044')).toBe('accept');
		expect(action('RT/26-27/0099')).toBe('held');
	});

	it('counts each result for the chips', () => {
		expect(countResults(rows)).toEqual({ all: 8, matched: 2, different: 1, only_2b: 2, only_books: 2, note: 1 });
		expect(countResults([])).toEqual({ all: 0, matched: 0, different: 0, only_2b: 0, only_books: 0, note: 0 });
	});
});

describe('the credit GSTR-3B may claim from 2B', () => {
	it('claims an accepted bill at the lower of 2B and our bill, tax by tax', () => {
		const rows = reconcile2b(
			[line('A', { igst: 0, cgst: 90_200, sgst: 89_900 })],
			[bill('1', 'A', { igst: 0, cgst: 90_000, sgst: 90_000 })],
			{ [`${RANG}|invoice|A`]: 'accept' },
		);
		expect(rows[0]).toMatchObject({ result: 'different', action: 'accept' });
		expect(claimFrom2b(rows)).toEqual({ igst: 0, cgst: 90_000, sgst: 89_900 });
	});

	it('takes credit back for a supplier’s credit note and adds a debit note', () => {
		const rows = reconcile2b(
			[line('A'), line('CN-1', { igst: 18_000 }, 'credit'), line('DN-1', { igst: 9_000 }, 'debit')],
			[bill('1', 'A')],
		);
		expect(claimFrom2b(rows)).toEqual({ igst: 180_000 - 18_000 + 9_000, cgst: 0, sgst: 0 });
	});

	it('claims nothing pending or rejected, on reverse charge, marked not available, only in 2B or only in our books', () => {
		const rows = reconcile2b(
			[
				line('PENDING'),
				line('REJECTED'),
				line('RCM', { reverseCharge: true }),
				line('NOT-AVAILABLE', { itcAvailable: false }),
				line('ONLY-2B'),
			],
			[
				bill('1', 'PENDING'),
				bill('2', 'REJECTED'),
				bill('3', 'RCM'),
				bill('4', 'NOT-AVAILABLE'),
				bill('5', 'ONLY-BOOKS'),
			],
			{
				[`${RANG}|invoice|PENDING`]: 'pending',
				[`${RANG}|invoice|REJECTED`]: 'reject',
				[`${RANG}|invoice|RCM`]: 'accept',
				[`${RANG}|invoice|NOTAVAILABLE`]: 'accept',
				[`${RANG}|invoice|ONLY2B`]: 'accept',
			},
		);
		expect(rows.map((r) => [r.number, r.result, r.action])).toEqual([
			['PENDING', 'matched', 'pending'],
			['REJECTED', 'matched', 'reject'],
			['RCM', 'matched', 'accept'],
			['NOT-AVAILABLE', 'matched', 'accept'],
			['ONLY-2B', 'only_2b', 'accept'],
			['ONLY-BOOKS', 'only_books', 'held'],
		]);
		// Even an accepted bill only in our books has no 2B line to claim from.
		const forced = rows.map((r) => (r.result === 'only_books' ? { ...r, action: 'accept' as const } : r));
		expect(claimFrom2b(forced)).toEqual({ igst: 0, cgst: 0, sgst: 0 });
	});
});

describe('the s.16(4) time limit', () => {
	it('lets a bill be claimed up to the November after its financial year ends', () => {
		expect(lastClaimMonth('2026-04-01')).toBe('2027-11');
		expect(lastClaimMonth('2026-12-31')).toBe('2027-11');
		expect(lastClaimMonth('2027-01-15')).toBe('2027-11');
		expect(lastClaimMonth('2027-03-31')).toBe('2027-11');
		expect(lastClaimMonth('2027-04-01')).toBe('2028-11');
	});
});
