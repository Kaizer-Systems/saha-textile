import { ourBlocks } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { documentHtml, eInvoiceBand } from '../src/documents/document-html';
import { previewDocument } from '../src/documents/document-previews';

const brand = { logoSrc: null, themeColor: null, fontFaces: '' };
const format = { name: 'Saha Textile standard', paper: 'a4' as const, blocks: ourBlocks('taxInvoice') };

describe('the e-invoice band (accounts brief addendum 2, EI8–EI9; AE4)', () => {
	it('prints the signed QR, IRN, acknowledgement and page number in the foot of an invoice with an IRN', () => {
		const data = previewDocument('taxInvoice');
		const band = eInvoiceBand(format, data);
		expect(band).toContain('E-INVOICE · SIGNED BY THE IRP');
		expect(band).toContain('16249c4dea9e9ad1f40245b8d7cf6f48e0a6233a694ee112d578da7e22e24e34');
		expect(band).toContain('<svg style="width:31mm;height:31mm;display:block"');
		expect(band).toContain('class="pageNumber"');
		const html = documentHtml(format, data, brand, { band: true });
		expect(html).not.toContain('class="dz-einvoice"');
		expect(html).not.toContain('<span>E-way bill</span>');
		expect(html).not.toContain('@bottom-right');
		expect(html).toContain('margin:14mm 12mm 47mm');
	});

	it('leaves an invoice without an IRN as it is: no band, page number in the page rule', () => {
		const data = previewDocument('taxInvoice');
		const plain = { ...data, values: { ...data.values, irn: '' } };
		expect(eInvoiceBand(format, plain)).toBeNull();
		const html = documentHtml(format, plain, brand);
		expect(html).toContain('@bottom-right');
		expect(html).toContain('margin:14mm 12mm 16mm');
	});

	it('says “QR pending” when the IRN was typed by hand without the signed file', () => {
		const data = { ...previewDocument('taxInvoice'), qrSvg: undefined };
		expect(eInvoiceBand(format, data)).toContain('QR pending');
	});
});
