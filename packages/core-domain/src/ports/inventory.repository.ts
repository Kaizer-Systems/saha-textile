import type { InventoryCostLayer, InventoryLedgerEntry, VariantStockSnapshot } from '@saha-textile/contracts';

import type { PageQuery, Paginated } from './pagination';
import type { TransactionContext } from './transaction-manager.port';

export interface InventoryLedgerFilter extends PageQuery {
	variantId?: string;
	productId?: string;
	source?: InventoryLedgerEntry['source'];
	from?: string;
	to?: string;
}

/**
 * Stock ledger and balances.
 *
 * Every write takes an optional `TransactionContext` because stock never moves alone —
 * placing an order writes the order, decrements stock, and appends a ledger row in ONE
 * transaction. The ledger is append-only: a mistake is corrected with a compensating
 * row, never an edit, which is why there is no `update`.
 *
 * `applyDelta` is deliberately a single atomic call rather than read-then-write: two
 * concurrent checkouts must not both read the same balance and each write it back.
 */
export interface InventoryRepository {
	getSnapshot(variantId: string): Promise<VariantStockSnapshot | null>;
	getSnapshots(variantIds: readonly string[]): Promise<VariantStockSnapshot[]>;
	/**
	 * Atomically moves stock and appends the ledger row, returning the new balance.
	 * Rejects rather than silently clamping when the move is not permitted.
	 */
	applyDelta(
		entry: Omit<InventoryLedgerEntry, 'id' | 'balanceAfter'>,
		context?: TransactionContext,
	): Promise<InventoryLedgerEntry>;
	listLedger(filter: InventoryLedgerFilter): Promise<Paginated<InventoryLedgerEntry>>;
}

/**
 * FIFO cost layers (`inventoryCostLayers`).
 *
 * Layers are consumed oldest-first; `consumeFifo` returns the layers actually drawn from
 * so COGS can be computed and audited. Admin/reporting only — FIFO/COGS detail is never
 * customer-facing (owner lock), so no public DTO may be derived from these shapes.
 */
export interface InventoryCostLayerRepository {
	listOpenLayers(variantId: string): Promise<InventoryCostLayer[]>;
	createLayer(layer: InventoryCostLayer, context?: TransactionContext): Promise<InventoryCostLayer>;
	/** Draws `quantity` oldest-first, returning each layer consumed and how much came from it. */
	consumeFifo(
		input: { variantId: string; quantity: number },
		context?: TransactionContext,
	): Promise<Array<{ layerId: string; quantity: number; unitCostINR: number }>>;
	/** Reverses a consumption (cancellation, restocked return) back onto its layers. */
	releaseFifo(
		input: { variantId: string; allocations: Array<{ layerId: string; quantity: number }> },
		context?: TransactionContext,
	): Promise<void>;
}
