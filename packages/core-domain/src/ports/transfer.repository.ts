import type { StockTransfer, TransferChip } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Stock transfers between locations (accounts brief N3–N6). */
export interface TransferRepository {
	insert(transfer: StockTransfer, context?: TransactionContext): Promise<void>;
	get(id: string, context?: TransactionContext): Promise<StockTransfer | null>;
	/** Saves over the version the screen read; a change made meanwhile throws `transfer_changed`. */
	save(transfer: StockTransfer, expectedVersion: number, context?: TransactionContext): Promise<StockTransfer>;
	/** N3: made within the India days from–to, at a location in reach (null: every location). */
	list(query: {
		from: string;
		to: string;
		chip: TransferChip;
		search: string;
		locationIds: readonly string[] | null;
		page: number;
		pageSize: number;
	}): Promise<{ items: StockTransfer[]; total: number; counts: Record<TransferChip, number> }>;
	/** Pieces on the way per variant (N1's In transit). */
	inTransit(variantIds: readonly string[]): Promise<Record<string, number>>;
	/** Transfers still on the way that left in the month (a month's lock lists them). */
	inTransitFrom(month: string): Promise<StockTransfer[]>;
}
