import type { InventorySettings, PurchaseEntry, PurchaseReturn, Supplier } from '@saha-textile/contracts';
import type { DocumentRenderRequest } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PurchasingPrints } from '../src/purchasing/purchasing-prints';

const settings = {
	business: { legalName: 'Saha Textile', gstin: '19AAPFS4821K1ZM', addressLines: ['14 Hazra Road, Kolkata 700026'] },
} as unknown as InventorySettings;
const brand = { hasLogo: false, shopName: 'Saha Textile', themeColor: null };

const supplier = {
	legalName: 'Shantipur <Tant> Ghar',
	gstin: '19AAHFS7782K1Z3',
	stateCode: '19',
	stateName: 'West Bengal',
	address: { line: 'Station Road', city: 'Shantipur', pin: '741404' },
} as unknown as Supplier;

const entry = {
	id: 'pe1',
	number: 'PE/26-27/000016',
	status: 'posted',
	supplierId: 's1',
	supplierName: 'Shantipur Tant Ghar',
	billNumber: 'STG/1187',
	billDate: '2026-11-13',
	goodsReceivedOn: '2026-11-14',
	lines: [
		{
			lineId: 'l1',
			title: 'Shantipur Tant Cotton Saree',
			optionsLabel: 'Blue–White',
			sku: 'ST-TNT-1108-BW',
			quantity: 12,
			accepted: 11,
			damaged: 1,
			missing: 0,
			soldBy: 'piece',
			hsnOnBill: '5208',
			productHsn: '5208',
		},
	],
} as unknown as PurchaseEntry;

function prints(overrides: { entry?: PurchaseEntry | null; ret?: PurchaseReturn | null } = {}) {
	const requests: DocumentRenderRequest[] = [];
	const record = vi.fn();
	const service = new PurchasingPrints(
		{ findById: vi.fn(async () => (overrides.entry === undefined ? entry : overrides.entry)) } as never,
		{ findById: vi.fn(async () => overrides.ret ?? null) } as never,
		{ findById: vi.fn(async () => supplier) } as never,
		{
			items: vi.fn(
				async (ids: string[]) =>
					new Map(
						ids.map((id) => [
							id,
							{
								variantId: id,
								sku: id === 'v1' ? 'ST-BAN-0412' : 'ST-FAB-0007',
								title: { en: id === 'v1' ? 'Red Banarasi <Saree>' : 'Mulmul' },
								optionsLabel: '',
								soldBy: id === 'v1' ? 'piece' : 'metre',
								sellingPriceINR: 15900,
								mrpINR: 18500,
							},
						]),
					),
			),
		} as never,
		{
			loadStatic: vi.fn(async () => [
				{ path: 'invoice-1.css', contentType: 'text/css', data: new Uint8Array() },
				{ path: 'fonts/a.woff2', contentType: 'font/woff2', data: new Uint8Array() },
			]),
			logo: vi.fn(async () => ({ asset: null, shopName: 'Saha Textile', themeColor: null })),
		} as never,
		{ settings: vi.fn(async () => settings), record, nameOf: vi.fn(async () => 'Rina') } as never,
		{
			renderPdf: vi.fn(
				async (request: DocumentRenderRequest) => (requests.push(request), new Uint8Array([37, 80, 68, 70])),
			),
		},
	);
	return { service, requests, record };
}

describe('goods receipt (p01)', () => {
	it('lists what was counted, escaped, with both parties', () => {
		const html = prints().service.receiptHtml(entry, supplier, settings, brand);
		expect(html).toContain('Goods receipt');
		expect(html).toContain('Shantipur &lt;Tant&gt; Ghar');
		expect(html).toContain('GSTIN 19AAPFS4821K1ZM');
		expect(html).toContain('<td>11</td><td>1</td><td>0</td>');
	});

	it('refuses a draft and prints a checked or posted entry', async () => {
		await expect(
			prints({ entry: { ...entry, status: 'draft' } as PurchaseEntry }).service.receiptPdf('pe1'),
		).rejects.toThrow();
		const { service, requests } = prints();
		const file = await service.receiptPdf('pe1');
		expect(file.fileName).toBe('goods-receipt-PE-26-27-000016.pdf');
		expect(requests[0]?.title).toBe('Goods receipt PE/26-27/000016');
	});
});

