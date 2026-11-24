import { StaleVersionError } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseOrdersService } from '../src/purchasing/purchase-orders.service';

const TODAY = '2026-11-24';

const fact = (over: Record<string, unknown> = {}) => ({
	variantId: 'v1',
	productId: 'p1',
	sku: 'SAR-1',
	title: { en: 'Baluchari saree' },
	optionsLabel: 'maroon',
	soldBy: 'piece',
	productType: 'simple',
	productStatus: 'published',
	...over,
});

const line = (over: Record<string, unknown> = {}) => ({
	lineId: 'pol_1',
	productId: 'p1',
	variantId: 'v1',
	sku: 'SAR-1',
	title: 'Baluchari saree',
	optionsLabel: 'maroon',
	soldBy: 'piece',
	supplierItemCode: 'BL-22',
	quantity: 4,
	agreedPriceINR: 1000,
	gstRatePct: 5,
	lastCostINR: null,
	receivedQuantity: 0,
	receivedOn: [],
	backorderLineIds: ['bo_1'],
	...over,
});

const order = (over: Record<string, unknown> = {}) => ({
	id: 'po_1',
	number: 'PO/26-27/000001',
	status: 'draft',
	supplierId: 'sup_1',
	supplierName: 'Bishnupur Weavers',
	expectedBy: '2026-12-01',
	deliverTo: 'Main shop',
	noteToSupplier: null,
	internalNote: null,
	lines: [line()],
	orderedValueINR: 4000,
	estimatedGstINR: 200,
	sentAt: null,
	sentVia: null,
	sentBy: null,
	shopSnapshot: null,
	closedAt: null,
	closedReason: null,
	linkedEntryIds: [],
	late: false,
	createdBy: null,
	createdAt: '2026-11-20T05:00:00.000Z',
	updatedAt: '2026-11-20T05:00:00.000Z',
	updatedBy: null,
	version: 3,
	...over,
});

const supplier = (over: Record<string, unknown> = {}) => ({
	id: 'sup_1',
	legalName: 'Bishnupur Weavers',
	active: true,
	taxType: 'regular',
	gstin: null,
	stateCode: '19',
	stateName: 'West Bengal',
	address: { line: '', city: '', pin: '' },
	phone: null,
	email: null,
	...over,
});

const write = (over: Record<string, unknown> = {}) => ({
	supplierId: 'sup_1',
	expectedBy: '2026-12-10',
	deliverTo: 'Main shop',
	noteToSupplier: null,
	internalNote: null,
	lines: [{ variantId: 'v1', quantity: 2, agreedPriceINR: 1000, gstRatePct: 5 }],
	...over,
});

interface Parts {
	found?: unknown;
	supplierFound?: unknown;
	facts?: Map<string, unknown>;
	inbox?: unknown;
	renderer?: unknown;
	stores?: unknown;
	formats?: unknown;
	settings?: Record<string, unknown>;
	saveError?: unknown;
}

function build(parts: Parts = {}) {
	const orders = {
		findById: vi.fn(async () => ('found' in parts ? parts.found : order())),
		list: vi.fn(async () => ({ items: [order({ status: 'sent', expectedBy: '2026-11-01' })], total: 1 })),
		save: vi.fn(async (_next: unknown, version: number | null) => {
			if (parts.saveError) throw parts.saveError;
			return (version ?? 0) + 1;
		}),
		remove: vi.fn(async () => undefined),
	};
	const support = {
		today: () => TODAY,
		settings: async () => ({
			numberFormats: { purchaseOrder: 'PO/{fy}/{seq6}' },
			defaultDeliverTo: '',
			...parts.settings,
		}),
		record: vi.fn(async () => undefined),
		nameOf: async () => 'Rina',
		guardStale: async <T>(work: () => Promise<T>) => work(),
		shopDetails: async () => ({ legalName: 'Saha Textile', gstin: null, address: 'Kolkata' }),
		activity: vi.fn(async () => [{ id: 'a1' }]),
	};
	const document = {
		brandFacts: async () => ({ shopName: 'Saha Textile', logoUrl: null }),
		render: vi.fn(async () => ({ html: '<p>po</p>' })),
	};
	const service = new PurchaseOrdersService(
		orders as never,
		{ lastPurchases: async () => new Map([['v1', { unitPriceExGstINR: 950 }]]) } as never,
		{ findById: async () => ('supplierFound' in parts ? parts.supplierFound : supplier()) } as never,
		{ codesFor: async () => new Map([['v2', 'CODE-2']]) } as never,
		{ items: async () => parts.facts ?? new Map([['v1', fact()]]) } as never,
		{ next: async () => 7 } as never,
		document as never,
		support as never,
		(parts.inbox ?? null) as never,
		(parts.renderer ?? null) as never,
		(parts.stores ?? null) as never,
		(parts.formats ?? null) as never,
	);
	return { service, orders, support, document };
}

