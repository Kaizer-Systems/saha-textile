import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
	InventorySettings,
	PurchaseEntry,
	PurchaseEntryLine,
	PurchaseEntryWrite,
	PurchaseOrder,
	PurchaseWarning,
	Supplier,
} from '@saha-textile/contracts';
import {
	type EntryMathResult,
	type PurchaseEntryRepository,
	type PurchaseOrderRepository,
	type StockItemFacts,
	type StockReadRepository,
	type SupplierRepository,
	booksClosedProblem,
	computePurchaseEntry,
	entryDateWarnings,
	entryDueOn,
	formatQuantity,
} from '@saha-textile/core-domain';

import {
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_ORDER_REPOSITORY,
	STOCK_READ_REPOSITORY,
	SUPPLIER_REPOSITORY,
} from '../infra/tokens';
import { blockedReason } from './purchase-items.service';
import { PurchasingSupport, missing, refuse } from './purchasing-support';

export interface BuiltEntry {
	entry: PurchaseEntry;
	math: EntryMathResult;
	facts: Map<string, StockItemFacts>;
	supplier: Supplier;
	order: PurchaseOrder | null;
	settings: InventorySettings;
}

/** A warning's identity: posting compares the ones shown with the ones accepted. */
export const warningKey = (warning: Pick<PurchaseWarning, 'code' | 'lineId'>): string =>
	`${warning.code}:${warning.lineId ?? ''}`;

/**
 * Turns what the form sends into a whole purchase entry: the supplier's tax, every line's GST,
 * freight share, cost into stock and margin, the bill total check and every warning (p02–p07).
 * Nothing here writes; the service decides what to save.
 */
@Injectable()
export class PurchaseEntryBuilder {
	constructor(
		@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
		@Inject(PURCHASE_ORDER_REPOSITORY) private readonly orders: PurchaseOrderRepository,
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		private readonly support: PurchasingSupport,
	) {}

