import { describe, expect, it } from 'vitest';

import {
	TALLY_GROUPS,
	TALLY_PRIMARY,
	type ImportedLedger,
	csvCells,
	importCheck,
	matchLedgers,
	openingLines,
	parseTallyMasters,
	parseTemplateCsv,
	primaryOf,
	tallyAmountPaise,
	tallyGroupFor,
	tallyXml,
	xmlText,
} from '../src/ledger/books-import';

/**
 * Bringing books in from TallyPrime or a trial balance (accounts brief I1, W1–W3) and taking them out (W4): Tally
 * writes debits as negative amounts (or with Dr / Cr), groups sit under Tally's primary groups, and an export marks a
 * debit with ISDEEMEDPOSITIVE Yes and a negative amount.
 */

/** A TallyPrime masters export, trimmed to what matters. */
const TALLY = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE><GROUP NAME="Shop Exp." RESERVEDNAME=""><PARENT>Indirect Expenses</PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE><GROUP NAME="Indirect Expenses" RESERVEDNAME="Indirect Expenses"><PARENT></PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Cash" RESERVEDNAME=""><PARENT>Cash-in-Hand</PARENT><OPENINGBALANCE>-18420.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="HDFC Bank A/c"><PARENT>Bank Accounts</PARENT><OPENINGBALANCE>-312000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Output CGST @2.5%"><PARENT>Duties &amp; Taxes</PARENT><OPENINGBALANCE>41200</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Tea"><PARENT>Shop Exp.</PARENT></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Ravi &amp; Sons"><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>22,500.00 Dr</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE><LEDGER NAME="Capital"><PARENT>Capital Account</PARENT><OPENINGBALANCE>311,720.00 Cr</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

const chart = {
	groups: [
		{ id: 'g_cash', systemKey: 'cash_in_hand' },
		{ id: 'g_bank', systemKey: 'bank_accounts' },
		{ id: 'g_ind', systemKey: 'indirect_expenses' },
		{ id: 'g_cap', systemKey: 'capital_account' },
	],
	ledgers: [
		{ id: 'l_cash', name: 'Cash', systemKey: 'cash' },
		{ id: 'l_ocgst', name: 'Output CGST', systemKey: 'output_cgst' },
		{ id: 'l_dc', name: 'Debtors control', systemKey: 'debtors_control' },
	],
};
const ledger = (name: string, primary: string | null, openingPaise = 0): ImportedLedger => ({
	name,
	group: primary ?? '',
	primary,
	openingPaise,
});

describe('Tally’s groups', () => {
	it('places each primary group in our chart, by its name in lower case too', () => {
		expect(TALLY_PRIMARY).toHaveLength(29);
		expect(TALLY_PRIMARY[0]).toEqual(['Capital Account', 'capital_account']);
		expect(TALLY_GROUPS['duties & taxes']).toBe('duties_and_taxes');
		expect(TALLY_GROUPS['cash-in-hand']).toBe('cash_in_hand');
		expect(TALLY_GROUPS['bank occ a/c']).toBe('bank_od');
		expect(TALLY_GROUPS['Duties & Taxes']).toBeUndefined();
		expect(Object.keys(TALLY_GROUPS).every((key) => key === key.toLowerCase())).toBe(true);
	});

	it('finds a group’s primary by walking up its parents, and none when the chain breaks or loops', () => {
		const parents = new Map([
			['shop exp.', 'Indirect Expenses'],
			['tea & snacks', 'Shop Exp.'],
			['orphan', 'Nowhere'],
			['loop', 'Loop'],
		]);
		expect(primaryOf('Indirect Expenses', parents)).toBe('Indirect Expenses');
		expect(primaryOf('Tea & Snacks', parents)).toBe('Indirect Expenses');
		expect(primaryOf('Orphan', parents)).toBeNull();
		expect(primaryOf('Loop', parents)).toBeNull();
		expect(primaryOf('', parents)).toBeNull();
	});
});