describe('purchase orders: reading', () => {
	it('lists orders with whether each is late, and reads one', async () => {
		const { service } = build();
		const page = await service.list({ page: 1, pageSize: 20 } as never);
		expect(page.items[0]?.late).toBe(true);
		expect((await service.get('po_1')).late).toBe(false);
	});

	it('says an order it can’t find is missing', async () => {
		const { service } = build({ found: null });
		await expect(service.get('po_x')).rejects.toThrow('Purchase order not found');
	});

	it('reads an order’s activity', async () => {
		const { service, support } = build();
		expect(await service.activity('po_1')).toEqual([{ id: 'a1' }]);
		expect(support.activity).toHaveBeenCalledWith('purchase_order', ['po_1']);
	});
});

describe('purchase orders: making one', () => {
	it('refuses a missing supplier, an inactive one and a day already past', async () => {
		await expect(build({ supplierFound: null }).service.create(write() as never, 'adm_1')).rejects.toThrow(
			'Supplier not found',
		);
		await expect(
			build({ supplierFound: supplier({ active: false }) }).service.create(write() as never, 'adm_1'),
		).rejects.toMatchObject({ response: { message: 'supplier_inactive' } });
		await expect(
			build().service.create(write({ expectedBy: '2026-11-23' }) as never, 'adm_1'),
		).rejects.toMatchObject({ response: { message: 'expected_in_past' } });
	});

	it('refuses lines for items that are gone, bundles and discontinued items', async () => {
		await expect(build({ facts: new Map() }).service.create(write() as never, 'adm_1')).rejects.toMatchObject({
			response: { message: 'unknown_item', issues: [{ path: ['unknown_item', '0'] }] },
		});
		await expect(
			build({ facts: new Map([['v1', fact({ productType: 'bundle' })]]) }).service.create(write() as never, null),
		).rejects.toMatchObject({
			response: { issues: [{ message: 'SAR-1 is a bundle and has no stock of its own.' }] },
		});
		await expect(
			build({ facts: new Map([['v1', fact({ productStatus: 'discontinued' })]]) }).service.create(
				write() as never,
				null,
			),
		).rejects.toMatchObject({ response: { issues: [{ message: 'SAR-1 is discontinued.' }] } });
	});

	it('numbers a new order, takes codes and last prices, and leaves GST out for a supplier without GST', async () => {
		const { service } = build({
			supplierFound: supplier({ taxType: 'none' }),
			facts: new Map([
				['v1', fact()],
				['v2', fact({ variantId: 'v2', sku: 'FAB-1', title: {}, soldBy: 'metre' })],
			]),
		});
		const made = await service.create(
			write({
				lines: [
					{ variantId: 'v1', quantity: 2, agreedPriceINR: 1000, gstRatePct: 5, supplierItemCode: 'MINE' },
					{ variantId: 'v2', quantity: 25, agreedPriceINR: 300, gstRatePct: 5 },
				],
			}) as never,
			'adm_1',
		);
		expect(made.number).toBe('PO/26-27/000007');
		expect(
			made.lines.map((row) => [row.title, row.supplierItemCode, row.lastCostINR, row.backorderLineIds]),
		).toEqual([
			['Baluchari saree', 'MINE', 950, []],
			['FAB-1', 'CODE-2', null, []],
		]);
		expect(made).toMatchObject({ orderedValueINR: 2750, estimatedGstINR: 0 });
	});
});

