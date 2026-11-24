import type { FixedAsset, RecurringEntry } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Fixed assets (accounts brief R1–R4). */
export interface FixedAssetRepository {
	list(): Promise<FixedAsset[]>;
	get(id: string): Promise<FixedAsset | null>;
	/** How many assets were ever added (the next tag is one more). */
	count(): Promise<number>;
	/** Refused with `fixed_asset_tag_taken` when another asset has the tag. */
	insert(asset: FixedAsset, context?: TransactionContext): Promise<void>;
	/** Refused with `fixed_asset_changed` when someone saved since `expectedVersion`; stored one higher. */
	save(asset: FixedAsset, expectedVersion: number, context?: TransactionContext): Promise<FixedAsset>;
}

/** Rent and recurring entries (accounts brief R5). */
export interface RecurringEntryRepository {
	list(): Promise<RecurringEntry[]>;
	get(id: string): Promise<RecurringEntry | null>;
	insert(entry: RecurringEntry): Promise<void>;
	/** Refused with `recurring_entry_changed` when someone saved since `expectedVersion`; stored one higher. */
	save(entry: RecurringEntry, expectedVersion: number): Promise<RecurringEntry>;
	remove(id: string): Promise<boolean>;
}