describe('reading a Tally export', () => {
	it('reads XML text with its entities, numeric ones too, trimmed, never twice', () => {
		expect(xmlText('  Ravi &amp; Sons &lt;Kolkata&gt; &quot;A&quot; &apos;B&apos;&#13;&#10; ')).toBe(
			`Ravi & Sons <Kolkata> "A" 'B'`,
		);
		expect(xmlText('&amp;#13;')).toBe('&#13;');
		expect(xmlText('Tea&#38;Snacks')).toBe('Tea&Snacks');
	});

	it('reads Tally’s amounts: a debit as negative, or by Dr and Cr, with commas', () => {
		expect(tallyAmountPaise(null)).toBe(0);
		expect(tallyAmountPaise('')).toBe(0);
		expect(tallyAmountPaise('-18420.00')).toBe(1_842_000);
		expect(tallyAmountPaise('41200')).toBe(-4_120_000);
		expect(tallyAmountPaise('41,200.00 Cr')).toBe(-4_120_000);
		expect(tallyAmountPaise('-41,200.00 cr')).toBe(-4_120_000);
		expect(tallyAmountPaise('500 Dr')).toBe(50_000);
		expect(tallyAmountPaise('-500 DR')).toBe(50_000);
		expect(tallyAmountPaise('  12.345 ')).toBe(-1_235);
		expect(tallyAmountPaise('about ₹500')).toBe(0);
		expect(tallyAmountPaise('500 Rs')).toBe(0);
	});

	it('reads every ledger with its group, primary group and opening balance', () => {
		expect(parseTallyMasters(TALLY)).toEqual([
			{ name: 'Cash', group: 'Cash-in-Hand', primary: 'Cash-in-Hand', openingPaise: 1_842_000 },
			{ name: 'HDFC Bank A/c', group: 'Bank Accounts', primary: 'Bank Accounts', openingPaise: 31_200_000 },
			{ name: 'Output CGST @2.5%', group: 'Duties & Taxes', primary: 'Duties & Taxes', openingPaise: -4_120_000 },
			{ name: 'Tea', group: 'Shop Exp.', primary: 'Indirect Expenses', openingPaise: 0 },
			{ name: 'Ravi & Sons', group: 'Sundry Debtors', primary: 'Sundry Debtors', openingPaise: 2_250_000 },
			{ name: 'Capital', group: 'Capital Account', primary: 'Capital Account', openingPaise: -31_172_000 },
		]);
	});

	it('reads a ledger with no group as having none', () => {
		expect(parseTallyMasters('<LEDGER NAME="Loose"><OPENINGBALANCE>-1</OPENINGBALANCE></LEDGER>')).toEqual([
			{ name: 'Loose', group: '', primary: null, openingPaise: 100 },
		]);
		expect(parseTallyMasters('<ENVELOPE></ENVELOPE>')).toEqual([]);
	});
});

