import { DocumentFormat, Order, type DocumentKind } from '@saha-textile/contracts';
import { ourBlocks, seedDocumentFormats } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { documentHtml } from '../src/documents/document-html';
import { previewDocument } from '../src/documents/document-previews';
import { DocumentFormatsService } from '../src/documents/document-formats.service';
import { packingSlipData } from '../src/documents/packing-slip';
import { purchaseOrderData } from '../src/documents/purchase-order';

const brand = { logoSrc: null, themeColor: '#0e6b5c', fontFaces: '' };

function service(formats: DocumentFormat[]) {
	const store = new Map(formats.map((row) => [row.id, row]));
	const repo = {
		list: async () => [...store.values()],
		findById: async (id: string) => store.get(id) ?? null,
		findActive: async (doc: DocumentKind) =>
			[...store.values()].find((row) => row.doc === doc && row.active) ?? null,
		create: async (row: DocumentFormat) => (store.set(row.id, row), row),
		update: async (row: DocumentFormat, version: number) => {
			if (store.get(row.id)?.version !== version) return null;
			const saved = { ...row, version: version + 1 };
			store.set(row.id, saved);
			return saved;
		},
		switchOn: async (id: string) => {
			const on = store.get(id);
			if (!on) return null;
			const off = [...store.values()].find((row) => row.doc === on.doc && row.active && row.id !== id) ?? null;
			if (off) store.set(off.id, { ...off, active: false });
			store.set(id, { ...on, active: true });
			return { on: { ...on, active: true }, off: off ? { ...off, active: false } : null };
		},
	};
	const numbering = { get: async () => null };
	const paperwork = {
		logo: async () => ({ asset: null, shopName: 'Saha Textile', themeColor: null }),
		brandFacts: async () => ({ shopName: 'Saha Textile', logoUrl: null }),
	};
	return new DocumentFormatsService(repo as never, numbering as never, paperwork as never, null);
}

