import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
	PurchaseEntryWrite,
	PurchaseOrder,
	PurchaseOrderListQuery,
	PurchaseOrderListResponse,
	PurchaseOrderSend,
	PurchaseOrderWrite,
} from '@saha-textile/contracts';
import { shopOnDocument } from '@saha-textile/contracts';
import {
	type DocumentRendererPort,
	type NumberAllocatorPort,
	type PurchaseEntryRepository,
	type PurchaseOrderRepository,
	type StockReadRepository,
	type StoreLocationRepository,
	type SupplierItemCodeRepository,
	type SupplierRepository,
	billedUnits,
	describeUnits,
	fiscalYearOf,
	formatDocumentNumber,
	formatRupees,
	fromPaise,
	purchaseOrderLate,
	purchaseOrderStatusOf,
	roundPaise,
	toPaise,
} from '@saha-textile/core-domain';

import {
	DOCUMENT_RENDERER,
	NUMBER_ALLOCATOR,
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_ORDER_REPOSITORY,
	STOCK_READ_REPOSITORY,
	STORE_LOCATION_REPOSITORY,
	SUPPLIER_ITEM_CODE_REPOSITORY,
	SUPPLIER_REPOSITORY,
} from '../infra/tokens';
import { InboxService } from '../mailboxes/inbox.service';
import { blockedReason } from './purchase-items.service';
import { PurchaseOrderDocument } from './purchase-order-document';
import { PurchasingSupport, missing, refuse } from './purchasing-support';

/**
 * Purchase orders (po01–po05, po04b). An order moves no stock and owes no money: the purchase
 * entry made from it does. Its status is worked out from the entries linked to it; it closes by
 * itself when everything has arrived.
 */
@Injectable()
export class PurchaseOrdersService {
	constructor(
		@Inject(PURCHASE_ORDER_REPOSITORY) private readonly orders: PurchaseOrderRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
		@Inject(SUPPLIER_ITEM_CODE_REPOSITORY) private readonly itemCodes: SupplierItemCodeRepository,
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(NUMBER_ALLOCATOR) private readonly numbers: NumberAllocatorPort,
		private readonly document: PurchaseOrderDocument,
		private readonly support: PurchasingSupport,
		@Optional() private readonly inbox: InboxService | null = null,
		@Optional() @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentRendererPort | null = null,
		@Optional() @Inject(STORE_LOCATION_REPOSITORY) private readonly stores: StoreLocationRepository | null = null,
	) {}

	private withLate(order: PurchaseOrder, today: string): PurchaseOrder {
		return { ...order, late: purchaseOrderLate({ status: order.status, expectedBy: order.expectedBy, today }) };
	}

	private async load(id: string): Promise<PurchaseOrder> {
		const order = await this.orders.findById(id);
		if (!order) throw missing('Purchase order');
		return order;
	}

	async list(query: PurchaseOrderListQuery): Promise<PurchaseOrderListResponse> {
		const today = this.support.today();
		const page = await this.orders.list({ ...query, today });
		return { ...page, items: page.items.map((order) => this.withLate(order, today)) };
	}

	async get(id: string): Promise<PurchaseOrder> {
		return this.withLate(await this.load(id), this.support.today());
	}

	/** Lines from what the form sends: item facts, the last price paid, the supplier's own code. */
	private async lines(supplierId: string, write: PurchaseOrderWrite, existing: PurchaseOrder | null) {
		const ids = [...new Set(write.lines.map((line) => line.variantId))];
		const [facts, last, codes] = await Promise.all([
			this.stock.items(ids),
			this.entries.lastPurchases(ids, null),
			this.itemCodes.codesFor(supplierId, ids),
		]);
		return write.lines.map((line, index) => {
			const fact = facts.get(line.variantId);
			if (!fact) throw refuse('unknown_item', `Line ${index + 1}: this item no longer exists.`, String(index));
			const blocked = blockedReason(fact);
			if (blocked) {
				throw refuse(
					'blocked_product',
					`${fact.sku} ${blocked === 'bundle' ? 'is a bundle and has no stock of its own' : 'is discontinued'}.`,
					String(index),
				);
			}
			const before = existing?.lines.find((old) => old.lineId === line.lineId);
			return {
				lineId: before?.lineId ?? `pol_${randomUUID()}`,
				productId: fact.productId,
				variantId: fact.variantId,
				sku: fact.sku,
				title: fact.title['en'] ?? fact.sku,
				optionsLabel: fact.optionsLabel,
				soldBy: fact.soldBy,
				supplierItemCode: line.supplierItemCode ?? codes.get(fact.variantId) ?? null,
				quantity: line.quantity,
				agreedPriceINR: line.agreedPriceINR,
				gstRatePct: line.gstRatePct,
				lastCostINR: last.get(fact.variantId)?.unitPriceExGstINR ?? null,
				receivedQuantity: before?.receivedQuantity ?? 0,
				receivedOn: before?.receivedOn ?? [],
				backorderLineIds: line.backorderLineIds ?? before?.backorderLineIds ?? [],
			};
		});
	}

