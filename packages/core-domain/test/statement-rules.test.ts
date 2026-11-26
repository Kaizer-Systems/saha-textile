import { describe, expect, it } from 'vitest';

import { lineKey, statementAmount, statementDate, statementLines, statementTotals } from '../src/bank/statement-rules';

/** Reading a bank statement (accounts brief BA4–BA6). */

describe('statement dates and amounts', () => {
	it('reads each date format, two-digit years as this century, and refuses what isn’t a date', () => {
		expect(statementDate('28/11/26', 'DD/MM/YY')).toBe('2026-11-28');
		expect(statementDate('28/11/2026', 'DD/MM/YYYY')).toBe('2026-11-28');
		expect(statementDate('28-11-2026', 'DD-MM-YYYY')).toBe('2026-11-28');
		expect(statementDate('2026-11-28', 'YYYY-MM-DD')).toBe('2026-11-28');
		expect(statementDate('28 Nov 2026', 'DD MMM YYYY')).toBe('2026-11-28');
		expect(statementDate('28-nov-26', 'DD MMM YYYY')).toBe('2026-11-28');
		expect(statementDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
		expect(statementDate('Opening balance', 'DD/MM/YYYY')).toBeNull();
		expect(statementDate('28 Xyz 2026', 'DD MMM YYYY')).toBeNull();
		expect(statementDate('28 Nov', 'DD MMM YYYY')).toBeNull();
		expect(statementDate('28/11/2026', 'YYYY-MM-DD')).toBeNull();
		expect(statementDate('00/11/2026', 'DD/MM/YYYY')).toBeNull();
	});

	it('reads amounts as banks print them, in paise and signed', () => {
		expect(statementAmount('1,23,456.78')).toBe(12_345_678);
		expect(statementAmount(' ₹ 500 ')).toBe(50_000);
		expect(statementAmount('(250.00)')).toBe(-25_000);
		expect(statementAmount('100 Dr')).toBe(-10_000);
		expect(statementAmount('100CR')).toBe(10_000);
		expect(statementAmount('-75.5')).toBe(-7_550);
		expect(statementAmount('')).toBe(0);
		expect(statementAmount('-')).toBe(0);
		expect(statementAmount('12.345')).toBeNull();
		expect(statementAmount('abc')).toBeNull();
	});
});

describe('statement lines', () => {
	const split = {
		skipRows: 1,
		dateFormat: 'DD/MM/YY' as const,
		money: 'split' as const,
		columns: {
			date: 0,
			description: 1,
			reference: 2,
			withdrawal: 3,
			deposit: 4,
			amount: null,
			drcr: null,
			balance: 5,
		},
	};

	it('reads separate withdrawal and deposit columns, naming rows that aren’t lines', () => {
		const rows = [
			['Date', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Balance'],
			['25/11/26', 'NEFT CR CCAVENUE 251126', 'CCAV98240', '', '98,240.00', '5,32,569.00'],
			['26/11/26', 'SMS ALERT CHG', '', '59.00', '', '5,32,510.00'],
			['', '', '', '', '', ''],
			['Closing', '', '', '', '', ''],
			['27/11/26', 'odd', '', 'x', '', ''],
			['28/11/26', 'nothing', '', '', '', ''],
			['29/11/26'],
		];
		const read = statementLines(rows, split);
		expect(read.lines).toEqual([
			{
				row: 2,
				date: '2026-11-25',
				description: 'NEFT CR CCAVENUE 251126',
				reference: 'CCAV98240',
				outPaise: 0,
				inPaise: 9_824_000,
				balancePaise: 53_256_900,
			},
			{
				row: 3,
				date: '2026-11-26',
				description: 'SMS ALERT CHG',
				reference: '',
				outPaise: 5_900,
				inPaise: 0,
				balancePaise: 53_251_000,
			},
		]);
		expect(read.problems).toEqual([
			{ row: 5, problem: 'date_unreadable' },
			{ row: 6, problem: 'amount_unreadable' },
			{ row: 7, problem: 'no_money' },
			{ row: 8, problem: 'no_money' },
		]);
	});

	it('reads one amount with a Dr/Cr column, with no reference or balance columns', () => {
		const layout = {
			skipRows: 0,
			dateFormat: 'DD/MM/YYYY' as const,
			money: 'signed_drcr' as const,
			columns: {
				date: 0,
				description: 1,
				reference: null,
				withdrawal: null,
				deposit: null,
				amount: 2,
				drcr: 3,
				balance: null,
			},
		};
		const read = statementLines(
			[
				['01/11/2026', 'RENT', '60,000.00', 'DR'],
				['02/11/2026', 'UPI IN', '1,500.00', 'Cr'],
				['03/11/2026', 'BAD', '1.234', 'Cr'],
			],
			layout,
		);
		expect(read.lines.map((l) => [l.outPaise, l.inPaise, l.reference, l.balancePaise])).toEqual([
			[6_000_000, 0, '', null],
			[0, 150_000, '', null],
		]);
		expect(read.problems).toEqual([{ row: 3, problem: 'amount_unreadable' }]);
	});

	it('keys a line by date, money and reference (else description), and checks opening plus lines against closing', () => {
		const line = {
			date: '2026-11-25',
			outPaise: 0,
			inPaise: 100,
			reference: '',
			description: ' upi  409912345678  shreya ',
		};
		expect(lineKey(line)).toBe('2026-11-25|0|100|UPI 409912345678 SHREYA');
		expect(lineKey({ ...line, reference: 'ccav98240' })).toBe('2026-11-25|0|100|CCAV98240');
		expect(
			statementTotals(
				1_000,
				[
					{ outPaise: 100, inPaise: 0 },
					{ outPaise: 0, inPaise: 600 },
				],
				1_500,
			),
		).toEqual({ computedPaise: 1_500, matches: true });
		expect(statementTotals(0, [], 1).matches).toBe(false);
	});
});
