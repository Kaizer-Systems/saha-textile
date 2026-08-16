import type { CustomerStatus, OAuthProvider } from '@saha-textile/contracts';

/**
 * The decisions of `DEC-SIGNUP-VERIFICATION`, as pure functions.
 *
 * No clock, no storage, no framework — a controller passes facts in and gets a verdict out.
 * These rules are the ones most likely to be re-derived slightly differently at each call
 * site if they lived in a service, and "slightly differently" in authorization is how a
 * disclosure rule ends up leaking on one path and not another.
 */

/** Whether an account may be entered at all, once its owner has proven control. */
export function isAccountEnterable(status: CustomerStatus): boolean {
	return status === 'active' || status === 'pending';
}

/**
 * What a caller may be told about an identifier.
 *
 * The entire anti-enumeration posture in one function. Existence is disclosed only to someone
 * who has PROVEN they control the address — by OTP, or by Google asserting `email_verified`.
 * To everyone else the answer is silence, because an unauthenticated caller who can ask "is
 * this registered?" can ask it a million times and walk away with the customer list.
 *
 * Note what is NOT an input: whether the account has a password, which providers it has
 * linked, or how it was created. Varying the answer on any of those would leak the account's
 * shape to whoever asked — and that shape is precisely what an attacker uses to choose an
 * approach.
 */
export function mayDiscloseExistence(input: { proofOfControl: boolean }): boolean {
	return input.proofOfControl;
}

/**
 * Which account a completed signup resolves to.
 *
 * Both identifiers are verified by the time this runs, so both are trustworthy — which is
 * exactly what makes the conflict case dangerous rather than harmless. When the email belongs
 * to one customer and the phone to another, there is no safe guess: signing into either would
 * hand somebody a stranger's account on the strength of the OTHER identifier. The flow
 * resolves collisions at the first verification precisely so this stays rare, but a rare case
 * that silently picks a winner is worse than one that stops.
 */
export type SignupResolution = { kind: 'create' } | { kind: 'existing'; customerId: string } | { kind: 'conflict' };

export function resolveSignupTarget(input: {
	emailOwnerId: string | null;
	phoneOwnerId: string | null;
}): SignupResolution {
	const { emailOwnerId, phoneOwnerId } = input;
	if (emailOwnerId && phoneOwnerId) {
		return emailOwnerId === phoneOwnerId ? { kind: 'existing', customerId: emailOwnerId } : { kind: 'conflict' };
	}
	const owner = emailOwnerId ?? phoneOwnerId;
	return owner ? { kind: 'existing', customerId: owner } : { kind: 'create' };
}

/**
 * Which proof a sensitive account action must demand.
 *
 * A password is preferred wherever one exists: it costs nothing to check, and it is stronger
 * than a code sent to a channel that an attacker already holding the session may also be able
 * to read. OTP is the fallback for accounts that have no password yet — social signups, until
 * they set one.
 */
export function stepUpMethodFor(input: { passwordSet: boolean }): 'password' | 'otp' {
	return input.passwordSet ? 'password' : 'otp';
}

/**
 * Whether a login method may be removed.
 *
 * Enforced explicitly rather than inferred. Today every account carries a verified email and
 * phone, so an OTP route always survives a disconnect and this can never refuse — which is
 * exactly why it must exist: the day that assumption changes, this should start refusing
 * loudly instead of quietly turning "disconnect" into "lock myself out permanently".
 */
export function credentialsAfterRemoval(input: {
	passwordSet: boolean;
	emailVerified: boolean;
	phoneVerified: boolean;
	linkedProviders: readonly OAuthProvider[];
	removing: { kind: 'password' } | { kind: 'provider'; provider: OAuthProvider };
}): number {
	// Destructured so the discriminant survives into the closure below; narrowing `input.removing`
	// inside a callback does not hold, and the compiler is right to say so.
	const { removing } = input;
	const password = removing.kind === 'password' ? false : input.passwordSet;
	const providers =
		removing.kind === 'provider'
			? input.linkedProviders.filter((provider) => provider !== removing.provider)
			: input.linkedProviders;

	// A verified email or phone IS a credential: it can receive a one-time code, which is a
	// full login path. Counting them is what makes disconnect safe for a social signup that
	// never set a password.
	return (password ? 1 : 0) + (input.emailVerified ? 1 : 0) + (input.phoneVerified ? 1 : 0) + providers.length;
}

export function mayRemoveCredential(input: Parameters<typeof credentialsAfterRemoval>[0]): boolean {
	return credentialsAfterRemoval(input) >= 1;
}

/**
 * Progressive backoff between resends, in seconds.
 *
 * A ceiling with a cliff punishes the honest majority for the attacker's behaviour: someone
 * who mistypes a code once should not lose the channel for a day. Rising delays cost a real
 * person almost nothing — they were not going to request five codes in a minute — while
 * reducing an automated caller to a trickle long before any hard limit is reached.
 *
 * `sendsAlreadyMade` is zero for the first send, which is immediate.
 */
const BACKOFF_SECONDS = [0, 30, 120, 600, 3600] as const;

export function resendDelaySeconds(sendsAlreadyMade: number): number {
	if (sendsAlreadyMade <= 0) return 0;
	const index = Math.min(sendsAlreadyMade, BACKOFF_SECONDS.length - 1);
	return BACKOFF_SECONDS[index] as number;
}