	/** The estimate: lines before GST, and GST at each line's example rate (none for composition). */
	private estimate(lines: PurchaseOrder['lines'], taxed: boolean) {
		const values = lines.map((line) =>
			roundPaise(billedUnits(line.quantity, line.soldBy) * toPaise(line.agreedPriceINR)),
		);
		const gst = taxed
			? lines.reduce((sum, line, index) => sum + roundPaise(((values[index] ?? 0) * line.gstRatePct) / 100), 0)
			: 0;
		return {
			orderedValueINR: fromPaise(values.reduce((sum, value) => sum + value, 0)),
			estimatedGstINR: fromPaise(gst),
		};
	}

	async create(write: PurchaseOrderWrite, actor: string | null): Promise<PurchaseOrder> {
		const supplier = await this.suppliers.findById(write.supplierId);
		if (!supplier) throw missing('Supplier');
		if (!supplier.active) throw refuse('supplier_inactive', `${supplier.legalName} is inactive.`, 'supplierId');
		const today = this.support.today();
		if (write.expectedBy < today)
			throw refuse('expected_in_past', 'The expected day cannot be in the past.', 'expectedBy');
		const lines = await this.lines(supplier.id, write, null);
		const settings = await this.support.settings();
		const fiscalYear = fiscalYearOf(today);
		// P7: an order gets its number when it is made, so it can be quoted from the first call.
		const number = formatDocumentNumber(
			settings.numberFormats.purchaseOrder,
			fiscalYear,
			await this.numbers.next('PO', fiscalYear),
		);
		const now = new Date().toISOString();
		const order: PurchaseOrder = {
			id: `po_${randomUUID()}`,
			number,
			status: 'draft',
			supplierId: supplier.id,
			supplierName: supplier.legalName,
			expectedBy: write.expectedBy,
			deliverTo: write.deliverTo,
			noteToSupplier: write.noteToSupplier,
			internalNote: write.internalNote,
			lines,
			...this.estimate(lines, supplier.taxType !== 'none'),
			sentAt: null,
			sentVia: null,
			sentBy: null,
			shopSnapshot: null,
			closedAt: null,
			closedReason: null,
			linkedEntryIds: [],
			late: false,
			createdBy: actor,
			createdAt: now,
			updatedAt: now,
			updatedBy: actor,
			version: 1,
		};
		await this.orders.save(order, null);
		await this.support.record({
			actor,
			action: 'purchase.order.create',
			entityType: 'purchase_order',
			entityId: order.id,
			text: `${await this.support.nameOf(actor)} made purchase order ${number} for ${supplier.legalName}: ${describeUnits(lines.map((line) => ({ units: line.quantity, soldBy: line.soldBy })))}, ${formatRupees(order.orderedValueINR)} before GST, needed by ${write.expectedBy}.`,
		});
		return order;
	}

	async update(id: string, write: PurchaseOrderWrite, actor: string | null): Promise<PurchaseOrder> {
		const order = await this.load(id);
		if (order.status !== 'draft')
			throw refuse(
				'wrong_status',
				'Only a draft order can change. A sent order is closed short or cancelled instead.',
			);
		if (write.supplierId !== order.supplierId)
			throw refuse(
				'supplier_fixed',
				'An order keeps its supplier: copy it as a new draft instead.',
				'supplierId',
			);
		const supplier = await this.suppliers.findById(order.supplierId);
		const lines = await this.lines(order.supplierId, write, order);
		const next: PurchaseOrder = {
			...order,
			expectedBy: write.expectedBy,
			deliverTo: write.deliverTo,
			noteToSupplier: write.noteToSupplier,
			internalNote: write.internalNote,
			lines,
			...this.estimate(lines, supplier?.taxType !== 'none'),
			updatedAt: new Date().toISOString(),
			updatedBy: actor,
		};
		const version = await this.support.guardStale(() => this.orders.save(next, write.version ?? order.version));
		return { ...next, version };
	}

	async remove(id: string, actor: string | null): Promise<void> {
		const order = await this.load(id);
		if (order.status !== 'draft') throw refuse('wrong_status', 'Only a draft order can be deleted.');
		await this.orders.remove(id);
		await this.support.record({
			actor,
			action: 'purchase.order.delete',
			entityType: 'purchase_order',
			entityId: id,
			text: `${await this.support.nameOf(actor)} deleted draft order ${order.number} for ${order.supplierName}.`,
		});
	}

