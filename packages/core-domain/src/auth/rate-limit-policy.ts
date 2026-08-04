/**
 * Authentication rate-limit policy.
 *
 * Pure data and a pure decision. No clock, no storage, no framework — the counter store
 * lives behind `AuthRateLimitRepository`, and swapping Mongo for Redis must not touch a
 * single number here.
 *
 * ## Why the numbers look generous on IP and strict on identifier
 *
 * Indian consumer internet is overwhelmingly carrier-grade NAT: Jio and Airtel put
 * thousands of subscribers behind one public IPv4 address. A per-IP limit tight enough to
 * stop an attacker is tight enough to lock out a town, and the user experiences it as
 * "wrong password" on a password they typed correctly. So the identifier is the sharp
 * control — it is the thing actually under attack — and the address is a coarse abuse
 * signal with room to breathe.
 *
 * ## Why counting mode matters more than any ceiling
 *
 * Counting every ATTEMPT means a legitimate signed-in customer consumes the same budget as
 * someone guessing, and behind CGNAT the honest majority exhausts it first. Counting
 * FAILURES inverts that: an attacker's requests are all failures and are all counted, while
 * a successful login costs nothing. That is what makes a strict limit affordable.
 *
 * Actions that spend a real resource on success — sending an email, creating an account —
 * cannot use failure counting, because the cost is incurred whether or not the caller was
 * honest. Those count attempts, and lean on the identifier scope to stay fair.
 */

/** Which key a limit is counted against. */
export type RateLimitScope = 'identifier' | 'ip';

/**
 * `failures` — only unsuccessful attempts count, and a success clears the identifier's
 * budget. For credential guessing, where success proves the caller was not attacking.
 *
 * `attempts` — every call counts, because the action spends something on success too.
 */
export type RateLimitCounting = 'failures' | 'attempts';

export interface RateLimitRule {
	/** Refuse once the count within the window EXCEEDS this. */
	max: number;
	windowSeconds: number;
}

export interface RateLimitActionPolicy {
	counting: RateLimitCounting;
	/** Absent means the action is not limited on that scope. */
	identifier?: RateLimitRule;
	ip?: RateLimitRule;
}

/**
 * Every rate-limited authentication action.
 *
 * Storefront and admin login are separate entries on purpose. They shared one bucket, so a
 * burst of customer traffic could exhaust the budget the back office depends on — a
 * customer-facing action locking out staff from the same office address.
 */
export type AuthRateLimitAction =
	| 'storefront_login'
	| 'storefront_register'
	| 'admin_login'
	| 'admin_pin_login'
	| 'otp_request'
	| 'otp_verify'
	| 'password_reset';

const MINUTES = 60;
const HOURS = 60 * MINUTES;

/**
 * The tuning surface. Changing a ceiling is a one-line diff here, reviewed like any other
 * behaviour and covered by tests — deliberately not an environment variable, because these
 * numbers are policy rather than deployment topology and should not differ per environment.
 */
export const AUTH_RATE_LIMIT_POLICY: Readonly<Record<AuthRateLimitAction, RateLimitActionPolicy>> = {
	storefront_login: {
		counting: 'failures',
		identifier: { max: 10, windowSeconds: 15 * MINUTES },
		ip: { max: 100, windowSeconds: 15 * MINUTES },
	},
	admin_login: {
		counting: 'failures',
		identifier: { max: 10, windowSeconds: 15 * MINUTES },
		// Lower than the storefront: the back office has a handful of operators, so a
		// hundred failures from one address is noise the storefront might produce and the
		// admin never should.
		ip: { max: 50, windowSeconds: 15 * MINUTES },
	},
	/**
	 * The owner-locked control is five failed PIN attempts locking PIN use for fifteen
	 * minutes, and that is enforced per ACCOUNT through `pinLockedUntil` — not here. This
	 * IP ceiling exists only to make distributed guessing expensive, and it is deliberately
	 * high: the previous per-IP five would let any five failures anywhere behind a shared
	 * address lock PIN login for every operator on it.
	 */
	admin_pin_login: {
		counting: 'failures',
		ip: { max: 200, windowSeconds: 15 * MINUTES },
	},
	otp_verify: {
		counting: 'failures',
		// The sharp per-challenge cap is the OTP challenge's own five-attempt limit; this is
		// the aggregate guard across challenges.
		identifier: { max: 10, windowSeconds: 15 * MINUTES },
		ip: { max: 100, windowSeconds: 15 * MINUTES },
	},
	storefront_register: {
		counting: 'attempts',
		// Per submitted address, so a household sharing an address is not punished for one
		// person signing up.
		identifier: { max: 3, windowSeconds: 1 * HOURS },
		ip: { max: 30, windowSeconds: 1 * HOURS },
	},
	otp_request: {
		counting: 'attempts',
		identifier: { max: 5, windowSeconds: 15 * MINUTES },
		ip: { max: 60, windowSeconds: 1 * HOURS },
	},
	password_reset: {
		counting: 'attempts',
		identifier: { max: 5, windowSeconds: 1 * HOURS },
		ip: { max: 30, windowSeconds: 1 * HOURS },
	},
};

export interface RateLimitCounts {
	/** Current count in the window, or `undefined` when the scope is not being counted. */
	identifier?: number;
	ip?: number;
}

export type RateLimitDecision =
	| { allowed: true }
	| {
			allowed: false;
			scope: RateLimitScope;
			/**
			 * Upper bound, not a precise countdown: the counter store reports how many hits
			 * are in the window, not when the window opened. Reporting the whole window is
			 * honest — the caller is never told to retry too early.
			 */
			retryAfterSeconds: number;
	  };

/**
 * Decides whether an action may proceed.
 *
 * The identifier scope is evaluated first so that the sharp, account-specific control is
 * the one a caller runs into, rather than being masked by an address they share with
 * strangers.
 */
export function decideRateLimit(policy: RateLimitActionPolicy, counts: RateLimitCounts): RateLimitDecision {
	if (policy.identifier && counts.identifier !== undefined && counts.identifier >= policy.identifier.max) {
		return { allowed: false, scope: 'identifier', retryAfterSeconds: policy.identifier.windowSeconds };
	}
	if (policy.ip && counts.ip !== undefined && counts.ip >= policy.ip.max) {
		return { allowed: false, scope: 'ip', retryAfterSeconds: policy.ip.windowSeconds };
	}
	return { allowed: true };
}
