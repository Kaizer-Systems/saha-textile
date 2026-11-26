import { describe, expect, it } from 'vitest';

import { type Rule37Bill, day180, rule37 } from '../src/gst/gstr3b-rules';

/**
 * Rule 37(2) as amended from 1 October 2022: credit on the part of a bill unpaid on day 180 is taken back in the
 * return for the month AFTER the one the 180 days end in (GSTR-3B 4B(2)). Paying it after day 180 brings the credit
 * back (4A(5), shown in 4D(1)): what was paid from day 181 to the end of the reversal month in that same return, later
 * payments in the month paid, never more than was taken back.
 */

const heads = (igst: number, cgst = 0, sgst = 0) => ({ igst, cgst, sgst });
const NONE = { reversed: heads(0), reclaimed: heads(0), entries: [] };

/** ₹11,800 with ₹1,800 IGST, dated 12 December 2025: its 180 days end on 10 June 2026, reversed in July. */
const bill = (payments: Rule37Bill['payments'], over: Partial<Rule37Bill> = {}): Rule37Bill => ({
	entryId: 'pe_1',
	billDate: '2025-12-12',
	totalPaise: 1_180_000,
	creditedPaise: 0,
	tax: heads(180_000),
	payments,
	...over,
});

describe('when rule 37 takes credit back', () => {
	it('waits for the month after the one day 180 falls in', () => {
		expect(day180('2025-12-12')).toBe('2026-06-10');
		expect(rule37([bill([])], '2026-05')).toEqual(NONE);
		expect(rule37([bill([])], '2026-06')).toEqual(NONE);
		expect(rule37([bill([])], '2026-07')).toEqual({
			reversed: heads(180_000),
			reclaimed: heads(0),
			entries: [{ entryId: 'pe_1', reversed: 180_000, reclaimed: 0 }],
		});
	});

	it('takes back in July a bill whose day 180 is 30 June', () => {
		expect(day180('2026-01-01')).toBe('2026-06-30');
		const lastDay = bill([], { billDate: '2026-01-01' });
		expect(rule37([lastDay], '2026-06')).toEqual(NONE);
		expect(rule37([lastDay], '2026-07').reversed).toEqual(heads(180_000));
	});

	it('takes back only the part unpaid on day 180, the tax shared as the bill has it', () => {
		const half = bill([{ paidOn: '2026-06-10', paise: 590_000 }], { tax: heads(0, 90_000, 90_000) });
		expect(rule37([half], '2026-07')).toEqual({
			reversed: heads(0, 45_000, 45_000),
			reclaimed: heads(0),
			entries: [{ entryId: 'pe_1', reversed: 90_000, reclaimed: 0 }],
		});
	});
});

describe('when the credit comes back', () => {
	it('brings back in the same return what was paid from day 181 to the end of the reversal month', () => {
		// Paid in full on 20 June, after day 180 and before the July return: taken back and brought back together.
		const late = bill([{ paidOn: '2026-06-20', paise: 1_180_000 }]);
		expect(rule37([late], '2026-07')).toEqual({
			reversed: heads(180_000),
			reclaimed: heads(180_000),
			entries: [{ entryId: 'pe_1', reversed: 180_000, reclaimed: 180_000 }],
		});
		expect(rule37([late], '2026-08')).toEqual(NONE);
		// Paid in July itself: the same.
		expect(rule37([bill([{ paidOn: '2026-07-31', paise: 1_180_000 }])], '2026-07').reclaimed).toEqual(
			heads(180_000),
		);
	});

	it('brings back later payments in their own month, never more than was taken back', () => {
		const paying = bill([
			{ paidOn: '2026-03-01', paise: 590_000 },
			{ paidOn: '2026-09-15', paise: 400_000 },
			{ paidOn: '2026-10-05', paise: 400_000 },
		]);
		// Half was unpaid on day 180: ₹900 taken back in July.
		expect(rule37([paying], '2026-07').entries).toEqual([{ entryId: 'pe_1', reversed: 90_000, reclaimed: 0 }]);
		// August: nothing paid, nothing to show.
		expect(rule37([paying], '2026-08')).toEqual(NONE);
		// September: ₹4,000 of the ₹5,900 owed: 1,800 × 4,000 ÷ 11,800 = ₹610.17.
		expect(rule37([paying], '2026-09').entries).toEqual([{ entryId: 'pe_1', reversed: 0, reclaimed: 61_017 }]);
		// October: ₹4,000 paid, only ₹1,900 still owed: ₹289.83.
		expect(rule37([paying], '2026-10').entries).toEqual([{ entryId: 'pe_1', reversed: 0, reclaimed: 28_983 }]);
		// November: all of it back already.
		expect(rule37([paying], '2026-11')).toEqual(NONE);
	});

	it('leaves alone a bill paid in full within 180 days, or settled by debit notes', () => {
		const paid = bill([{ paidOn: '2026-06-10', paise: 1_180_000 }]);
		const credited = bill([], { creditedPaise: 1_180_000 });
		for (const month of ['2026-07', '2026-08']) expect(rule37([paid, credited], month)).toEqual(NONE);
	});

	it('adds several bills together', () => {
		const one = bill([]);
		const two = bill([{ paidOn: '2026-08-01', paise: 1_180_000 }], { entryId: 'pe_2', billDate: '2025-12-31' });
		// pe_2's day 180 is 29 June: reversed in July too, paid back in August.
		expect(day180('2025-12-31')).toBe('2026-06-29');
		expect(rule37([one, two], '2026-07')).toEqual({
			reversed: heads(360_000),
			reclaimed: heads(0),
			entries: [
				{ entryId: 'pe_1', reversed: 180_000, reclaimed: 0 },
				{ entryId: 'pe_2', reversed: 180_000, reclaimed: 0 },
			],
		});
		expect(rule37([one, two], '2026-08').entries).toEqual([{ entryId: 'pe_2', reversed: 0, reclaimed: 180_000 }]);
	});
});