describe('reading a trial balance CSV', () => {
	it('splits a line into cells, keeping commas and doubled quotes inside quotes', () => {
		expect(csvCells('a,"b,c","say ""hi""", d ')).toEqual(['a', 'b,c', 'say "hi"', 'd']);
		expect(csvCells('')).toEqual(['']);
		expect(csvCells('one')).toEqual(['one']);
		expect(csvCells('x,')).toEqual(['x', '']);
	});

	it('reads Ledger, Group, Debit and Credit in any case and order, debit less credit', () => {
		const csv = [
			'Group,LEDGER,Credit,Debit',
			'Cash-in-Hand,Cash,,"18,420.00"',
			'Duties & Taxes,Output CGST,"41,200.00",',
			'Shop Exp.,Tea,,₹ 1 200',
			',,,',
			'  ',
			'Capital Account,Capital,"311,720",',
			'Sundry Debtors,Short row',
		].join('\r\n');
		expect(parseTemplateCsv(csv)).toEqual([
			{ name: 'Cash', group: 'Cash-in-Hand', primary: 'Cash-in-Hand', openingPaise: 1_842_000 },
			{ name: 'Output CGST', group: 'Duties & Taxes', primary: 'Duties & Taxes', openingPaise: -4_120_000 },
			{ name: 'Tea', group: 'Shop Exp.', primary: null, openingPaise: 120_000 },
			{ name: 'Capital', group: 'Capital Account', primary: 'Capital Account', openingPaise: -31_172_000 },
			{ name: 'Short row', group: 'Sundry Debtors', primary: 'Sundry Debtors', openingPaise: 0 },
		]);
	});

	it('reads nothing from a file without the four columns, or an empty one', () => {
		expect(parseTemplateCsv('Ledger,Group,Debit\nCash,Cash-in-Hand,100')).toEqual([]);
		expect(parseTemplateCsv('')).toEqual([]);
		expect(parseTemplateCsv('Ledger,Group,Debit,Credit')).toEqual([]);
	});

	it('reads a row with only a name as having no group and no balance', () => {
		expect(parseTemplateCsv('Debit,Credit,Group,Ledger\n,,,Petty')).toEqual([
			{ name: 'Petty', group: '', primary: null, openingPaise: 0 },
		]);
		// A row cut short before its group, or before its name.
		expect(parseTemplateCsv('Ledger,Debit,Credit,Group\nPetty,5')).toEqual([
			{ name: 'Petty', group: '', primary: null, openingPaise: 500 },
		]);
		expect(parseTemplateCsv('Debit,Credit,Group,Ledger\n100')).toEqual([]);
	});
});

