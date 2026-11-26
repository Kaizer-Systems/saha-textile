import { ShopDetails } from '@saha-textile/contracts';
import type { DocumentRenderRequest } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { MAX_LABELS, PurchasingPrints } from '../src/purchasing/purchasing-prints';

const shopDetails = ShopDetails.parse({ legalName: '', gstin: null, address: '1 Lake Road' });
const named = ShopDetails.parse({
	legalName: 'Saha Textile Pvt Ltd',
	tradeName: 'Saha Textile',
	gstin: '19AAPFS4821K1ZM',
	address: '14 Hazra Road',
	phone: '9830000000',
});

const entry = (over: Record<string, unknown> = {}) =>
	({
		id: 'pe_1',
		number: null,
		status: 'checked',
		supplierId: 'sup_1',
		supplierName: 'Bishnupur Weavers',
		billNumber: 'BW/1',
		billDate: '2026-11-20',
		goodsReceivedOn: '2026-11-22',
		purchaseOrderNumber: null,
		totals: { taxableINR: 0, cgstINR: 0, sgstINR: 0, igstINR: 0, totalINR: 0 },
		lines: [
			{
				lineId: 'l1',
				title: 'Mulmul',
				optionsLabel: '',
				sku: 'FAB-1',
				quantity: 20,
				accepted: null,
				damaged: 0,
				missing: 0,
				soldBy: 'metre',
				hsnOnBill: null,
				productHsn: '5208',
				unitPriceINR: 0,
				taxableINR: 0,
				gstRatePct: 5,
				lineTotalINR: 0,
			},
			{
				lineId: 'l2',
				title: 'Cover',
				optionsLabel: '',
				sku: 'CV-1',
				quantity: 1,
				accepted: 1,
				damaged: 0,
				missing: 0,
				soldBy: 'piece',
				hsnOnBill: null,
				productHsn: null,
				unitPriceINR: 0,
				taxableINR: 0,
				gstRatePct: 5,
				lineTotalINR: 0,
			},
		],
		...over,
	}) as never;

const returnLine = (entryLineId: string) => ({
	entryLineId,
	title: 'Mulmul',
	optionsLabel: '',
	sku: 'FAB-1',
	soldBy: 'piece',
	quantity: 1,
	unitCostINR: 100,
	taxableINR: 100,
	taxINR: 5,
	gstRatePct: 5,
	totalINR: 105,
});

const purchaseReturn = (over: Record<string, unknown> = {}) =>
	({
		id: 'pr_1',
		number: 'DN/26-27/000004',
		challanNumber: 'DC/26-27/000009',
		status: 'sent',
		sentAt: '2026-11-23T06:00:00.000Z',
		taxType: 'inter_state',
		reason: 'other',
		noteToSupplier: 'Sorry for the trouble.',
		purchaseEntryId: 'pe_1',
		purchaseEntryNumber: null,
		supplierId: 'sup_1',
		supplierName: 'Bishnupur Weavers',
		courier: 'DTDC',
		docket: null,
		totalINR: 315,
		lines: [returnLine('l1'), returnLine('l2'), returnLine('gone')],
		...over,
	}) as never;

interface Parts {
	entry?: unknown;
	ret?: unknown;
	supplier?: unknown;
	renderer?: boolean;
	formats?: unknown;
	logoAsset?: boolean;
	items?: Map<string, unknown>;
	shop?: unknown;
}

function build(parts: Parts = {}) {
	const requests: DocumentRenderRequest[] = [];
	const record = vi.fn(async () => undefined);
	const service = new PurchasingPrints(
		{ findById: async () => ('entry' in parts ? parts.entry : entry()) } as never,
		{ findById: async () => ('ret' in parts ? parts.ret : purchaseReturn()) } as never,
		{ findById: async () => ('supplier' in parts ? parts.supplier : null) } as never,
		{ items: async () => parts.items ?? new Map() } as never,
		{
			loadStatic: async () => [
				{ path: 'invoice-1.css', contentType: 'text/css', data: new Uint8Array() },
				{ path: 'fonts/a.woff2', contentType: 'font/woff2', data: new Uint8Array() },
			],
			logo: async () => ({
				asset: parts.logoAsset ? { path: 'logo', contentType: 'image/png', data: new Uint8Array() } : null,
				shopName: 'Saha Textile',
				themeColor: parts.logoAsset ? '#0e6b5c' : null,
			}),
			brandFacts: async () => ({ shopName: 'Saha Textile', logoUrl: null }),
		} as never,
		{ shopDetails: async () => parts.shop ?? shopDetails, record, nameOf: async () => 'Rina' } as never,
		parts.renderer === false
			? null
			: {
					renderPdf: vi.fn(
						async (request: DocumentRenderRequest) => (requests.push(request), new Uint8Array([1])),
					),
				},
		(parts.formats ?? null) as never,
	);
	return { service, requests, record };
}

