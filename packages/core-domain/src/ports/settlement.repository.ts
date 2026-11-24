import type { Settlement, SettlementKind, SettlementListQuery } from '@saha-textile/contracts';

import type { TransactionContext } from './transaction-manager.port';

/** Gateway payouts and courier COD remittances (accounts brief Q10). */
export interface SettlementRepository {
	insert(settlement: Settlement, context?: TransactionContext): Promise<void>;
	get(id: string): Promise<Settlement | null>;
	list(
		query: SettlementListQuery,
	): Promise<{ items: Settlement[]; total: number; counts: Record<SettlementKind, number> }>;
	/** Which of these payout references of a provider are imported already. */
	payoutReferencesIn(kind: SettlementKind, provider: string, references: readonly string[]): Promise<Set<string>>;
	/** Which of these order payments some payout has paid. */
	settledPaymentIds(paymentIds: readonly string[]): Promise<Set<string>>;
}