describe('where each ledger goes', () => {
	it('matches the export: by name, by tax head, parties to the control ledger, new ledgers under their group', () => {
		expect(
			matchLedgers(parseTallyMasters(TALLY), chart).map((m) => [m.name, m.how, m.ledgerId ?? m.groupKey]),
		).toEqual([
			['Cash', 'by_name', 'l_cash'],
			['HDFC Bank A/c', 'new', 'bank_accounts'],
			['Output CGST @2.5%', 'by_tax_head', 'l_ocgst'],
			['Tea', 'new', 'indirect_expenses'],
			['Ravi & Sons', 'party', 'l_dc'],
			['Capital', 'new', 'capital_account'],
		]);
	});

	it('matches a name whatever its case and spaces', () => {
		expect(matchLedgers([ledger('  cash ', null)], chart)[0]).toEqual({
			name: '  cash ',
			how: 'by_name',
			ledgerId: 'l_cash',
			groupKey: null,
		});
	});

	it('finds each tax head by its words, by system key or role', () => {
		const taxes = {
			groups: [{ id: 'g_dt', systemKey: 'duties_and_taxes' }],
			ledgers: [
				{ id: 'l_osgst', name: 'Our SGST out', systemKey: 'output_sgst' },
				{ id: 'l_oigst', name: 'Our IGST out', systemKey: 'output_igst' },
				{ id: 'l_icgst', name: 'Our CGST in', systemKey: null, roles: ['input_cgst'] },
				{ id: 'l_isgst', name: 'Our SGST in', systemKey: 'input_sgst' },
				{ id: 'l_iigst', name: 'Our IGST in', systemKey: 'input_igst' },
				{ id: 'l_tds', name: 'Our TDS', systemKey: null, roles: ['tds_payable'] },
			],
		};
		const found = matchLedgers(
			[
				'SGST Output 2.5%',
				'Output UTGST',
				'IGST Output',
				'CGST Input',
				'Input UTGST',
				'Input IGST @5%',
				'TDS on Rent',
			].map((name) => ledger(name, 'Duties & Taxes', -100)),
			taxes,
		);
		expect(found.map((m) => [m.how, m.ledgerId])).toEqual([
			['by_tax_head', 'l_osgst'],
			['by_tax_head', 'l_osgst'],
			['by_tax_head', 'l_oigst'],
			['by_tax_head', 'l_icgst'],
			['by_tax_head', 'l_isgst'],
			['by_tax_head', 'l_iigst'],
			['by_tax_head', 'l_tds'],
		]);
	});

	it('makes a tax ledger it has no head for, or no ledger of that head, new under duties and taxes, else asks', () => {
		const withGroup = { groups: [{ id: 'g_dt', systemKey: 'duties_and_taxes' }], ledgers: [] };
		expect(matchLedgers([ledger('Professional Tax Payable', 'Duties & Taxes')], withGroup)[0]).toMatchObject({
			how: 'new',
			groupKey: 'duties_and_taxes',
		});
		expect(matchLedgers([ledger('Input IGST', 'Duties & Taxes')], withGroup)[0]).toMatchObject({ how: 'new' });
		expect(matchLedgers([ledger('Input IGST', 'Duties & Taxes')], chart)[0]).toEqual({
			name: 'Input IGST',
			how: 'choose',
			ledgerId: null,
			groupKey: null,
		});
	});

	it('takes a supplier to the creditors control ledger, by role, and without one asks or makes a new one', () => {
		const withControl = {
			groups: [],
			ledgers: [{ id: 'l_cc', name: 'Creditors', systemKey: null, roles: ['creditors_control'] }],
		};
		expect(matchLedgers([ledger('Weaver Co.', 'Sundry Creditors', -500)], withControl)[0]).toMatchObject({
			how: 'party',
			ledgerId: 'l_cc',
		});
		expect(matchLedgers([ledger('Weaver Co.', 'Sundry Creditors')], chart)[0]).toMatchObject({
			how: 'choose',
			ledgerId: null,
		});
		const withGroup = { groups: [{ id: 'g_sc', systemKey: 'sundry_creditors' }], ledgers: [] };
		expect(matchLedgers([ledger('Weaver Co.', 'Sundry Creditors')], withGroup)[0]).toMatchObject({
			how: 'new',
			groupKey: 'sundry_creditors',
		});
		expect(matchLedgers([ledger('Ravi & Sons', 'Sundry Debtors')], withGroup)[0]).toMatchObject({ how: 'choose' });
	});

	it('asks where a ledger goes when its primary group isn’t in our chart, or it has none', () => {
		expect(matchLedgers([ledger('Machinery', 'Fixed Assets', 500_000)], chart)[0]).toMatchObject({ how: 'choose' });
		expect(matchLedgers([ledger('Mystery', null, 500)], chart)[0]).toMatchObject({ how: 'choose' });
		expect(matchLedgers([ledger('Mystery', 'Not a Tally group')], chart)[0]).toMatchObject({ how: 'choose' });
	});
});

describe('the checks before bringing in, and the opening voucher', () => {
	const imported = parseTallyMasters(TALLY);
	const matches = matchLedgers(imported, chart);

	it('balances the export at ₹3,52,920 a side, every ledger with a balance placed', () => {
		expect(importCheck(imported, matches)).toEqual({
			debitPaise: 35_292_000,
			creditPaise: 35_292_000,
			balanced: true,
			toChoose: 0,
		});
	});

	it('counts each ledger with a balance still to place, and says when the sides differ', () => {
		const rows = [
			ledger('Machinery', 'Fixed Assets', 500_000),
			ledger('Unused', null),
			ledger('Stray', null, -200),
		];
		const placed = matchLedgers(rows, chart);
		expect(importCheck(rows, placed)).toEqual({
			debitPaise: 500_000,
			creditPaise: 200,
			balanced: false,
			toChoose: 2,
		});
		expect(importCheck(rows, placed.slice(0, 1))).toMatchObject({ toChoose: 2 });
		const chosen = placed.map((m) => ({ ...m, ledgerId: 'l_cash' }));
		expect(importCheck(rows, chosen)).toMatchObject({ toChoose: 0 });
		const grouped = placed.map((m) => ({ ...m, groupKey: 'capital_account' }));
		expect(importCheck(rows, grouped)).toMatchObject({ toChoose: 0 });
	});

	it('writes a line per ledger with a balance and a place, parties named in the narration', () => {
		expect(
			openingLines(
				imported,
				['l_cash', null, 'l_ocgst', 'l_tea', 'l_dc', 'l_cap'],
				[false, false, false, false, true, false],
			),
		).toEqual([
			{ ledgerId: 'l_cash', narration: 'Opening balance', debitPaise: 1_842_000 },
			{ ledgerId: 'l_ocgst', narration: 'Opening balance', creditPaise: 4_120_000 },
			{ ledgerId: 'l_dc', narration: 'Opening balance · Ravi & Sons', debitPaise: 2_250_000 },
			{ ledgerId: 'l_cap', narration: 'Opening balance', creditPaise: 31_172_000 },
		]);
		expect(openingLines(imported, [], [])).toEqual([]);
	});
});