describe('purchase orders: changing a draft', () => {
	it('refuses an order that is not a draft or a new supplier', async () => {
		await expect(
			build({ found: order({ status: 'sent' }) }).service.update('po_1', write() as never, 'adm_1'),
		).rejects.toMatchObject({ response: { message: 'wrong_status' } });
		await expect(
			build().service.update('po_1', write({ supplierId: 'sup_2' }) as never, 'adm_1'),
		).rejects.toMatchObject({ response: { message: 'supplier_fixed' } });
	});

	it('keeps a line’s id, what it received and its backorders; saves at the form’s version or the order’s', async () => {
		const { service, orders } = build({ supplierFound: null });
		const saved = await service.update(
			'po_1',
			write({
				lines: [{ lineId: 'pol_1', variantId: 'v1', quantity: 6, agreedPriceINR: 1000, gstRatePct: 5 }],
			}) as never,
			'adm_1',
		);
		expect(saved.lines[0]).toMatchObject({ lineId: 'pol_1', backorderLineIds: ['bo_1'] });
		// The supplier was deleted meanwhile: GST is still estimated.
		expect(saved.estimatedGstINR).toBe(300);
		expect(orders.save).toHaveBeenLastCalledWith(expect.anything(), 3);
		const atForm = await service.update('po_1', write({ version: 9 }) as never, 'adm_1');
		expect(atForm.version).toBe(10);
		expect(atForm.lines[0]?.lineId).toMatch(/^pol_/);
		expect(atForm.lines[0]?.lineId).not.toBe('pol_1');
	});

	it('takes the backorders the form sends', async () => {
		const saved = await build().service.update(
			'po_1',
			write({
				lines: [
					{
						lineId: 'pol_1',
						variantId: 'v1',
						quantity: 6,
						agreedPriceINR: 1,
						gstRatePct: 5,
						backorderLineIds: ['bo_9'],
					},
				],
			}) as never,
			null,
		);
		expect(saved.lines[0]?.backorderLineIds).toEqual(['bo_9']);
	});
});

describe('purchase orders: delete, copy, receive, close and cancel', () => {
	it('deletes only a draft', async () => {
		await expect(build({ found: order({ status: 'sent' }) }).service.remove('po_1', null)).rejects.toMatchObject({
			response: { message: 'wrong_status' },
		});
		const { service, orders, support } = build();
		await service.remove('po_1', 'adm_1');
		expect(orders.remove).toHaveBeenCalledWith('po_1');
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Rina deleted draft order PO/26-27/000001 for Bishnupur Weavers.' }),
		);
	});

	it('copies an order as a new draft needed as many days after today, without its backorders', async () => {
		const made = await build().service.copy('po_1', 'adm_1');
		// Made 20 Nov, needed 1 Dec: 11 days, so the copy is needed 5 Dec.
		expect(made.expectedBy).toBe('2026-12-05');
		expect(made.lines[0]?.backorderLineIds).toEqual([]);
		const sameDay = await build({ found: order({ expectedBy: '2026-11-20' }) }).service.copy('po_1', null);
		expect(sameDay.expectedBy).toBe('2026-11-25');
	});

	it('fills a goods entry with what is still to come, only for an order waiting for goods', async () => {
		await expect(build().service.receiveDraft('po_1')).rejects.toMatchObject({
			response: { message: 'order_not_open' },
		});
		const draft = await build({
			found: order({
				status: 'part_received',
				lines: [line({ receivedQuantity: 1 }), line({ lineId: 'pol_2', receivedQuantity: 4 })],
			}),
		}).service.receiveDraft('po_1');
		expect(draft.lines).toEqual([expect.objectContaining({ quantity: 3, purchaseOrderLineId: 'pol_1' })]);
		const sent = await build({ found: order({ status: 'sent' }) }).service.receiveDraft('po_1');
		expect(sent.lines).toHaveLength(1);
	});

	it('closes short only an order waiting for goods', async () => {
		await expect(build().service.closeShort('po_1', 'gone', null)).rejects.toMatchObject({
			response: { message: 'wrong_status' },
		});
		const closed = await build({
			found: order({ status: 'sent', lines: [line({ receivedQuantity: 6 })] }),
		}).service.closeShort('po_1', 'Loom broke', 'adm_1');
		expect(closed).toMatchObject({ status: 'closed_short', closedReason: 'Loom broke', version: 4 });
		const part = await build({ found: order({ status: 'part_received' }) }).service.closeShort('po_1', 'x', null);
		expect(part.status).toBe('closed_short');
	});

	it('cancels only before anything arrived and only an open order', async () => {
		await expect(
			build({ found: order({ lines: [line({ receivedQuantity: 1 })] }) }).service.cancel('po_1', 'x', null),
		).rejects.toMatchObject({ response: { message: 'order_part_received' } });
		await expect(
			build({ found: order({ linkedEntryIds: ['pe_1'] }) }).service.cancel('po_1', 'x', null),
		).rejects.toMatchObject({ response: { message: 'order_part_received' } });
		for (const status of ['cancelled', 'closed_short', 'received'])
			await expect(build({ found: order({ status }) }).service.cancel('po_1', 'x', null)).rejects.toMatchObject({
				response: { message: 'wrong_status' },
			});
		const cancelled = await build().service.cancel('po_1', 'Not needed', 'adm_1');
		expect(cancelled).toMatchObject({ status: 'cancelled', closedReason: 'Not needed' });
	});

	it('turns a stale save into the conflict the support makes', async () => {
		const stale = new StaleVersionError('purchase_order', 'po_1', {
			version: 4,
			updatedAt: '2026-11-24T10:00:00.000Z',
			updatedBy: 'adm_2',
		} as never);
		const { service } = build({ found: order({ status: 'sent' }), saveError: stale });
		await expect(service.closeShort('po_1', 'x', null)).rejects.toBe(stale);
	});
});