	/** po01 "Copy as new draft": the same supplier and lines, a new number and date. */
	async copy(id: string, actor: string | null): Promise<PurchaseOrder> {
		const order = await this.load(id);
		const today = this.support.today();
		const days = Math.max(
			1,
			Math.round((Date.parse(order.expectedBy) - Date.parse(order.createdAt.slice(0, 10))) / 86_400_000),
		);
		const expected = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
		return this.create(
			{
				supplierId: order.supplierId,
				expectedBy: expected,
				deliverTo: order.deliverTo,
				noteToSupplier: order.noteToSupplier,
				internalNote: order.internalNote,
				lines: order.lines.map((line) => ({
					variantId: line.variantId,
					quantity: line.quantity,
					agreedPriceINR: line.agreedPriceINR,
					gstRatePct: line.gstRatePct,
					supplierItemCode: line.supplierItemCode,
					// A copy is a new order: backorders stay with the order that covers them.
					backorderLineIds: [],
				})),
			},
			actor,
		);
	}

	/** po04 "Receive goods": a purchase entry filled with what is still to come (po04b). */
	async receiveDraft(id: string): Promise<PurchaseEntryWrite> {
		const order = await this.load(id);
		if (order.status !== 'sent' && order.status !== 'part_received') {
			throw refuse('order_not_open', `${order.number} is not waiting for goods.`);
		}
		const today = this.support.today();
		return {
			supplierId: order.supplierId,
			purchaseOrderId: order.id,
			billNumber: '',
			billDate: today,
			goodsReceivedOn: today,
			pricesIncludeGst: false,
			freightINR: 0,
			freightGstRatePct: 0,
			roundOffINR: 0,
			printedTotalINR: null,
			billAttachmentAssetId: null,
			lines: order.lines
				.filter((line) => line.quantity > line.receivedQuantity)
				.map((line) => ({
					variantId: line.variantId,
					quantity: line.quantity - line.receivedQuantity,
					unitPriceINR: line.agreedPriceINR,
					freeOnBill: false,
					hsnOnBill: null,
					gstRatePct: line.gstRatePct,
					supplierItemCode: line.supplierItemCode,
					purchaseOrderLineId: line.lineId,
				})),
		};
	}