describe('document formats (bundle builder brief F)', () => {
	it('prints every document’s example with our format, escaping what it prints', () => {
		for (const seed of seedDocumentFormats()) {
			const html = documentHtml(seed, previewDocument(seed.doc), brand);
			expect(html).toContain(`<title>${previewDocument(seed.doc).title}`);
		}
		const data = { ...previewDocument('packingSlip'), title: 'Packing <slip>' };
		expect(documentHtml({ name: 'x', paper: 'a4', blocks: ourBlocks('packingSlip') }, data, brand)).toContain(
			'Packing &lt;slip&gt;',
		);
	});

	it('prints a set as a heading row with no amount, its pieces under it, free items with the MRP struck', () => {
		const html = documentHtml(seedDocumentFormats()[0]!, previewDocument('taxInvoice'), brand);
		const setRow = html.match(/<tr class="dz-row dz-set"[^>]*>(.*?)<\/tr>/)?.[1] ?? '';
		expect(setRow).toContain('Wedding saree set');
		// Only its name and its price in words: every amount column is empty.
		expect(setRow).not.toContain('dz-num');
		expect(setRow).toContain('set price ₹16,425');
		expect(html).toContain('dz-row dz-free');
		expect(html).toContain('<div class="dz-struck">₹799.00</div>');
		expect(html).toContain('<th class="dz-num">IGST</th>');
		expect(html).toContain('counter(pages)');
	});

	it('closes the totals with the total, the round off just above it', () => {
		const html = documentHtml(seedDocumentFormats()[0]!, previewDocument('taxInvoice'), brand);
		const box = html.match(/<section class="dz-totals">(.*?)<\/section>/)?.[1] ?? '';
		expect([...box.matchAll(/<span>(.*?)<\/span>/g)].map((m) => m[1])).toEqual([
			'Taxable value',
			'IGST',
			'Round off',
			'Total',
		]);
		expect(box).toMatch(/class="dz-total"><span>Total</);
	});

	it('leaves out hidden blocks and columns the format did not choose', () => {
		const blocks = ourBlocks('taxInvoice').map((block) => {
			if (block.type === 'hsnSummary') return { ...block, hidden: true };
			if (block.type === 'table') return { ...block, fields: block.fields.filter((f) => f !== 'rate') };
			return block;
		});
		const html = documentHtml({ name: 'x', paper: 'a5', blocks }, previewDocument('taxInvoice'), brand);
		expect(html).not.toContain('class="dz-hsn"');
		expect(html).not.toContain('>Rate<');
		expect(html).toContain('size:A5');
	});

	it('makes a layout from ours or blank, switched off, and saves only what passes the checks', async () => {
		const svc = service(seedDocumentFormats());
		const made = await svc.create({ doc: 'packingSlip', from: 'blank', name: 'Small slip' }, 'u1');
		expect(made).toMatchObject({ doc: 'packingSlip', active: false, seeded: false });
		expect(made.blocks.map((row) => row.type)).toEqual(['facts', 'table']);
		const bad = made.blocks.map((row) => (row.type === 'table' ? { ...row, fields: ['index'] } : row));
		await expect(
			svc.update(made.id, { name: 'Small slip', about: '', paper: 'a5', blocks: bad, version: 1 }),
		).rejects.toMatchObject({ response: { code: 'document_format_invalid' } });
		const saved = await svc.update(
			made.id,
			{ name: 'Small slip', about: '', paper: 'a5', blocks: made.blocks, version: 1 },
			'u1',
		);
		expect(saved.version).toBe(2);
		await expect(
			svc.update(made.id, { name: 'Again', about: '', paper: 'a5', blocks: made.blocks, version: 1 }, 'u1'),
		).rejects.toMatchObject({ response: { code: 'document_format_changed' } });
	});

	it('switches one on and the other off; switching off says why it can’t', async () => {
		const svc = service(seedDocumentFormats());
		const result = await svc.switchOn('dfm_taxInvoice_compact', 'u1');
		expect([result.active.id, result.switchedOff?.id]).toEqual([
			'dfm_taxInvoice_compact',
			'dfm_taxInvoice_standard',
		]);
		await expect(svc.switchOff('dfm_deliveryChallan_standard')).rejects.toMatchObject({
			response: { code: 'document_format_only_format' },
		});
		await expect(svc.switchOff('dfm_taxInvoice_compact')).rejects.toMatchObject({
			response: { code: 'document_format_switch_another' },
		});
		const view = await svc.view();
		expect(view.groups.map((g) => g.group)).toEqual(['sales', 'parcels', 'purchases', 'stock']);
		expect(view.groups.map((g) => g.documents.length)).toEqual([6, 2, 5, 4]);
	});

	it('previews unsaved blocks as HTML, refusing blocks the document can’t have', async () => {
		const svc = service(seedDocumentFormats());
		const html = await svc.previewHtml('dfm_journal_standard', { paper: 'a4', blocks: ourBlocks('journal') });
		expect(html).toContain('Journal voucher');
		await expect(
			svc.previewHtml('dfm_journal_standard', { paper: 'a4', blocks: ourBlocks('taxInvoice') }),
		).rejects.toMatchObject({ response: { code: 'document_format_invalid' } });
		for (const seed of seedDocumentFormats()) expect(() => DocumentFormat.parse(seed)).not.toThrow();
	});
});