const brand = { hasLogo: true, shopName: 'Saha Textile', themeColor: '#0e6b5c' };

describe('goods receipt, edges', () => {
	it('prints a supplier deleted since, an entry not yet posted, and nothing accepted yet as 0', () => {
		const html = build().service.receiptHtml(entry(), null, shopDetails, brand);
		expect(html).toContain('To : <span class="text-content">Bishnupur Weavers</span></li></ul>');
		expect(html).toContain('<td>Not posted yet</td>');
		expect(html).toContain('<title>Goods receipt BW/1</title>');
		expect(html).toContain('<img src="logo" alt="Saha Textile">');
		expect(html).toContain('<style>:root{--theme-color:#0e6b5c}</style>');
		expect(html).toContain('<td>0.0 m</td>');
	});

	it('refuses an entry it can’t find, or without a renderer', async () => {
		await expect(build({ entry: null }).service.receiptPdf('pe_9')).rejects.toThrow('Purchase entry not found');
		await expect(build({ renderer: false }).service.receiptPdf('pe_1')).rejects.toMatchObject({
			response: { message: 'pdf_unavailable' },
		});
	});

	it('names the file by the bill when not posted, with the logo and the Brand Kit’s name as author', async () => {
		const { service, requests } = build({ logoAsset: true });
		const file = await service.receiptPdf('pe_1');
		expect(file.fileName).toBe('goods-receipt-BW-1.pdf');
		expect(requests[0]).toMatchObject({ title: 'Goods receipt BW/1', author: 'Saha Textile' });
		expect(requests[0]?.assets.map((asset) => asset.path)).toContain('logo');
	});

	it('prints on the document format, with our trade name, GSTIN and phone', async () => {
		const formats = { renderActive: vi.fn(async () => new Uint8Array([2])) };
		await build({ formats, shop: named }).service.receiptPdf('pe_1');
		expect(formats.renderActive).toHaveBeenCalledWith(
			'purchaseEntry',
			expect.objectContaining({
				seller: {
					name: 'Saha Textile Pvt Ltd',
					lines: ['Saha Textile', '14 Hazra Road', 'West Bengal', 'GSTIN 19AAPFS4821K1ZM', '9830000000'],
				},
			}),
		);
		await build({ formats }).service.receiptPdf('pe_1');
		expect(formats.renderActive).toHaveBeenLastCalledWith(
			'purchaseEntry',
			expect.objectContaining({ seller: { name: 'Saha Textile', lines: ['1 Lake Road'] } }),
		);
	});
});

describe('debit note and challan, edges', () => {
	it('prints a challan sent by courier without a docket, IGST, HSN from the product, and the note', () => {
		const html = build().service.returnHtml('challan', purchaseReturn(), entry(), null, shopDetails, brand);
		expect(html).toContain('<h3>Delivery challan</h3>');
		expect(html).toContain('<td>DC/26-27/000009</td>');
		expect(html).toContain('<th>IGST</th>');
		expect(html).toContain('FAB-1 · HSN 5208');
		expect(html).toContain('<li class="text-content">FAB-1</li>');
		expect(html).toContain(
			'Against your bill BW/1 of 20 Nov 2026 (our ). Sent by DTDC. Sorry for the trouble. Goods returned to the supplier; not a sale.',
		);
	});

	it('prints a debit note without its entry, number or date, with a docket, under "GST"', () => {
		const html = build().service.returnHtml(
			'debit-note',
			purchaseReturn({
				number: null,
				sentAt: null,
				taxType: 'none',
				noteToSupplier: null,
				docket: 'D1',
				purchaseEntryNumber: 'PE/1',
			}),
			null,
			null,
			shopDetails,
			{ hasLogo: false, shopName: 'Saha Textile', themeColor: null },
		);
		expect(html).toContain('<title>Debit note </title>');
		expect(html).toContain('<td></td><td></td><td>Other</td><td>GST</td>');
		expect(html).toContain('Against your bill  (our PE/1).</p>');
		const challan = build().service.returnHtml(
			'challan',
			purchaseReturn({ challanNumber: null, docket: 'D1' }),
			null,
			null,
			shopDetails,
			brand,
		);
		expect(challan).toContain('Sent by DTDC, docket D1');
		expect(challan).toContain('<title>Delivery challan </title>');
	});

	it('refuses a return it can’t find, an unsent or unnumbered one, and a challan where no goods travelled', async () => {
		await expect(build({ ret: null }).service.returnPdf('pr_9', 'debit-note')).rejects.toThrow(
			'Purchase return not found',
		);
		await expect(
			build({ ret: purchaseReturn({ status: 'draft' }) }).service.returnPdf('pr_1', 'debit-note'),
		).rejects.toMatchObject({ response: { message: 'not_sent' } });
		await expect(
			build({ ret: purchaseReturn({ number: null }) }).service.returnPdf('pr_1', 'debit-note'),
		).rejects.toMatchObject({ response: { message: 'not_sent' } });
		await expect(
			build({ ret: purchaseReturn({ challanNumber: null }) }).service.returnPdf('pr_1', 'challan'),
		).rejects.toMatchObject({ response: { message: 'no_challan' } });
	});

	it('prints a challan with the template, and both on their formats', async () => {
		const plain = build();
		expect((await plain.service.returnPdf('pr_1', 'challan')).fileName).toBe('DC-26-27-000009.pdf');
		expect(plain.requests[0]?.title).toBe('Delivery challan DC/26-27/000009');
		const formats = { renderActive: vi.fn(async () => new Uint8Array([2])) };
		await build({ formats }).service.returnPdf('pr_1', 'challan');
		expect(formats.renderActive).toHaveBeenLastCalledWith('deliveryChallan', expect.anything());
		await build({ formats }).service.returnPdf('pr_1', 'debit-note');
		expect(formats.renderActive).toHaveBeenLastCalledWith('debitNote', expect.anything());
	});
});

