import { describe, expect, it } from 'vitest';

import { GstChallan, GstReturnDraft, GstSetOffPost } from '../src/gst-returns';

/** Q7 "Post the set-off": the challan (PMT-06) a GSTR-3B's cash is paid with, and what the screen sends to post it. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

const challan = {
	number: 'JV/26-27/0012',
	paidOn: '2026-12-18',
	bankAccountId: 'ba_hdfc',
	amountPaise: 4_065_000,
	setOffNumber: 'JV/26-27/0011',
	challanNumber: '26111900012345',
};

describe('the challan', () => {
	it('keeps the payment’s voucher, day, bank, amount in whole paise, and the set-off and challan numbers once known', () => {
		expect(GstChallan.parse(challan)).toEqual(challan);
		accepted(GstChallan.safeParse({ ...challan, amountPaise: 0, setOffNumber: null, challanNumber: null }).success);
		refused(GstChallan.safeParse({ ...challan, amountPaise: -1 }).success);
		refused(GstChallan.safeParse({ ...challan, amountPaise: 10.5 }).success);
		refused(GstChallan.safeParse({ ...challan, paidOn: '18-12-2026' }).success);
		refused(GstChallan.safeParse({ ...challan, bankAccountId: '' }).success);
		refused(GstChallan.safeParse({ ...challan, challanNumber: undefined }).success);
	});

	it('is on a GSTR-3B draft only once posted: absent, empty or the challan', () => {
		const draft = {
			id: 'gstd_3b',
			gstRegistrationId: 'gst_wb',
			gstin: '19DBYPS6736R1ZZ',
			returnType: 'GSTR-3B',
			month: '2026-11',
			status: 'approved',
			summary: [],
			problems: [],
			portal: {},
			preparedBy: null,
			preparedAt: '2026-12-15T05:00:00.000Z',
		};
		expect(GstReturnDraft.parse(draft)).not.toHaveProperty('challan');
		expect(GstReturnDraft.parse({ ...draft, challan: null }).challan).toBeNull();
		expect(GstReturnDraft.parse({ ...draft, challan }).challan).toEqual(challan);
		refused(GstReturnDraft.safeParse({ ...draft, challan: { ...challan, amountPaise: -1 } }).success);
	});
});

describe('posting the set-off', () => {
	const post = { bankAccountId: 'ba_hdfc', paidOn: '2026-12-18', challan: '26111900012345', version: 4 };
	const message = (input: unknown) => GstSetOffPost.safeParse(input).error?.issues[0]?.message;

	it('takes the challan’s CPIN or CIN as the portal shows it, in capitals without spaces', () => {
		expect(GstSetOffPost.parse(post)).toEqual(post);
		expect(GstSetOffPost.parse({ ...post, challan: '  hdfc 2611 1900 0123 ' }).challan).toBe('HDFC261119000123');
		accepted(GstSetOffPost.safeParse({ ...post, challan: 'A1B2C3' }).success);
		accepted(GstSetOffPost.safeParse({ ...post, challan: 'X'.repeat(20) }).success);
	});

	it('refuses a challan under 6 or over 20 letters and digits, or with other marks', () => {
		expect(message({ ...post, challan: 'A1B2C' })).toBe('challan_shape');
		expect(message({ ...post, challan: 'X'.repeat(21) })).toBe('challan_shape');
		expect(message({ ...post, challan: '2611-1900-0123' })).toBe('challan_shape');
		expect(message({ ...post, challan: '      ' })).toBe('challan_shape');
	});

	it('needs the bank account, a day as YYYY-MM-DD and the draft’s version', () => {
		refused(GstSetOffPost.safeParse({ ...post, bankAccountId: '' }).success);
		refused(GstSetOffPost.safeParse({ ...post, paidOn: '18/12/2026' }).success);
		refused(GstSetOffPost.safeParse({ ...post, version: -1 }).success);
		refused(GstSetOffPost.safeParse({ ...post, version: 1.5 }).success);
		refused(GstSetOffPost.safeParse({ ...post, challan: 26111900012345 }).success);
	});
});