describe('purchase orders: the PDF', () => {
	it('refuses on a server without a renderer', async () => {
		await expect(build().service.pdf('po_1')).rejects.toMatchObject({ response: { message: 'pdf_unavailable' } });
	});

	it('uses the vendor template on a server without document formats', async () => {
		const renderer = { renderPdf: vi.fn(async () => new Uint8Array([1])) };
		const { service, document } = build({ renderer });
		expect(await service.pdf('po_1')).toEqual({ fileName: 'PO-26-27-000001.pdf', data: new Uint8Array([1]) });
		expect(document.render).toHaveBeenCalled();
	});

	it('prints a draft with today’s shop details and a sent order with the ones it went out with', async () => {
		const formats = {
			seller: vi.fn(async () => ({ name: 'Saha Textile', lines: ['Kolkata'] })),
			renderActive: vi.fn(async () => new Uint8Array([2])),
		};
		const renderer = { renderPdf: vi.fn() };
		const draft = build({ renderer, formats });
		await draft.service.pdf('po_1');
		expect(formats.seller).toHaveBeenCalledWith({ name: 'Saha Textile', lines: [] });
		const snapshot = {
			legalName: 'Saha Textile Pvt Ltd',
			tradeName: 'Saha Textile',
			addressLines: ['1 Lake Road', 'Kolkata'],
			gstin: '19AAACB1234F1Z5',
			phone: '9830000000',
			email: null,
		};
		const sent = build({ renderer, formats, found: order({ status: 'sent', shopSnapshot: snapshot }) });
		await sent.service.pdf('po_1');
		expect(formats.renderActive).toHaveBeenLastCalledWith(
			'purchaseOrder',
			expect.objectContaining({
				seller: {
					name: 'Saha Textile Pvt Ltd',
					lines: ['Saha Textile', '1 Lake Road', 'Kolkata', 'GSTIN 19AAACB1234F1Z5', '9830000000'],
				},
			}),
		);
		const plain = build({
			renderer,
			formats,
			found: order({ status: 'sent', shopSnapshot: { ...snapshot, tradeName: '', gstin: null, phone: null } }),
		});
		await plain.service.pdf('po_1');
		expect(formats.renderActive).toHaveBeenLastCalledWith(
			'purchaseOrder',
			expect.objectContaining({ seller: { name: 'Saha Textile Pvt Ltd', lines: ['1 Lake Road', 'Kolkata'] } }),
		);
	});
});

