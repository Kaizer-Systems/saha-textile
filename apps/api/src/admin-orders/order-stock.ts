import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import type { Order, OrderLine } from '@saha-textile/contracts';
import {
	StockMovementRefusedError,
	type InventoryCostLayerRepository,
	type ProductVariantRepository,
	type StockMovementPort,
	type TransactionContext,
} from '@saha-textile/core-domain';

import { codedRefusal } from '../common/coded-refusal';
import type { BundleStockService } from '../catalog/bundles/bundle-stock.service';
import {
	BUNDLE_STOCK,
	INVENTORY_COST_LAYER_REPOSITORY,
	PRODUCT_VARIANT_REPOSITORY,
	STOCK_MOVEMENT,
} from '../infra/tokens';

type Move = 'reserve' | 'release' | 'sell';

const SOURCE: Record<Move, string> = {
	reserve: 'reservation',
	release: 'reservation_released',
	sell: 'order_placed',
};

/**
 * An order's pieces in stock (`DEC-STOCK-RESERVE`; K7, owner 2026-11-20: an admin order holds its
 * pieces from the moment it is saved, paid or not, until a line is removed or the order cancelled).
 * Kept pieces leave free-to-sell at once, so a one-of-a-kind saree can't sell in the shop meanwhile;
 * at Shipped they leave on-hand, drawn from the oldest cost layers. Made-to-order lines have no stock
 * to keep. Every move is a stock ledger row with the order number, inside the caller's transaction.
 */
@Injectable()
export class OrderStock {
	constructor(
		@Inject(STOCK_MOVEMENT) private readonly stock: StockMovementPort,
		@Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepository,
		@Inject(INVENTORY_COST_LAYER_REPOSITORY) private readonly layers: InventoryCostLayerRepository,
		@Optional() @Inject(BUNDLE_STOCK) private readonly bundleStock: BundleStockService | null = null,
	) {}

	reserve(
		order: Order,
		lines: readonly OrderLine[],
		actorId: string | null,
		context: TransactionContext,
		at: string,
	) {
		return this.move('reserve', order, lines, actorId, context, at);
	}

	release(
		order: Order,
		lines: readonly OrderLine[],
		actorId: string | null,
		context: TransactionContext,
		at: string,
	) {
		return this.move('release', order, lines, actorId, context, at);
	}

	/** Shipped: kept pieces leave on-hand; returns each line's cost from the layers it drew on. */
	async sell(
		order: Order,
		lines: readonly OrderLine[],
		actorId: string | null,
		context: TransactionContext,
		at: string,
	) {
		await this.move('sell', order, lines, actorId, context, at);
		const costs = new Map<string, number>();
		for (const line of lines) {
			if (!line.held || line.madeToOrder || line.role === 'bundle') continue;
			const variantId = await this.variantIdOf(line);
			const drawn = await this.layers
				.consumeFifo({ variantId, quantity: line.quantity }, context)
				.catch((error: unknown) => {
					// Fewer costed pieces than are shipping: the purchases module refuses rather than cost them at ₹0.
					if (error instanceof Error && error.message.startsWith('insufficient FIFO cost layers')) {
						throw new ConflictException(
							codedRefusal(
								'cost_layers_missing',
								`${line.sku} has stock with no recorded cost`,
								'lines',
								{
									sku: line.sku,
								},
							),
						);
					}
					throw error;
				});
			const units = drawn.reduce((sum, row) => sum + row.quantity, 0);
			if (units > 0 && line.lineId) {
				const value = drawn.reduce((sum, row) => sum + row.quantity * row.unitCostINR, 0);
				costs.set(line.lineId, Math.round((value / units) * 100) / 100);
			}
		}
		return costs;
	}

	/**
	 * The lines whose pieces are no longer free to sell (a late payment, OD1). Read-only; quantities of
	 * the same variant on several lines are added up. Untracked stock and made-to-order lines are free.
	 */
	async unavailableLines(order: Order): Promise<string[]> {
		const wanted = new Map<string, { quantity: number; lineIds: string[] }>();
		for (const line of order.lines) {
			if (line.madeToOrder || line.role === 'bundle') continue;
			const variantId = await this.variantIdOf(line);
			const entry = wanted.get(variantId) ?? { quantity: 0, lineIds: [] };
			entry.quantity += line.quantity;
			entry.lineIds.push(line.lineId ?? line.sku);
			wanted.set(variantId, entry);
		}
		const out: string[] = [];
		for (const [variantId, entry] of wanted) {
			const variant = await this.variants.findById(variantId, 'admin');
			const stock = variant?.stock;
			if (!stock) {
				out.push(...entry.lineIds);
				continue;
			}
			if (!stock.tracked) continue;
			const free = stock.quantity - stock.held - (stock.reserved ?? 0);
			if (free < entry.quantity) out.push(...entry.lineIds);
		}
		return out;
	}

	private async move(
		kind: Move,
		order: Order,
		lines: readonly OrderLine[],
		actorId: string | null,
		context: TransactionContext,
		at: string,
	): Promise<void> {
		// Bundles holding these pieces work out their stock again once the order's transaction has settled (V3).
		if (this.bundleStock && lines.length) {
			const ids = lines.map((line) => line.productId);
			setTimeout(() => void this.bundleStock?.refreshContaining(ids), 1500).unref();
		}
		for (const line of lines) {
			// A set's own line has no stock: its pieces, free items and extras are held one by one (brief E08).
			if (line.madeToOrder || line.role === 'bundle') continue;
			// Only pieces this order actually keeps are released or sold.
			if (kind !== 'reserve' && !line.held) continue;
			const variantId = await this.variantIdOf(line);
			const delta = kind === 'reserve' ? line.quantity : -line.quantity;
			try {
				await this.stock.move(
					{
						variantId,
						productId: line.productId,
						quantityDelta: kind === 'sell' ? -line.quantity : 0,
						heldDelta: 0,
						reservedDelta: delta,
						source: SOURCE[kind],
						reasonCode: null,
						note: `Order ${order.orderNumber}`,
						referenceType: 'order',
						referenceId: order.id,
						referenceNumber: order.orderNumber,
						actorUserId: actorId,
						approverUserId: null,
						at,
					},
					context,
				);
			} catch (error) {
				if (error instanceof StockMovementRefusedError) {
					throw new ConflictException(
						codedRefusal('out_of_stock', `Not enough free stock for ${line.sku}`, 'lines', {
							sku: line.sku,
						}),
					);
				}
				throw error;
			}
		}
	}

	private async variantIdOf(line: OrderLine): Promise<string> {
		if (line.variationId) return line.variationId;
		const rows = await this.variants.listForProduct(line.productId, 'admin');
		const base = rows.find((row) => row.isBaseVariant) ?? rows[0];
		if (!base) {
			throw new ConflictException(codedRefusal('variant_missing', `No stock record for ${line.sku}`, 'lines'));
		}
		return base.id;
	}
}
