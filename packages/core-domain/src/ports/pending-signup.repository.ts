/**
 * Storage for a signup that has been started but has not yet earned an account
 * (`DEC-SIGNUP-VERIFICATION`).
 *
 * The port exists so the SERVER owns what has been proven. Every method here reads or advances
 * state that the browser may ask about but never assert — which is the property that stops an
 * attacker verifying an address they control, then finalising on one they do not.
 */

export type PendingSignupOrigin = 'password' | 'google' | 'facebook';
export type PendingSignupFieldName = 'email' | 'phone';

export interface PendingSignupField {
	value: string | null;
	verified: boolean;
	/** Google's email only: asserted by the provider, so a form may not overwrite it. */
	locked: boolean;
	sends: number;
	lastSentAt: string | null;
}

export interface PendingSignup {
	id: string;
	sessionKey: string;
	origin: PendingSignupOrigin;
	email: PendingSignupField;
	phone: PendingSignupField;
	displayName: string | null;
	marketingOptIn: boolean;
	guestCartId: string | null;
	provider: 'google' | 'facebook' | null;
	providerSubject: string | null;
	createdAt: string;
	expiresAt: string;
	absoluteExpiresAt: string;
}

export interface PendingSignupRepository {
	/**
	 * Creates or REPLACES the pending signup for a browser session.
	 *
	 * Replacing rather than erroring is deliberate: someone who abandons a form and starts over
	 * should get a clean slate, not a refusal telling them a signup they no longer remember is
	 * still open. Keyed on the session so a second tab continues one signup instead of racing it.
	 */
	start(pending: PendingSignup): Promise<PendingSignup>;

	findBySessionKey(sessionKey: string): Promise<PendingSignup | null>;

	/**
	 * Sets a field's value, clearing its verified flag.
	 *
	 * Clearing is what makes editing safe. Verification is bound to a VALUE, so a changed value
	 * is unverified by construction — the flag merely records what the server already knows.
	 */
	setFieldValue(id: string, field: PendingSignupFieldName, value: string): Promise<PendingSignup | null>;

	/** Records that a code was dispatched: increments the send count and slides the expiry. */
	recordSend(
		id: string,
		field: PendingSignupFieldName,
		sentAt: string,
		expiresAt: string,
	): Promise<PendingSignup | null>;

	/** Marks a field proven and slides the expiry. Never called without a verified code. */
	markVerified(id: string, field: PendingSignupFieldName, expiresAt: string): Promise<PendingSignup | null>;

	/** Attaches a verified provider identity, server-side, at the start of a social signup. */
	attachProvider(
		id: string,
		provider: 'google' | 'facebook',
		subject: string,
		expiresAt: string,
	): Promise<PendingSignup | null>;

	/**
	 * Single-use consumption at finalisation.
	 *
	 * Returns the record and removes it atomically, so two submits cannot both mint an account
	 * from one proof. The second gets nothing and is told the signup expired, which is true.
	 */
	consume(id: string): Promise<PendingSignup | null>;

	deleteBySessionKey(sessionKey: string): Promise<boolean>;
}
