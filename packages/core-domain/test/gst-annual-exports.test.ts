import { describe, expect, it } from 'vitest';

import { annualSupplies, exportTaxable } from '../src/gst/gst-annual';

/**
 * GSTR-9's split of exports (accounts brief G9): exports with IGST paid (6A WPAY, notes EXPWP) are taxed supplies in
 * table 4 (4C); exports under a LUT (6A WOPAY, notes EXPWOP) go to table 5 (5A). A credit note lowers, a debit note
 * raises. Read straight from the filed GSTR-1 file.
 */

const portal = {
	exp: [
		{
			exp_typ: 'WPAY',
			inv: [
				{ itms: [{ txval: 6_000, rt: 5, iamt: 300, csamt: 0 }] },
				{ itms: [{ txval: 2_000, rt: 5, iamt: 100 }] },
			],
		},
		{
			exp_typ: 'WOPAY',
			// An odd document and odd items count as nothing; an item written under itm_det still counts.
			inv: [
				{ itms: [{ txval: 4_000, rt: 5, iamt: 0 }] },
				'not a document',
				{ itms: [null, { txval: '1' }, { itm_det: { txval: 50 } }] },
			],
		},
		'not a group',
		{ exp_typ: 'WOPAY' },
	],
	cdnur: [
		{ typ: 'EXPWP', ntty: 'C', itms: [{ num: 1, itm_det: { txval: 3_000, rt: 5, iamt: 150 } }] },
		{ typ: 'EXPWP', ntty: 'D', itms: [{ num: 1, itm_det: { txval: 1_000, rt: 5, iamt: 50 } }] },
		{ typ: 'EXPWOP', ntty: 'C', itms: [{ num: 1, itm_det: { txval: 4_000, rt: 5, iamt: 0 } }] },
		{ typ: 'B2CL', ntty: 'C', pos: '27', itms: [{ num: 1, itm_det: { txval: 999, rt: 5, iamt: 50 } }] },
		'not a note',
		{ typ: 'EXPWOP', ntty: 'D' },
	],
};

describe('exports by kind in a filed GSTR-1', () => {
	it('adds the exports with IGST paid and their notes, a credit note lowering and a debit note raising', () => {
		expect(exportTaxable(portal, 'WPAY')).toEqual({ invoices: 800_000, notes: -200_000 });
	});

	it('adds the exports under a LUT and their notes, reading odd documents and items as nothing', () => {
		expect(exportTaxable(portal, 'WOPAY')).toEqual({ invoices: 405_000, notes: -400_000 });
	});

	it('reads a file with no exports or notes as none', () => {
		expect(exportTaxable({}, 'WPAY')).toEqual({ invoices: 0, notes: 0 });
		expect(exportTaxable({ exp: 'none', cdnur: null }, 'WOPAY')).toEqual({ invoices: 0, notes: 0 });
	});
});

describe('GSTR-9 tables 4 and 5 from a GSTR-1', () => {
	it('adds taxed exports to the supplies, moves the LUT export notes 9B held out of them, and keeps LUT exports apart', () => {
		const summary = [
			{ table: '4A', taxable: 1_000, tax: 50 },
			{ table: '7', taxable: 500, tax: 25 },
			// 9B holds every note, the export notes among them: −3,000 + 1,000 − 4,000 − 9.99.
			{ table: '9B', taxable: -6_009.99, tax: -150.5 },
			{ table: '6A', taxable: 12_050, tax: 400 },
		];
		expect(annualSupplies({ summary, portal })).toEqual({
			// 1,000 + 500 − 6,009.99 + 8,000 (taxed exports) + 4,000 (the LUT note back out) = ₹7,490.01.
			taxed: 749_001,
			// 4,050 − 4,000.
			zeroRatedWithoutTax: 5_000,
		});
	});
});
