import { describe, expect, it } from 'vitest';

import { type GstPostingRow, setOff, setOffPostings } from '../src/gst/gstr3b-rules';

/**
 * Q7 "Post the set-off": the journal that sets output tax off against the credit used (s.49(5), rule 88A), the
 * reverse-charge credit taken first from its own ledger, and the challan that pays the rest and the reverse-charge tax
 * in cash (s.49(4)). Every posting balances.
 */

const heads = (igst: number, cgst: number, sgst: number) => ({ igst, cgst, sgst });
const ZERO = heads(0, 0, 0);
const p = (rupees: number) => Math.round(rupees * 100);
const debits = (rows: readonly GstPostingRow[]) => rows.reduce((s, r) => s + (r.debitPaise ?? 0), 0);
const credits = (rows: readonly GstPostingRow[]) => rows.reduce((s, r) => s + (r.creditPaise ?? 0), 0);

describe('posting the approved Q7 picture', () => {
	// Liability 18,400 / 48,200 / 48,200; credit 22,100 / 31,500 / 31,500, of which 5,475 CGST and 5,475 SGST came
	// from the reverse charge paid this month.
	const q7 = setOff(heads(p(18_400), p(48_200), p(48_200)), heads(p(22_100), p(31_500), p(31_500)));
	const reverseCharge = heads(0, p(5_475), p(5_475));
	const posted = setOffPostings(q7, reverseCharge);

	it('starts from the picture’s set-off', () => {
		expect(q7.igstUsed).toEqual(heads(p(18_400), p(3_700), 0));
		expect(q7.cgstUsed).toEqual({ cgst: p(31_500), igst: 0 });
		expect(q7.sgstUsed).toEqual({ sgst: p(31_500), igst: 0 });
		expect(q7.cash).toEqual(heads(0, p(13_000), p(16_700)));
	});

	it('debits output tax by the credit used against each head, and credits each input ledger by what it gave, reverse charge first from its own ledger', () => {
		expect(posted.journal).toEqual([
			{ role: 'output_igst', debitPaise: p(18_400) },
			{ role: 'output_cgst', debitPaise: p(35_200) },
			{ role: 'output_sgst', debitPaise: p(31_500) },
			{ role: 'input_igst', creditPaise: p(22_100) },
			{ role: 'input_cgst', creditPaise: p(26_025) },
			{ role: 'input_sgst', creditPaise: p(26_025) },
			{ role: 'input_gst_rcm', creditPaise: p(10_950) },
		]);
		expect(debits(posted.journal)).toBe(credits(posted.journal));
	});

	it('pays the cash left on each head and the reverse-charge tax by challan, leaving out a head with nothing to pay', () => {
		expect(posted.challan).toEqual([
			{ role: 'output_cgst', debitPaise: p(13_000) },
			{ role: 'output_sgst', debitPaise: p(16_700) },
			{ role: 'rcm_payable', debitPaise: p(10_950) },
		]);
		expect(posted.cashPaise).toBe(p(40_650));
		expect(debits(posted.challan)).toBe(posted.cashPaise);
	});

	it('clears each head’s output tax exactly: credit used plus cash is the liability', () => {
		const owed = (role: string, rows: readonly GstPostingRow[]) =>
			rows.filter((r) => r.role === role).reduce((s, r) => s + (r.debitPaise ?? 0), 0);
		for (const [head, role] of [
			['igst', 'output_igst'],
			['cgst', 'output_cgst'],
			['sgst', 'output_sgst'],
		] as const)
			expect(owed(role, posted.journal) + owed(role, posted.challan)).toBe(q7.liability[head]);
	});
});

describe('other months', () => {
	it('takes IGST reverse-charge credit used against CGST and IGST from its own ledger first, never more than was used', () => {
		// IGST credit 10,000, of which 6,000 is reverse charge on an import of services; 4,000 is used.
		const month = setOff(heads(p(3_000), p(1_000), 0), heads(p(10_000), 0, 0));
		expect(month.igstUsed).toEqual(heads(p(3_000), p(1_000), 0));
		const posted = setOffPostings(month, heads(p(6_000), 0, 0));
		expect(posted.journal).toEqual([
			{ role: 'output_igst', debitPaise: p(3_000) },
			{ role: 'output_cgst', debitPaise: p(1_000) },
			{ role: 'input_gst_rcm', creditPaise: p(4_000) },
		]);
		expect(posted.challan).toEqual([{ role: 'rcm_payable', debitPaise: p(6_000) }]);
		expect(posted.cashPaise).toBe(p(6_000));
	});

	it('pays IGST from CGST and SGST credit, crediting those ledgers', () => {
		const month = setOff(heads(p(10_000), 0, 0), heads(0, p(6_000), p(6_000)));
		const posted = setOffPostings(month, ZERO);
		expect(posted.journal).toEqual([
			{ role: 'output_igst', debitPaise: p(10_000) },
			{ role: 'input_cgst', creditPaise: p(6_000) },
			{ role: 'input_sgst', creditPaise: p(4_000) },
		]);
		expect(posted.challan).toEqual([]);
		expect(posted.cashPaise).toBe(0);
	});

	it('reads a reverse charge lowered below nothing as none of the credit', () => {
		const month = setOff(heads(0, p(500), 0), heads(0, p(500), 0));
		const posted = setOffPostings(month, heads(0, p(-200), 0));
		expect(posted.journal).toEqual([
			{ role: 'output_cgst', debitPaise: p(500) },
			{ role: 'input_cgst', creditPaise: p(500) },
		]);
	});

	it('posts nothing when there is nothing to set off or pay', () => {
		expect(setOffPostings(setOff(ZERO, ZERO), ZERO)).toEqual({ journal: [], challan: [], cashPaise: 0 });
	});
});
