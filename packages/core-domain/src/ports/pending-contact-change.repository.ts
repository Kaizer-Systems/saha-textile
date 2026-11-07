import type { ContactField } from '@saha-textile/contracts';

/**
 * A change of email or phone that has been started but not yet proven.
 *
 * ## Why the value cannot just be written
 *
 * Both are login credentials under `DEC-SIGNUP-VERIFICATION`, and the security matrix requires a
 * change to one to "retain old address until new one is verified". If the customer row moved when
 * the request arrived, a session that had been stolen for five minutes would own the account's
 * recovery channel permanently — and the real owner would find their address no longer signs them
 * in, with no way back. So the new value waits here, and the account keeps working exactly as it
 * did until the code lands.
 *
 * ## What it is not
 *
 * Not a reservation. Holding the new value against everybody else would let one account park
 * addresses in fifteen-minute blocks; uniqueness stays where it belongs, on the `customers`
 * indexes, and is settled at the swap. Two people may hold the same pending value and the loser
 * finds out at confirmation — the same bargain `pendingSignups` makes, for the same reason.
 *
 * Deliberately NOT a Schema Nebula node: machinery with a TTL, not part of the ratified data
 * model. See `RUNTIME_ONLY_COLLECTIONS`.
 */
export interface PendingContactChange {
	id: string;
	/** One live change per account — starting another replaces it rather than racing it. */
	customerId: string;
	field: ContactField;
	/** Normalised on the way in: an email is lowercased, a phone is trimmed. */
	newValue: string;
	/** Sends made for this change, driving both the remaining budget and the resend backoff. */
	sends: number;
	lastSentAt: string | null;
	createdAt: string;
	/** Sliding expiry, extended by each send and capped by `absoluteExpiresAt`. */
	expiresAt: string;
	absoluteExpiresAt: string;
}

export interface PendingContactChangeRepository {
	/**
	 * Creates or REPLACES the pending change for an account.
	 *
	 * Replacing rather than refusing: somebody who mistyped an address and starts again should get
	 * a clean slate, not a refusal naming a change they have already abandoned. It also means an
	 * account can never accumulate two pending changes, so "the pending value" is unambiguous
	 * everywhere else.
	 */
	start(pending: PendingContactChange): Promise<PendingContactChange>;

	findByCustomerId(customerId: string): Promise<PendingContactChange | null>;

	/** Records that a code was dispatched: increments the send count and slides the expiry. */
	recordSend(id: string, sentAt: string, expiresAt: string): Promise<PendingContactChange | null>;

	/**
	 * Single-use consumption at confirmation.
	 *
	 * Returns the record and removes it atomically, so two confirmations cannot both swap from one
	 * proof. Called only after the code has verified — a failed code must leave the change in
	 * flight, or one wrong digit would end the attempt.
	 */
	consume(id: string): Promise<PendingContactChange | null>;

	deleteByCustomerId(customerId: string): Promise<boolean>;
}