describe('taking the books out to Tally', () => {
	it('spells our groups as Tally’s primary groups, the first that fits, anything else to Suspense A/c', () => {
		expect(tallyGroupFor('cash_in_hand')).toBe('Cash-in-Hand');
		expect(tallyGroupFor('bank_od')).toBe('Bank OD A/c');
		expect(tallyGroupFor('current_assets')).toBe('Current Assets');
		expect(tallyGroupFor('suspense_account')).toBe('Suspense A/c');
		expect(tallyGroupFor('rounding_off')).toBe('Suspense A/c');
		expect(tallyGroupFor(null)).toBe('Suspense A/c');
	});

	it('writes ledgers with their primary group and opening balance, debits negative, names made safe', () => {
		const xml = tallyXml(
			[{ name: 'Ravi & Sons <Kolkata>', groupKey: 'sundry_debtors', openingPaise: 2_250_000 }],
			[],
		);
		expect(xml).toBe(
			'<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA>' +
				'<TALLYMESSAGE><LEDGER NAME="Ravi &amp; Sons &lt;Kolkata&gt;" ACTION="Create"><NAME>Ravi &amp; Sons &lt;Kolkata&gt;</NAME><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>-22500.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>' +
				'</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>',
		);
		// Read back, it is the same ledger.
		expect(parseTallyMasters(xml)).toEqual([
			{
				name: 'Ravi & Sons <Kolkata>',
				group: 'Sundry Debtors',
				primary: 'Sundry Debtors',
				openingPaise: 2_250_000,
			},
		]);
	});

	it('writes vouchers as journals: the day without dashes, a debit Yes and negative, a credit No and positive', () => {
		const xml = tallyXml(
			[{ name: 'Capital', groupKey: 'capital_account', openingPaise: -31_172_000 }],
			[
				{
					number: 'JV/26-27/0001',
					date: '2026-11-24',
					narration: 'Rent "November" & more',
					lines: [
						{ ledger: 'Rent', debitPaise: 3_000_000 },
						{ ledger: 'HDFC Bank A/c', debitPaise: -3_000_000 },
					],
				},
			],
		);
		expect(xml).toContain('<OPENINGBALANCE>311720.00</OPENINGBALANCE>');
		expect(xml).toContain(
			'<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261124</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>JV/26-27/0001</VOUCHERNUMBER><NARRATION>Rent &quot;November&quot; &amp; more</NARRATION>' +
				'<ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-30000.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
				'<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank A/c</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>30000.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
				'</VOUCHER></TALLYMESSAGE>',
		);
	});

	it('exports direct expenses to Tally’s Direct Expenses, and still reads its Purchase Accounts as direct expenses', () => {
		expect(tallyGroupFor('direct_expenses')).toBe('Direct Expenses');
		expect(TALLY_GROUPS['purchase accounts']).toBe('direct_expenses');
		expect(TALLY_GROUPS['direct expenses']).toBe('direct_expenses');
	});
});
