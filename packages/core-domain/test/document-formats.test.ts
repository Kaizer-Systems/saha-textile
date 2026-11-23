import type { DocumentKind } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	blankBlocks,
	checkFormatBlocks,
	DOCUMENT_SPECS,
	documentSpec,
	nextTextBlockId,
	ourBlocks,
	seedDocumentFormats,
	switchOffRefusal,
	switchOnPlan,
} from '../src/documents/index';

/** Every document kind, from core's own spec list (contract values stay out of core, G-CORE-CONTRACTS). */
const KINDS = Object.keys(DOCUMENT_SPECS) as DocumentKind[];

describe('document formats (bundle builder brief F)', () => {
	it('has a spec for every document, and our format and a blank start pass their own checks', () => {
		for (const doc of KINDS) {
			expect(DOCUMENT_SPECS[doc].doc).toBe(doc);
			expect(checkFormatBlocks(doc, ourBlocks(doc))).toEqual([]);
			expect(checkFormatBlocks(doc, blankBlocks(doc))).toEqual([]);
			expect(documentSpec(doc).blocks.every((row) => !('ours' in row))).toBe(true);
		}
	});

	it('seeds ours for all 17 documents switched on, plus Compact and Counter receipt for the tax invoice switched off', () => {
		const seeds = seedDocumentFormats();
		expect(seeds).toHaveLength(19);
		// Each seed is checked against the contract in apps/api/test/document-formats.test.ts.
		expect(KINDS).toHaveLength(17);
		for (const doc of KINDS) {
			expect(seeds.filter((row) => row.doc === doc && row.active)).toHaveLength(1);
		}
		const invoice = seeds.filter((row) => row.doc === 'taxInvoice');
		expect(invoice.map((row) => [row.name, row.paper, row.active])).toEqual([
			['Saha Textile standard', 'a4', true],
			['Compact', 'a5', false],
			['Counter receipt', 'roll80', false],
		]);
		for (const row of invoice) expect(checkFormatBlocks('taxInvoice', row.blocks)).toEqual([]);
	});

	it('refuses fields the document doesn’t have, a legal field left off, a needed block hidden or missing', () => {
		const blocks = ourBlocks('taxInvoice').map((row) => {
			if (row.type === 'table')
				return { ...row, fields: row.fields.filter((f) => f !== 'hsn').concat('supplierCode') };
			if (row.type === 'signature') return { ...row, hidden: true };
			return row;
		});
		const codes = checkFormatBlocks(
			'taxInvoice',
			blocks.filter((row) => row.type !== 'totals'),
		).map((p) => `${p.code}:${p.field ?? p.blockId}`);
		expect(codes).toEqual([
			'field_not_allowed:supplierCode',
			'locked_field_missing:hsn',
			'required_block_hidden:signature',
			'required_block_missing:totals',
		]);
		expect(
			checkFormatBlocks('journal', [...ourBlocks('journal'), { ...ourBlocks('journal')[0]!, id: 'brand-2' }]),
		).toEqual([{ code: 'duplicate_block', blockId: 'brand-2', field: null }]);
		expect(
			checkFormatBlocks('packingSlip', [...ourBlocks('packingSlip'), { ...ourBlocks('taxInvoice')[4]! }]),
		).toEqual([{ code: 'unknown_block', blockId: 'einvoice', field: null }]);
	});

	it('keeps exactly one active format: on switches the other off, off is refused with the reason', () => {
		const seeds = seedDocumentFormats();
		expect(switchOnPlan(seeds, 'dfm_taxInvoice_compact')).toMatchObject({
			on: { id: 'dfm_taxInvoice_compact' },
			off: { id: 'dfm_taxInvoice_standard' },
		});
		expect(switchOnPlan(seeds, 'dfm_taxInvoice_standard')?.off).toBeNull();
		expect(switchOnPlan(seeds, 'nope')).toBeNull();
		expect(switchOffRefusal(seeds, 'dfm_deliveryChallan_standard')).toBe('only_format');
		expect(switchOffRefusal(seeds, 'dfm_taxInvoice_standard')).toBe('switch_another');
	});

	it('names added text blocks text-2, text-3… and a blank start holds only the needed blocks', () => {
		expect(nextTextBlockId(ourBlocks('taxInvoice'))).toBe('text-2');
		expect(nextTextBlockId([...ourBlocks('journal'), { ...ourBlocks('journal')[0]!, id: 'text-2' }])).toBe(
			'text-3',
		);
		expect(blankBlocks('packingSlip').map((row) => row.type)).toEqual(['facts', 'table']);
		expect(blankBlocks('packingSlip')[1]?.fields).toEqual(['item', 'qty']);
	});
});