	async build(write: PurchaseEntryWrite, existing: PurchaseEntry | null, actor: string | null): Promise<BuiltEntry> {
		const [supplier, settings] = await Promise.all([
			this.suppliers.findById(write.supplierId),
			this.support.settings(),
		]);
		if (!supplier) throw missing('Supplier');
		if (!supplier.active && existing?.supplierId !== supplier.id) {
			throw refuse(
				'supplier_inactive',
				`${supplier.legalName} is inactive. Make it active to enter new bills.`,
				'supplierId',
			);
		}
		const today = this.support.today();
		const closed = booksClosedProblem([write.billDate, write.goodsReceivedOn], settings.booksClosedUpTo);
		if (closed) throw refuse(closed.code, closed.detail, 'billDate');
		if (write.goodsReceivedOn > today) {
			throw refuse('received_in_future', 'Goods cannot be received on a day still to come.', 'goodsReceivedOn');
		}

		const order = write.purchaseOrderId ? await this.orders.findById(write.purchaseOrderId) : null;
		if (write.purchaseOrderId && !order) throw missing('Purchase order');
		if (order) {
			if (order.supplierId !== supplier.id) {
				throw refuse(
					'order_other_supplier',
					`${order.number} is for ${order.supplierName}.`,
					'purchaseOrderId',
				);
			}
			const keepsLink = existing?.purchaseOrderId === order.id;
			if (!keepsLink && order.status !== 'sent' && order.status !== 'part_received') {
				throw refuse('order_not_open', `${order.number} is not waiting for goods.`, 'purchaseOrderId');
			}
		}

		const variantIds = [...new Set(write.lines.map((line) => line.variantId))];
		const [facts, last] = await Promise.all([
			this.stock.items(variantIds),
			this.entries.lastPurchases(variantIds, existing?.id ?? null),
		]);
		write.lines.forEach((line, index) => {
			const fact = facts.get(line.variantId);
			if (!fact) throw refuse('unknown_item', `Line ${index + 1}: this item no longer exists.`, String(index));
			const blocked = blockedReason(fact);
			if (blocked === 'bundle') {
				throw refuse(
					'blocked_product',
					`${fact.sku} is a bundle: bundles have no stock of their own; enter their contents.`,
					String(index),
				);
			}
			if (blocked === 'discontinued') {
				throw refuse('blocked_product', `${fact.sku} is discontinued and cannot take stock.`, String(index));
			}
			if (!fact.tracked) {
				throw refuse(
					'untracked_item',
					`${fact.sku} does not keep stock, so it cannot be bought in.`,
					String(index),
				);
			}
		});

		// Purchase order lines (po04b): a line names its order line, or matches one by item.
		const orderLines = new Map((order?.lines ?? []).map((line) => [line.lineId, line]));
		const previousLines = new Map((existing?.lines ?? []).map((line) => [line.lineId, line]));
		const prepared = write.lines.map((line) => {
			let orderLine = line.purchaseOrderLineId ? (orderLines.get(line.purchaseOrderLineId) ?? null) : null;
			if (line.purchaseOrderLineId && (!orderLine || orderLine.variantId !== line.variantId)) {
				throw refuse('order_line_mismatch', 'That line is not on the purchase order.', line.lineId ?? null);
			}
			if (!orderLine && order)
				orderLine = order.lines.find((candidate) => candidate.variantId === line.variantId) ?? null;
			const lineId = line.lineId && previousLines.has(line.lineId) ? line.lineId : `pel_${randomUUID()}`;
			return { write: line, lineId, orderLine };
		});

		const math = computePurchaseEntry({
			taxType: supplier.taxType,
			pricesIncludeGst: write.pricesIncludeGst,
			freightINR: write.freightINR,
			freightGstRatePct: write.freightGstRatePct,
			roundOffINR: write.roundOffINR,
			printedTotalINR: write.printedTotalINR,
			itcClaimable: supplier.kind === 'regular',
			priceChangeWarnPct: settings.priceChangeWarnPct,
			marginFloorPct: settings.marginFloorPct,
			lines: prepared.map(({ write: line, lineId, orderLine }) => {
				const fact = facts.get(line.variantId) as StockItemFacts;
				return {
					lineId,
					soldBy: fact.soldBy,
					quantity: line.quantity,
					unitPriceINR: line.unitPriceINR,
					freeOnBill: line.freeOnBill,
					gstRatePct: supplier.taxType === 'none' ? 0 : line.gstRatePct,
					sellingPriceINR: fact.sellingPriceINR,
					lastPriceINR: last.get(line.variantId)?.unitPriceExGstINR ?? null,
					hsnOnBill: line.hsnOnBill,
					productHsn: fact.hsnCode,
					disabled: fact.productStatus === 'disabled',
					notOrdered: Boolean(order) && !orderLine,
				};
			}),
		});

		const warnings: PurchaseWarning[] = math.warnings.map((warning) => ({ ...warning }));
		// More received than ordered: allowed, and the extra reads as "not ordered" (edge cases list).
		const takenFromOrderLine = new Map<string, number>();
		for (const { write: line, lineId, orderLine } of prepared) {
			if (!orderLine) continue;
			const taken = (takenFromOrderLine.get(orderLine.lineId) ?? 0) + line.quantity;
			takenFromOrderLine.set(orderLine.lineId, taken);
			const stillToCome = Math.max(0, orderLine.quantity - orderLine.receivedQuantity);
			if (taken > stillToCome) {
				const fact = facts.get(line.variantId) as StockItemFacts;
				warnings.push({
					code: 'not_ordered',
					lineId,
					detail: `${formatQuantity(taken - stillToCome, fact.soldBy)} more than the order still expects.`,
					values: { extra: taken - stillToCome },
				});
			}
		}
		for (const warning of entryDateWarnings({
			billDate: write.billDate,
			goodsReceivedOn: write.goodsReceivedOn,
			today,
		})) {
			warnings.push({ code: warning.code, lineId: null, detail: warning.detail, values: {} });
		}
		const lookalike = await this.entries.findLookalike(
			supplier.id,
			write.billDate,
			math.totals.totalINR,
			existing?.id ?? null,
		);
		if (lookalike && lookalike.billNumber !== write.billNumber) {
			warnings.push({
				code: 'lookalike_bill',
				lineId: null,
				detail: `${supplier.legalName} has another bill of the same total on the same day: ${lookalike.billNumber}${lookalike.number ? ` (${lookalike.number})` : ''}.`,
				values: { entryId: lookalike.id, billNumber: lookalike.billNumber },
			});
		}

		const images = await this.support.thumbnails([...facts.values()].map((fact) => fact.galleryAssetId));
		const lines: PurchaseEntryLine[] = prepared.map(({ write: line, lineId, orderLine }, index) => {
			const fact = facts.get(line.variantId) as StockItemFacts;
			const lineMath = math.lines[index];
			const before = previousLines.get(lineId);
			// The goods check stands only while the line still says the same item and quantity.
			const checkStands = before && before.variantId === line.variantId && before.quantity === line.quantity;
			return {
				lineId,
				productId: fact.productId,
				variantId: fact.variantId,
				sku: fact.sku,
				title: fact.title['en'] ?? fact.sku,
				optionsLabel: fact.optionsLabel,
				soldBy: fact.soldBy,
				imageUrl: fact.galleryAssetId ? (images.get(fact.galleryAssetId) ?? null) : null,
				supplierItemCode: line.supplierItemCode,
				hsnOnBill: line.hsnOnBill,
				productHsn: fact.hsnCode,
				gstRatePct: supplier.taxType === 'none' ? 0 : line.gstRatePct,
				quantity: line.quantity,
				unitPriceINR: line.unitPriceINR,
				freeOnBill: line.freeOnBill,
				purchaseOrderLineId: orderLine?.lineId ?? null,
				notOrdered: Boolean(order) && !orderLine,
				accepted: checkStands ? before.accepted : null,
				damaged: checkStands ? before.damaged : 0,
				missing: checkStands ? before.missing : 0,
				damageReason: checkStands ? before.damageReason : null,
				damageNote: checkStands ? before.damageNote : null,
				damagePhotoAssetIds: checkStands ? before.damagePhotoAssetIds : [],
				taxableINR: lineMath?.taxableINR ?? 0,
				taxINR: lineMath?.taxINR ?? 0,
				lineTotalINR: lineMath?.lineTotalINR ?? 0,
				freightShareINR: lineMath?.freightShareINR ?? 0,
				unitCostINR: lineMath?.unitCostINR ?? 0,
				sellingPriceINR: fact.sellingPriceINR,
				marginPct: lineMath?.marginPct ?? null,
				lastCostINR: last.get(line.variantId)?.unitPriceExGstINR ?? null,
				costLayerId: null,
			};
		});

		const now = new Date().toISOString();
		const entry: PurchaseEntry = {
			id: existing?.id ?? `pe_${randomUUID()}`,
			number: null,
			status: existing?.status ?? 'draft',
			paymentStatus: 'unpaid',
			supplierId: supplier.id,
			supplierName: supplier.legalName,
			supplierGstin: supplier.gstin,
			supplierStateCode: supplier.stateCode,
			supplierKind: supplier.kind,
			taxType: supplier.taxType,
			purchaseOrderId: order?.id ?? null,
			purchaseOrderNumber: order?.number ?? null,
			billNumber: write.billNumber,
			billDate: write.billDate,
			goodsReceivedOn: write.goodsReceivedOn,
			pricesIncludeGst: write.pricesIncludeGst,
			freightINR: write.freightINR,
			freightGstRatePct: supplier.taxType === 'none' ? 0 : write.freightGstRatePct,
			roundOffINR: write.roundOffINR,
			billAttachment: await this.support.attachment(write.billAttachmentAssetId),
			lines,
			totals: math.totals,
			warnings,
			acceptedWarnings: [],
			itcClaimable: supplier.kind === 'regular',
			dueOn: entryDueOn(write.billDate, supplier.paymentTermsDays),
			paidINR: 0,
			creditedINR: 0,
			createdBy: existing?.createdBy ?? actor,
			checkedBy: existing?.checkedBy ?? null,
			checkedAt: existing?.checkedAt ?? null,
			postedBy: null,
			postedAt: null,
			voidedBy: null,
			voidedAt: null,
			voidReason: null,
			returnDraftIds: [],
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			updatedBy: actor,
			version: existing?.version ?? 1,
		};
		return { entry, math, facts, supplier, order, settings };
	}

	/** The write that rebuilds an entry as it stands (posting re-checks prices and warnings). */
	static writeOf(entry: PurchaseEntry): PurchaseEntryWrite {
		return {
			supplierId: entry.supplierId,
			purchaseOrderId: entry.purchaseOrderId,
			billNumber: entry.billNumber,
			billDate: entry.billDate,
			goodsReceivedOn: entry.goodsReceivedOn,
			pricesIncludeGst: entry.pricesIncludeGst,
			freightINR: entry.freightINR,
			freightGstRatePct: entry.freightGstRatePct,
			roundOffINR: entry.roundOffINR,
			printedTotalINR: entry.totals.printedTotalINR,
			billAttachmentAssetId: entry.billAttachment?.assetId ?? null,
			lines: entry.lines.map((line) => ({
				lineId: line.lineId,
				variantId: line.variantId,
				quantity: line.quantity,
				unitPriceINR: line.unitPriceINR,
				freeOnBill: line.freeOnBill,
				hsnOnBill: line.hsnOnBill,
				gstRatePct: line.gstRatePct,
				supplierItemCode: line.supplierItemCode,
				purchaseOrderLineId: line.purchaseOrderLineId,
			})),
			version: entry.version,
		};
	}
}
