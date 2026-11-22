import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { InventoryReasonCode } from '@saha-textile/contracts';
import {
	type InventoryCostLayerRepository,
	type SearchOutboxRepository,
	type StockHoldRecord,
	type StockHoldRepository,
	type StockItemFacts,
	type StockMovementPort,
	type StockReadRepository,
	type TransactionContext,
	fifoDraw,
} from '@saha-textile/core-domain';

import {
	INVENTORY_COST_LAYER_REPOSITORY,
	BUNDLE_STOCK,
	SEARCH_OUTBOX,
	STOCK_HOLD_REPOSITORY,
	STOCK_MOVEMENT,
	STOCK_READ_REPOSITORY,
} from '../infra/tokens';
import { missing } from './purchasing-support';
import type { BundleStockService } from '../catalog/bundles/bundle-stock.service';

export interface StockChange {
	variantId: string;
	action: 'remove' | 'add' | 'hold' | 'release';
	quantity: number;
	reasonCode: InventoryReasonCode | null;
	holdReason: StockHoldRecord['reason'] | null;
	holdId: string | null;
	note: string;
	/** The adjustment request or count this change belongs to (the ledger links to it). */
	referenceType: 'stock_adjustment' | 'stock_count';
	referenceId: string;
	referenceNumber: string | null;
	actor: string | null;
	approver: string | null;
	/** A count correction is its own movement source; everything else is a manual adjustment. */
	source: 'manual_adjustment' | 'stock_count';
}

export interface StockChangeResult {
	onHandBefore: number;
	heldBefore: number;
	onHandAfter: number;
	heldAfter: number;
	valueINR: number;
	breakdown: string;
	holdId: string | null;
}

/**
 * Applies one stock change inside a transaction: the guarded movement, the cost layers it draws
 * (write-offs come out oldest-first, FIFO) or adds (found pieces at the latest known cost), and
 * the hold it opens, shrinks or closes. Callers decide whether the change may happen (approval,
 * refusals); this only makes it happen, all or nothing.
 */
@Injectable()
export class StockWriter {
	constructor(
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		@Inject(STOCK_MOVEMENT) private readonly movement: StockMovementPort,
		@Inject(INVENTORY_COST_LAYER_REPOSITORY) private readonly layers: InventoryCostLayerRepository,
		@Inject(STOCK_HOLD_REPOSITORY) private readonly holds: StockHoldRepository,
		@Optional() @Inject(SEARCH_OUTBOX) private readonly searchOutbox: SearchOutboxRepository | null = null,
		@Optional() @Inject(BUNDLE_STOCK) private readonly bundleStock: BundleStockService | null = null,
	) {}

	async facts(variantId: string): Promise<StockItemFacts> {
		const fact = (await this.stock.items([variantId])).get(variantId);
		if (!fact) throw missing('Item');
		return fact;
	}

	holdById(id: string) {
		return this.holds.findById(id);
	}

	/** The value of `quantity` units at cost and the sentence for it ("1 at ₹8,600 + 1 at ₹9,295.61"). */
	async valueOf(fact: StockItemFacts, quantity: number) {
		const open = await this.stock.openLayers([fact.variantId]);
		return fifoDraw(open, quantity, fact.soldBy);
	}

	async apply(change: StockChange, context: TransactionContext): Promise<StockChangeResult> {
		const fact = await this.facts(change.variantId);
		const at = new Date().toISOString();
		let quantityDelta = 0;
		let heldDelta = 0;
		let holdId: string | null = change.holdId;
		let valueINR = 0;
		let breakdown = '';

		if (change.action === 'remove') {
			quantityDelta = -change.quantity;
			// A held piece written off leaves held and on-hand together.
			if (change.holdId) heldDelta = -change.quantity;
			const draw = await this.valueOf(fact, change.quantity);
			for (const part of draw.parts) await this.movement.consumeLayer(part.layerId, part.quantity, context);
			valueINR = draw.valueINR;
			breakdown = draw.breakdown;
		} else if (change.action === 'add') {
			quantityDelta = change.quantity;
			// Found pieces carry the latest cost we know for the item, so stock value stays honest.
			const known = await this.stock.layersOf(change.variantId);
			const latest = [...known].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
			const unitCostINR = latest?.unitCostINR ?? 0;
			await this.layers.createLayer(
				{
					id: `lay_${randomUUID()}`,
					variantId: change.variantId,
					purchaseInvoiceId: null,
					sourceType: 'manual_adjustment',
					sourceLineId: null,
					sourceNumber: change.referenceNumber,
					unitCostINR,
					quantityReceived: change.quantity,
					quantityRemaining: change.quantity,
					receivedAt: at,
				},
				context,
			);
			valueINR = Math.round(change.quantity * unitCostINR * 100) / 100;
		} else if (change.action === 'hold') {
			heldDelta = change.quantity;
		} else {
			heldDelta = -change.quantity;
		}

		const moved = await this.movement.move(
			{
				variantId: change.variantId,
				productId: fact.productId,
				quantityDelta,
				heldDelta,
				source: change.action === 'hold' ? 'hold' : change.action === 'release' ? 'release' : change.source,
				reasonCode: change.action === 'add' || change.action === 'remove' ? change.reasonCode : null,
				note: change.note || null,
				referenceType: change.referenceType,
				referenceId: change.referenceId,
				referenceNumber: change.referenceNumber,
				actorUserId: change.actor,
				approverUserId: change.approver,
				at,
			},
			context,
		);

		if (change.action === 'hold') {
			holdId = `hold_${randomUUID()}`;
			await this.holds.save(
				{
					id: holdId,
					variantId: change.variantId,
					productId: fact.productId,
					quantity: change.quantity,
					reason: change.holdReason ?? 'quality_check',
					note: change.note,
					since: at,
					byId: change.actor,
					status: 'open',
					closedAt: null,
					closedBy: null,
					entryId: null,
				},
				context,
			);
		} else if (change.holdId && (change.action === 'release' || change.action === 'remove')) {
			const hold = await this.holds.findById(change.holdId, context);
			if (!hold) throw missing('Hold');
			const left = hold.quantity - change.quantity;
			await this.holds.save(
				left > 0
					? { ...hold, quantity: left }
					: {
							...hold,
							status: change.action === 'release' ? 'released' : 'written_off',
							closedAt: at,
							closedBy: change.actor,
						},
				context,
			);
		}

		return {
			onHandBefore: moved.onHandAfter - quantityDelta,
			heldBefore: moved.heldAfter - heldDelta,
			onHandAfter: moved.onHandAfter,
			heldAfter: moved.heldAfter,
			valueINR,
			breakdown,
			holdId,
		};
	}

	/** After stock changes, the shop's search entries (in stock, low stock) refresh. */
	async refreshShop(productIds: readonly string[]): Promise<void> {
		await this.searchOutbox?.request([...new Set(productIds)], new Date()).catch(() => undefined);
		// Bundles holding these pieces work out their stock again (V3).
		await this.bundleStock?.refreshContaining(productIds);
	}
}