	/** po04: the supplier cannot send the rest; the order ends with what arrived. */
	async closeShort(id: string, reason: string, actor: string | null): Promise<PurchaseOrder> {
		const order = await this.load(id);
		if (order.status !== 'sent' && order.status !== 'part_received') {
			throw refuse('wrong_status', 'Only an order waiting for goods can be closed short.');
		}
		const short = order.lines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.receivedQuantity), 0);
		const now = new Date().toISOString();
		const next: PurchaseOrder = {
			...order,
			status: 'closed_short',
			closedAt: now,
			closedReason: reason,
			updatedAt: now,
			updatedBy: actor,
		};
		const version = await this.support.guardStale(() => this.orders.save(next, order.version));
		await this.support.record({
			actor,
			action: 'purchase.order.close_short',
			entityType: 'purchase_order',
			entityId: id,
			text: `${await this.support.nameOf(actor)} closed ${order.number} with ${short} short: "${reason}"`,
		});
		return { ...next, version };
	}

	/** Cancel works only before anything is received; after that, close short (edge cases list). */
	async cancel(id: string, reason: string, actor: string | null): Promise<PurchaseOrder> {
		const order = await this.load(id);
		if (order.lines.some((line) => line.receivedQuantity > 0) || order.linkedEntryIds.length) {
			throw refuse(
				'order_part_received',
				'Goods have arrived against this order: close it with what is short instead.',
			);
		}
		if (order.status === 'cancelled' || order.status === 'closed_short' || order.status === 'received') {
			throw refuse('wrong_status', 'This order is already closed.');
		}
		const now = new Date().toISOString();
		const next: PurchaseOrder = {
			...order,
			status: 'cancelled',
			closedAt: now,
			closedReason: reason,
			updatedAt: now,
			updatedBy: actor,
		};
		const version = await this.support.guardStale(() => this.orders.save(next, order.version));
		await this.support.record({
			actor,
			action: 'purchase.order.cancel',
			entityType: 'purchase_order',
			entityId: id,
			text: `${await this.support.nameOf(actor)} cancelled ${order.number}: "${reason}"`,
		});
		return { ...next, version };
	}

	/** po05: the order as a PDF, from the vendor invoice template. */
	async pdf(id: string): Promise<{ fileName: string; data: Uint8Array }> {
		if (!this.renderer) throw refuse('pdf_unavailable', 'PDFs cannot be made on this server yet.');
		const order = await this.load(id);
		const supplier = await this.suppliers.findById(order.supplierId);
		const request = await this.document.render(order, supplier, await this.support.shopDetails());
		return { fileName: `${order.number.replace(/\//g, '-')}.pdf`, data: await this.renderer.renderPdf(request) };
	}

	/**
	 * po03: email with the PDF through a connected mailbox (replies land in Inbox), or only mark
	 * it sent when staff download the PDF and send it another way. Either way it is Sent.
	 */
	async send(id: string, body: PurchaseOrderSend, actor: string | null): Promise<PurchaseOrder> {
		const order = await this.load(id);
		if (order.status !== 'draft' && order.status !== 'sent') {
			throw refuse('wrong_status', 'Goods have arrived or the order is closed: it cannot be sent again.');
		}
		if (order.lines.length === 0) throw refuse('no_lines', 'Add at least one line before sending.');
		// The shop details this order goes out with: its PDF prints them from now on (R3-1).
		// A re-send keeps the first copy, so the supplier never gets two different letterheads.
		if (!order.shopSnapshot) {
			const brand = await this.document.brandFacts();
			order.shopSnapshot = shopOnDocument(await this.support.shopDetails(), brand.shopName);
		}
		if (body.via === 'email') {
			if (!this.inbox) throw refuse('mailbox_unavailable', 'Mailboxes are not set up on this server.');
			if (!body.mailboxId || !body.from)
				throw refuse('mailbox_required', 'Pick the mailbox to send from.', 'mailboxId');
			if (body.to.length === 0) throw refuse('recipient_required', "Add the supplier's email address.", 'to');
			if (!actor) throw refuse('mailbox_required', 'Sign in again to send mail.');
			const file = await this.pdf(id);
			await this.inbox.send(actor, body.mailboxId, {
				from: body.from,
				to: body.to,
				cc: [],
				bcc: [],
				sendAnyway: false,
				subject: body.subject || `Purchase order ${order.number}`,
				body: body.message,
				attachments: [
					{
						filename: file.fileName,
						mimeType: 'application/pdf',
						data: Buffer.from(file.data).toString('base64'),
					},
				],
			});
		}
		const now = new Date().toISOString();
		const next: PurchaseOrder = {
			...order,
			status: purchaseOrderStatusOf({
				current: order.status === 'draft' ? 'sent' : order.status,
				lines: order.lines,
			}),
			sentAt: now,
			sentVia: body.via,
			sentBy: actor,
			updatedAt: now,
			updatedBy: actor,
		};
		const version = await this.support.guardStale(() => this.orders.save(next, order.version));
		await this.support.record({
			actor,
			action: 'purchase.order.send',
			entityType: 'purchase_order',
			entityId: id,
			text:
				body.via === 'email'
					? `${await this.support.nameOf(actor)} emailed ${order.number} to ${order.supplierName} (${body.to.join(', ')}) from ${body.from} with the PDF.`
					: `${await this.support.nameOf(actor)} marked ${order.number} sent to ${order.supplierName} (PDF downloaded to send another way).`,
		});
		return { ...next, version };
	}

	async activity(id: string) {
		await this.load(id);
		return this.support.activity('purchase_order', [id]);
	}

	/** Where goods go when nothing else is set: the first active store in Settings › Stores. */
	private async firstStore(): Promise<string> {
		const stores = (await this.stores?.list().catch(() => [])) ?? [];
		const store = stores.filter((row) => row.active).sort((a, b) => a.displayOrder - b.displayOrder)[0];
		if (!store)
			throw refuse(
				'deliver_to_required',
				'Set where goods are delivered (Settings › Purchases and stock) first.',
			);
		return [store.name['en'], store.address['en']].filter(Boolean).join(' · ');
	}

	/** Draft orders from the reorder list, one per supplier (i07). */
	async draftsFromReorder(
		groups: ReadonlyArray<{ supplierId: string; lines: PurchaseOrderWrite['lines'] }>,
		actor: string | null,
	): Promise<PurchaseOrder[]> {
		const settings = await this.support.settings();
		const today = this.support.today();
		const expected = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
		const made: PurchaseOrder[] = [];
		for (const group of groups) {
			made.push(
				await this.create(
					{
						supplierId: group.supplierId,
						expectedBy: expected,
						deliverTo: settings.defaultDeliverTo || (await this.firstStore()),
						noteToSupplier: null,
						internalNote: 'Made from the reorder list.',
						lines: group.lines,
					},
					actor,
				),
			);
		}
		return made;
	}
}