describe('label sheets, edges', () => {
	it('leaves out bars a code can’t carry and the SKU when not chosen', () => {
		const html = build().service.labelsHtml({ sheet: 'a4_65', startAt: 1, fields: ['name', 'barcode'] }, [
			{ sku: 'শাড়ি-1', name: 'Saree', priceINR: null, mrpINR: null, metre: false },
		]);
		expect(html).not.toContain('<svg');
		expect(html).toContain('<div class="foot"><span></span><span></span></div>');
	});

	const items = new Map([
		[
			'v1',
			{
				sku: 'SAR-1',
				title: { bn: 'শাড়ি' },
				optionsLabel: '',
				soldBy: 'piece',
				sellingPriceINR: 100,
				mrpINR: null,
			},
		],
		['v2', { sku: 'SAR-2', title: {}, optionsLabel: 'red', soldBy: 'piece', sellingPriceINR: 100, mrpINR: null }],
	]);

	it('refuses an item gone from the catalogue, too many labels and a server without a renderer', async () => {
		const request = (over: Record<string, unknown>) =>
			({
				sheet: 'a4_65',
				startAt: 1,
				fields: ['name'],
				items: [{ variantId: 'v1', count: 1 }],
				...over,
			}) as never;
		await expect(
			build({ items }).service.labelsPdf(request({ items: [{ variantId: 'v9', count: 1 }] }), null),
		).rejects.toMatchObject({
			response: { message: 'unknown_item', issues: [{ path: ['unknown_item', 'v9'] }] },
		});
		await expect(
			build({ items }).service.labelsPdf(request({ items: [{ variantId: 'v1', count: MAX_LABELS + 1 }] }), null),
		).rejects.toMatchObject({ response: { message: 'too_many_labels' } });
		await expect(build({ items, renderer: false }).service.labelsPdf(request({}), null)).rejects.toMatchObject({
			response: { message: 'pdf_unavailable' },
		});
	});

	it('names labels in any language or by SKU, and notes one label only on an entry that exists', async () => {
		const found = build({ items });
		const file = await found.service.labelsPdf(
			{
				sheet: 'a4_65',
				startAt: 1,
				fields: ['name'],
				items: [{ variantId: 'v1', count: 1 }],
				purchaseEntryId: 'pe_1',
			} as never,
			'adm_1',
		);
		expect(file).toMatchObject({ count: 1, fileName: 'barcode-labels-1.pdf' });
		expect(found.requests[0]?.html).toContain('<div class="name">শাড়ি</div>');
		expect(found.record).toHaveBeenCalledWith(expect.objectContaining({ text: 'Rina printed 1 barcode label.' }));
		const gone = build({ items, entry: null });
		await gone.service.labelsPdf(
			{
				sheet: 'a4_65',
				startAt: 1,
				fields: ['name'],
				items: [{ variantId: 'v2', count: 2 }],
				purchaseEntryId: 'pe_9',
			} as never,
			null,
		);
		expect(gone.requests[0]?.html).toContain('<div class="name">SAR-2 · red</div>');
		expect(gone.record).not.toHaveBeenCalled();
		await gone.service.labelsPdf({ sheet: 'a4_65', startAt: 1, fields: ['sku'], items: [] } as never, null);
		expect(gone.record).not.toHaveBeenCalled();
	});
});