describe('real documents on their formats', () => {
	const line = (over: Record<string, unknown>) => ({
		productId: 'p',
		title: { en: 'Piece' },
		sku: 'SKU',
		quantity: 1,
		unitPriceINR: 0,
		unitPricePaid: 0,
		lineTotalINR: 0,
		lineTotalPaid: 0,
		...over,
	});
	const order = Order.parse({
		id: 'ord_1',
		orderNumber: 'ST-2611-482190',
		userId: 'cus_1',
		currency: 'INR',
		status: 'processing',
		createdAt: '2026-11-22T05:10:00.000Z',
		lines: [
			line({
				lineId: 's',
				role: 'bundle',
				title: { en: 'Peacock set' },
				set: { heading: 'components', priceINR: 44900, separatelyINR: 48400 },
			}),
			line({ lineId: 's~a', role: 'piece', parentLineId: 's', title: { en: 'Peacock saree' }, sku: 'ST-933' }),
			line({
				lineId: 's~a>f',
				role: 'free',
				parentLineId: 's~a',
				title: { en: 'Petticoat' },
				attributes: { Size: 'M' },
			}),
			line({ lineId: 's~x', role: 'extra', parentLineId: 's', title: { en: 'Gift box' } }),
			line({ lineId: 'p', title: { en: 'Lavender saree' }, quantity: 2 }),
			line({ lineId: 'p~bag', role: 'free', parentLineId: 'p', title: { en: 'Cover bag' } }),
		],
		subtotalINR: 0,
		subtotalPaid: 0,
		totalINR: 0,
		totalPaid: 0,
		shipping: { value: 0, currency: 'INR', provider: 'Shiprocket', method: 'Surface' },
		addresses: {
			billing: { fullName: 'Priya Sharma', line1: '14/2 Lake Road', city: 'Kolkata', country: 'IN' },
			delivery: {
				fullName: 'Priya Sharma',
				line1: '14/2 Lake Road',
				city: 'Kolkata',
				state: 'West Bengal',
				postalCode: '700029',
				country: 'IN',
			},
			billingSameAsDelivery: true,
			invoice: { source: 'billing', address: null, needed: false },
		},
	});

	it('prints the pack list flat with where each piece came from, and no prices', () => {
		const data = packingSlipData(
			order,
			{ name: 'Saha Textile', lines: [] },
			{ parcelNo: 'ST-2611-482190/P1', date: '22 Nov 2026' },
		);
		expect(data.rows?.map((row) => [row.cells['item'], row.cells['qty'], row.cells['cameWith']])).toEqual([
			['Peacock saree', '1', 'Peacock set, piece 1'],
			['Petticoat · M', '1', 'Free with piece 1 of Peacock set'],
			['Gift box', '1', 'Extra with Peacock set'],
			['Lavender saree', '2', 'Line 2'],
			['Cover bag', '1', 'Free with line 2'],
		]);
		expect(data.values).toMatchObject({ parcelNo: 'ST-2611-482190/P1', courier: 'Shiprocket · Surface' });
		const html = documentHtml({ name: 'x', paper: 'a4', blocks: ourBlocks('packingSlip') }, data, brand);
		expect(html).not.toContain('₹');
		expect(html.match(/class="dz-tick"/g)).toHaveLength(5);
	});

	it('prints a purchase order with the supplier’s codes, GST and the expected total', () => {
		const data = purchaseOrderData(
			{
				number: 'PO/26-27/000052',
				supplierName: 'Bishnupur Weavers',
				expectedBy: '2026-12-05',
				deliverTo: 'Main shop',
				noteToSupplier: 'Pack each saree in its own cover.',
				createdAt: '2026-11-22T05:10:00.000Z',
				orderedValueINR: 37200,
				lines: [
					{
						title: 'Baluchari saree',
						optionsLabel: 'maroon',
						sku: 'ST-1',
						supplierItemCode: 'BL-22',
						quantity: 6,
						soldBy: 'piece',
						agreedPriceINR: 6200,
						gstRatePct: 5,
					},
				],
			} as never,
			null,
			{ name: 'Saha Textile', lines: [] },
		);
		expect(data.rows?.[0]?.cells).toMatchObject({
			item: 'Baluchari saree, maroon',
			supplierCode: 'BL-22',
			gstRate: '5%',
		});
		expect(data.totals?.['totals']?.[0]?.label).toBe('Expected total (before GST)');
		const html = documentHtml({ name: 'x', paper: 'a4', blocks: ourBlocks('purchaseOrder') }, data, brand);
		expect(html).toContain('Pack each saree in its own cover.');
	});
});

describe('pages after the first', () => {
	it('repeat a slim header with the document, its number and the shop, escaped for CSS', () => {
		const data = { ...previewDocument('journal'), number: 'JV/26-27/"1"' };
		const html = documentHtml({ name: 'x', paper: 'a4', blocks: ourBlocks('journal') }, data, brand);
		expect(html).toContain('@top-left{content:"Journal voucher JV/26-27/\\"1\\""');
		expect(html).toContain('@page:first{@top-left{content:none}');
		const shop = documentHtml(
			{ name: 'x', paper: 'a4', blocks: ourBlocks('journal') },
			{ ...data, seller: { name: 'A</style><script>x</script>', lines: [] } },
			brand,
		);
		expect(shop).not.toContain('</style><script>');
	});
});