describe('purchase orders: sending', () => {
	const email = (over: Record<string, unknown> = {}) => ({
		via: 'email',
		mailboxId: 'mbx_1',
		from: 'orders@saha-textile.test',
		to: ['weavers@bishnupur.test'],
		subject: '',
		message: 'Please confirm.',
		...over,
	});

	it('refuses a closed order and an order without lines', async () => {
		await expect(
			build({ found: order({ status: 'part_received' }) }).service.send('po_1', { via: 'manual' } as never, null),
		).rejects.toMatchObject({ response: { message: 'wrong_status' } });
		await expect(
			build({ found: order({ lines: [] }) }).service.send('po_1', { via: 'manual' } as never, null),
		).rejects.toMatchObject({ response: { message: 'no_lines' } });
	});

	it('marks an order sent by hand, snapshotting the shop details once', async () => {
		const { service, support } = build();
		const sent = await service.send('po_1', { via: 'manual' } as never, 'adm_1');
		expect(sent).toMatchObject({
			status: 'sent',
			sentVia: 'manual',
			shopSnapshot: expect.objectContaining({ legalName: 'Saha Textile' }),
		});
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({ text: expect.stringContaining('marked PO/26-27/000001 sent') }),
		);
		const snapshot = { legalName: 'Kept' };
		const again = await build({ found: order({ status: 'sent', shopSnapshot: snapshot }) }).service.send(
			'po_1',
			{ via: 'manual' } as never,
			null,
		);
		expect(again.shopSnapshot).toBe(snapshot);
	});

	it('refuses email without mailboxes, a mailbox, a sender, a recipient or a signed-in person', async () => {
		await expect(build().service.send('po_1', email() as never, 'adm_1')).rejects.toMatchObject({
			response: { message: 'mailbox_unavailable' },
		});
		const inbox = { send: vi.fn(async () => undefined) };
		const service = build({ inbox }).service;
		await expect(service.send('po_1', email({ mailboxId: '' }) as never, 'adm_1')).rejects.toMatchObject({
			response: { message: 'mailbox_required' },
		});
		await expect(service.send('po_1', email({ from: '' }) as never, 'adm_1')).rejects.toMatchObject({
			response: { message: 'mailbox_required' },
		});
		await expect(service.send('po_1', email({ to: [] }) as never, 'adm_1')).rejects.toMatchObject({
			response: { message: 'recipient_required' },
		});
		await expect(service.send('po_1', email() as never, null)).rejects.toMatchObject({
			response: { message: 'mailbox_required', issues: [{ message: 'Sign in again to send mail.' }] },
		});
	});

	it('emails the PDF with the order’s subject or the one typed', async () => {
		const inbox = { send: vi.fn(async () => undefined) };
		const renderer = { renderPdf: vi.fn(async () => new Uint8Array([1, 2])) };
		const { service, support } = build({ inbox, renderer });
		await service.send('po_1', email() as never, 'adm_1');
		expect(inbox.send).toHaveBeenCalledWith(
			'adm_1',
			'mbx_1',
			expect.objectContaining({
				subject: 'Purchase order PO/26-27/000001',
				attachments: [{ filename: 'PO-26-27-000001.pdf', mimeType: 'application/pdf', data: 'AQI=' }],
			}),
		);
		expect(support.record).toHaveBeenCalledWith(
			expect.objectContaining({
				text: 'Rina emailed PO/26-27/000001 to Bishnupur Weavers (weavers@bishnupur.test) from orders@saha-textile.test with the PDF.',
			}),
		);
		await build({ inbox, renderer, found: order({ status: 'sent' }) }).service.send(
			'po_1',
			email({ subject: 'Our order' }) as never,
			'adm_1',
		);
		expect(inbox.send).toHaveBeenLastCalledWith(
			'adm_1',
			'mbx_1',
			expect.objectContaining({ subject: 'Our order' }),
		);
	});
});

describe('purchase orders: drafts from the reorder list', () => {
	const group = [
		{ supplierId: 'sup_1', lines: [{ variantId: 'v1', quantity: 2, agreedPriceINR: 1, gstRatePct: 5 }] },
	];

	it('delivers to the default place, two weeks out', async () => {
		const [made] = await build({ settings: { defaultDeliverTo: 'Godown' } }).service.draftsFromReorder(
			group as never,
			null,
		);
		expect(made).toMatchObject({ deliverTo: 'Godown', expectedBy: '2026-12-08' });
	});

	it('else to the first active store by its order in Settings › Stores', async () => {
		const stores = {
			list: async () => [
				{ active: true, displayOrder: 2, name: { en: 'Second' }, address: { en: 'B Road' } },
				{ active: false, displayOrder: 0, name: { en: 'Closed' }, address: { en: '' } },
				{ active: true, displayOrder: 1, name: { en: 'Main shop' }, address: {} },
			],
		};
		const [made] = await build({ stores }).service.draftsFromReorder(group as never, null);
		expect(made?.deliverTo).toBe('Main shop');
	});

	it('refuses when no place is set and no store answers', async () => {
		await expect(build().service.draftsFromReorder(group as never, null)).rejects.toMatchObject({
			response: { message: 'deliver_to_required' },
		});
		const failing = { list: async () => Promise.reject(new Error('down')) };
		await expect(build({ stores: failing }).service.draftsFromReorder(group as never, null)).rejects.toMatchObject({
			response: { message: 'deliver_to_required' },
		});
	});
});
