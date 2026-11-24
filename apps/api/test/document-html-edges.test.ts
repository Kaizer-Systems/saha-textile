import type { DocumentBlock } from '@saha-textile/contracts';
import { ourBlocks } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import type { DocumentData } from '../src/documents/document-data';
import { documentHtml, documentHtmlCopies, eInvoiceBand } from '../src/documents/document-html';

const brand = { logoSrc: null, themeColor: null, fontFaces: '' };

const block = (
	type: DocumentBlock['type'],
	fields: string[] = [],
	over: Partial<DocumentBlock> = {},
): DocumentBlock => ({
	id: `${type}-x`,
	type,
	hidden: false,
	fields,
	heading: '',
	text: '',
	sizes: {},
	...over,
});

const base: DocumentData = {
	doc: 'taxInvoice',
	title: 'Tax invoice',
	number: 'INV/1',
	date: '22 Nov 2026',
	seller: { name: 'Saha Textile', lines: ['Kolkata'] },
	values: {},
	parties: {},
};

const page = (blocks: DocumentBlock[], data: Partial<DocumentData> = {}, options = {}) =>
	documentHtml({ name: 'Plain', paper: 'a4', blocks }, { ...base, ...data }, brand, options);

describe('the e-invoice band, edges', () => {
	it('leaves out facts it has no value for and the page number when the footer has none', () => {
		const format = { blocks: [block('einvoice', ['irn', 'signedQr']), block('footer', ['formatName'])] };
		const band = eInvoiceBand(format, { ...base, values: { irn: 'IRN-1', ackNo: '1122' } });
		expect(band).toContain('Ack no.');
		expect(band).not.toContain('Ack date');
		expect(band).not.toContain('E-way bill');
		expect(band).not.toContain('class="pageNumber"');
	});

	it('prints no page number without a visible footer', () => {
		const band = eInvoiceBand({ blocks: [block('einvoice', ['irn'])] }, { ...base, values: { irn: 'IRN-1' } });
		expect(band).toContain('QR pending');
		expect(band).not.toContain('class="pageNumber"');
	});
});

describe('document blocks, edges', () => {
	it('prints a brand of only a logo, with no seller box and no title beside it', () => {
		const html = documentHtml(
			{ name: 'Plain', paper: 'a4', blocks: [block('brand', ['logo']), block('facts', ['orderNo'])] },
			{ ...base, values: { orderNo: 'ST-1' } },
			{ ...brand, logoSrc: 'logo.png' },
		);
		expect(html).toContain('<img class="dz-logo" src="logo.png"');
		expect(html).not.toContain('class="dz-seller"');
		expect(html).not.toContain('class="dz-title"');
	});

	it('prints a title on its own, full width, when no brand comes before it', () => {
		const html = page([block('title', ['copyLabel'])], { values: { copyLabel: 'Original' } });
		expect(html).toContain('<div class="dz-title"><h1>Tax invoice</h1><div class="dz-copy">Original</div>');
	});

	it('names a fact the labels do not know by its own key', () => {
		const html = page([block('facts', ['shopCode'])], { values: { shopCode: 'K-1' } });
		expect(html).toContain('<span>shopCode</span><b>K-1</b>');
	});

	it('prints nothing for parties, a table, an HSN summary, totals and words with nothing to show', () => {
		const html = page([
			block('parties', ['billTo']),
			block('table', ['item', 'qty']),
			block('table', []),
			block('hsnSummary'),
			block('totals', ['totals', 'roundOff']),
			block('words'),
			block('payment', ['method']),
			block('text', [], { heading: 'Terms', text: '' }),
		]);
		expect(html).not.toContain('class="dz-parties"');
		expect(html).not.toContain('class="dz-table"');
		expect(html).not.toContain('class="dz-hsn"');
		expect(html).not.toContain('class="dz-totals"');
		expect(html).not.toContain('class="dz-words"');
		expect(html).not.toContain('class="dz-box dz-note"');
	});

	it('draws rows of a block saved before sizes existed, a sub line without a SKU and a row without a name', () => {
		const table = { ...block('table', ['item', 'tax', 'rate']), sizes: undefined } as unknown as DocumentBlock;
		const html = page([table], {
			rows: [
				{ kind: 'piece', depth: 1, cells: { item: 'Saree' }, sub: 'share of set' },
				{ kind: 'line', depth: 0, cells: {} },
			],
		});
		expect(html).toContain('<div class="dz-sub">share of set</div>');
		expect(html).toContain('<td class="dz-item dz-depth-0"><span></span></td>');
		// No tax heading on the document: the column's own name.
		expect(html).toContain('<th class="dz-num">Tax</th>');
		expect(html).not.toContain('style="font-size');
	});

	it('heads the HSN summary "Tax" when the document has no tax heading of its own', () => {
		const html = page([block('hsnSummary')], {
			hsnSummary: [{ hsn: '5007', taxable: '₹100.00', rate: '5%', tax: '₹5.00' }],
		});
		expect(html).toContain('<th class="dz-num">Tax</th></tr></thead><tbody><tr><td>5007</td>');
	});

	it('prints only the round off when the block does not show the sums, and nothing when the data has no totals', () => {
		const roundOff = page([block('totals', ['roundOff'])], {
			totals: {
				totals: [{ label: 'Total', value: '₹10.00' }],
				roundOff: [{ label: 'Round off', value: '₹0.40' }],
			},
		});
		expect(roundOff).toContain('<section class="dz-totals"><div class="dz-total"><span>Round off</span>');
		expect(roundOff).not.toContain('<span>Total</span>');
		const sumsOnly = page([block('totals', ['totals', 'roundOff'])], {
			totals: { totals: [{ label: 'Total', value: '₹10.00' }] },
		});
		expect(sumsOnly).toContain('<div class="dz-total"><span>Total</span><b>₹10.00</b></div>');
	});

	it('captions a signature the labels do not know by its own key', () => {
		const html = page([block('signature', ['witness'])], { signatures: { witness: 'Raju' } });
		expect(html).toContain('<b>Raju</b><div class="dz-sign-line"></div><span>witness</span>');
		const blank = page([block('signature', ['witness'])]);
		expect(blank).toContain('<b></b><div class="dz-sign-line"></div><span>witness</span>');
	});

	it('boxes a single note field the labels do not know, and heads a text block "Note" when it has no heading', () => {
		const html = page([block('note', ['memo']), block('text', [], { heading: '', text: 'Line one\nLine two' })], {
			values: { memo: 'Keep dry' },
		});
		expect(html).toContain('<span class="dz-label">memo</span><div>Keep dry</div>');
		expect(html).toContain('<span class="dz-label">Note</span><div>Line one<br>Line two</div>');
	});

	it('prints the footer without the format name when the block leaves it out', () => {
		const html = page([block('footer', [])]);
		expect(html).toContain('<footer class="dz-foot"><span>This is a computer-generated document.</span></footer>');
	});

	it('makes an empty file of no copies', () => {
		expect(documentHtmlCopies({ name: 'Plain', paper: 'a4', blocks: ourBlocks('taxInvoice') }, [], brand)).toBe(
			'<body class="dz-paper-a4"></body></html>',
		);
		const one = documentHtmlCopies({ name: 'Plain', paper: 'a4', blocks: ourBlocks('taxInvoice') }, [base], brand);
		expect(one).toContain('<!doctype html>');
	});
});