describe('debit note and challan (r04)', () => {
	const ret = {
		id: 'r1',
		number: 'DN/26-27/000003',
		challanNumber: null,
		status: 'sent',
		kind: 'return_goods',
		purchaseEntryId: 'pe1',
		purchaseEntryNumber: 'PE/26-27/000016',
		supplierId: 's1',
		supplierName: 'Shantipur Tant Ghar',
		taxType: 'intra_state',
		reason: 'damaged_on_arrival',
		noteToSupplier: null,
		sentAt: '2026-11-15T06:00:00.000Z',
		courier: null,
		docket: null,
		totalINR: 1102.5,
		lines: [
			{
				entryLineId: 'l1',
				title: 'Shantipur Tant Cotton Saree',
				optionsLabel: 'Blue–White',
				sku: 'ST-TNT-1108-BW',
				quantity: 1,
				soldBy: 'piece',
				unitCostINR: 1050,
				taxableINR: 1050,
				taxINR: 52.5,
				totalINR: 1102.5,
				gstRatePct: 5,
			},
		],
	} as unknown as PurchaseReturn;

	it('carries the number, the bill it is against, the HSN and the tax head', () => {
		const html = prints().service.returnHtml('debit-note', ret, entry, supplier, settings, brand);
		expect(html).toContain('DN/26-27/000003');
		expect(html).toContain('Against your bill STG/1187');
		expect(html).toContain('HSN 5208');
		expect(html).toContain('CGST + SGST');
	});

	it('refuses an unsent return and a challan where no goods travelled', async () => {
		await expect(
			prints({ ret: { ...ret, status: 'draft', number: null } as PurchaseReturn }).service.returnPdf(
				'r1',
				'debit-note',
			),
		).rejects.toThrow();
		await expect(prints({ ret }).service.returnPdf('r1', 'challan')).rejects.toThrow();
		const file = await prints({ ret }).service.returnPdf('r1', 'debit-note');
		expect(file.fileName).toBe('DN-26-27-000003.pdf');
	});
});

describe('label sheets (l01)', () => {
	it('places many items on one sheet after the used labels, with Code 128 bars and escaped names', () => {
		const html = prints().service.labelsHtml(
			{ sheet: 'a4_65', startAt: 4, fields: ['name', 'sku', 'barcode', 'price', 'mrp'] },
			[
				{ sku: 'ST-BAN-0412', name: 'Red <Saree>', priceINR: 15900, mrpINR: 18500, metre: false },
				{ sku: 'ST-FAB-0007', name: 'Mulmul', priceINR: 180, mrpINR: null, metre: true },
			],
		);
		expect(html.match(/<section class="sheet">/g)).toHaveLength(1);
		expect(html).toContain('top:10.7mm;left:126.55mm');
		expect(html).toContain('Red &lt;Saree&gt;');
		expect(html).toContain('/ m');
		expect(html).toContain('<rect');
		expect(html).toContain('@page{size:A4;margin:0}');
	});

	it('runs onto a second sheet, prints at no margin, and notes the print on the entry', async () => {
		const { service, requests, record } = prints();
		const file = await service.labelsPdf(
			{
				sheet: 'a4_21',
				startAt: 20,
				fields: ['sku', 'barcode'],
				items: [{ variantId: 'v1', count: 3 }],
				purchaseEntryId: 'pe1',
			},
			'u1',
		);
		expect(file.count).toBe(3);
		expect(requests[0]?.page.marginMm).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		expect(requests[0]?.html.match(/<section class="sheet">/g)).toHaveLength(2);
		expect(requests[0]?.assets.every((asset) => asset.path.startsWith('fonts/'))).toBe(true);
		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'purchase.entry.labels',
				entityId: 'pe1',
				actor: 'u1',
				text: 'Rina printed 3 barcode labels.',
			}),
		);
	});
});
