import { describe, expect, it } from 'vitest';

import { annualReturn, returnDueOn } from '../src/gst/gst-calendar';

/**
 * When GST returns fall due (accounts brief G3), checked against the law: GSTR-1 by the 11th (monthly) or the 13th
 * after the quarter (QRMP); GSTR-3B by the 20th (monthly) or, under QRMP, the 22nd or 24th by State (Rule 61 read
 * with Notification 01/2020-CT and the QRMP amendments); GSTR-9 by 31 December after the financial year (s.44).
 */

/** QRMP GSTR-3B on the 22nd: Chhattisgarh, Madhya Pradesh, Gujarat, Dadra and Nagar Haveli and Daman and Diu,
 * Maharashtra, Karnataka, Goa, Lakshadweep, Kerala, Tamil Nadu, Puducherry, Andaman and Nicobar Islands, Telangana,
 * Andhra Pradesh. */
const ON_22ND = ['22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37'];
/** On the 24th: Jammu and Kashmir, Himachal Pradesh, Punjab, Chandigarh, Uttarakhand, Haryana, Delhi, Rajasthan,
 * Uttar Pradesh, Bihar, Sikkim, Arunachal Pradesh, Nagaland, Manipur, Mizoram, Tripura, Meghalaya, Assam,
 * West Bengal, Jharkhand, Odisha, Ladakh. */
const ON_24TH = [
	'01',
	'02',
	'03',
	'04',
	'05',
	'06',
	'07',
	'08',
	'09',
	'10',
	'11',
	'12',
	'13',
	'14',
	'15',
	'16',
	'17',
	'18',
	'19',
	'20',
	'21',
	'38',
];

describe('monthly returns', () => {
	it('falls GSTR-1 due on the 11th and GSTR-3B on the 20th of the next month', () => {
		expect(returnDueOn('GSTR-1', '2026-11', 'monthly', '19')).toBe('2026-12-11');
		expect(returnDueOn('GSTR-3B', '2026-11', 'monthly', '19')).toBe('2026-12-20');
	});

	it('runs December into January of the next year', () => {
		expect(returnDueOn('GSTR-1', '2026-12', 'monthly', '19')).toBe('2027-01-11');
		expect(returnDueOn('GSTR-3B', '2026-12', 'monthly', '27')).toBe('2027-01-20');
	});

	it('writes every next month with two digits', () => {
		expect(returnDueOn('GSTR-1', '2026-01', 'monthly', '19')).toBe('2026-02-11');
		expect(returnDueOn('GSTR-3B', '2026-09', 'monthly', '19')).toBe('2026-10-20');
		expect(returnDueOn('GSTR-1', '2026-10', 'monthly', '19')).toBe('2026-11-11');
	});

	it('is the same for every State, every month', () => {
		for (const state of [...ON_22ND, ...ON_24TH]) {
			expect(returnDueOn('GSTR-3B', '2026-02', 'monthly', state)).toBe('2026-03-20');
			expect(returnDueOn('GSTR-3B', '2026-03', 'monthly', state)).toBe('2026-04-20');
			expect(returnDueOn('GSTR-1', '2026-03', 'monthly', state)).toBe('2026-04-11');
		}
	});
});

describe('quarterly returns under QRMP', () => {
	it('has no return in the first two months of a quarter', () => {
		for (const month of ['2026-01', '2026-02', '2026-04', '2026-05', '2026-07', '2026-08', '2026-10', '2026-11']) {
			expect(returnDueOn('GSTR-1', month, 'qrmp', '19')).toBeNull();
			expect(returnDueOn('GSTR-3B', month, 'qrmp', '27')).toBeNull();
		}
	});

	it('falls GSTR-1 due on the 13th after each quarter, the December quarter in January', () => {
		expect(returnDueOn('GSTR-1', '2026-03', 'qrmp', '19')).toBe('2026-04-13');
		expect(returnDueOn('GSTR-1', '2026-06', 'qrmp', '19')).toBe('2026-07-13');
		expect(returnDueOn('GSTR-1', '2026-09', 'qrmp', '27')).toBe('2026-10-13');
		expect(returnDueOn('GSTR-1', '2026-12', 'qrmp', '27')).toBe('2027-01-13');
	});

	it('falls GSTR-3B due on the 22nd in the fourteen States and territories the notification names', () => {
		for (const state of ON_22ND) expect(returnDueOn('GSTR-3B', '2026-09', 'qrmp', state)).toBe('2026-10-22');
	});

	it('falls GSTR-3B due on the 24th everywhere else, West Bengal included', () => {
		expect(returnDueOn('GSTR-3B', '2026-12', 'qrmp', '19')).toBe('2027-01-24');
		for (const state of ON_24TH) expect(returnDueOn('GSTR-3B', '2026-06', 'qrmp', state)).toBe('2026-07-24');
	});
});

describe('the annual return', () => {
	it('names the financial year a month falls in, April to March, due 31 December after it ends', () => {
		expect(annualReturn('2026-02')).toEqual({ period: '2025-26', dueOn: '2026-12-31' });
		expect(annualReturn('2026-03')).toEqual({ period: '2025-26', dueOn: '2026-12-31' });
		expect(annualReturn('2026-04')).toEqual({ period: '2026-27', dueOn: '2027-12-31' });
		expect(annualReturn('2026-12')).toEqual({ period: '2026-27', dueOn: '2027-12-31' });
	});

	it('writes the year across a century as the law does, 1999-00', () => {
		expect(annualReturn('2000-01')).toEqual({ period: '1999-00', dueOn: '2000-12-31' });
		expect(annualReturn('2099-04')).toEqual({ period: '2099-00', dueOn: '2100-12-31' });
	});
});
