/**
 * Single-flight coordinator for session refresh.
 *
 * The problem it exists to solve: an expired access cookie makes EVERY in-flight request
 * fail with 401 at roughly the same moment. If each of them independently calls its
 * audience's refresh route, they race to rotate the same opaque refresh token — and the API's
 * rotation is deliberately atomic and reuse-detecting, so the losers present a token that
 * has just been rotated away. That is indistinguishable from a stolen token, and the API
 * responds by revoking the whole refresh family: a signed-in user is logged out by their own
 * page loading two requests at once.
 *
 * So: the first caller performs the rotation, every caller that arrives while it is in
 * flight joins the SAME promise, and the slot clears once it settles.
 *
 * Framework-free by design. It coordinates a promise; it does not know what a refresh
 * request looks like, which app it belongs to, or how the caller retries afterwards.
 */

/** The rotation itself — supplied by the app's auth gateway, not by this package. */
export type RefreshOperation<T> = () => Promise<T>;

export interface RefreshCoordinatorOptions {
	/**
	 * After a failed rotation, refuse further attempts until `reset()` is called.
	 *
	 * This is loop prevention, and it is opt-in because it changes what a failure means.
	 * Without it, an anonymous visitor pays one pointless refresh request per 401 — and a
	 * page that fires several protected requests keeps re-asking a question the server has
	 * already answered. With it, the first failure is treated as a verdict: the session is
	 * gone until the user authenticates again, at which point the app calls `reset()`.
	 *
	 * Latched callers reject with the failure that caused the latch, so the reason a request
	 * gave up is still the real one rather than a synthetic "unavailable" error.
	 */
	latchOnFailure?: boolean;
}

export class RefreshCoordinator<T = void> {
	private inFlight: Promise<T> | null = null;
	private readonly latchOnFailure: boolean;
	/** The failure that latched the coordinator, replayed to every later caller. */
	private latchedFailure: unknown = null;

	constructor(options: RefreshCoordinatorOptions = {}) {
		this.latchOnFailure = options.latchOnFailure ?? false;
	}

	/** True while a rotation is outstanding. Useful for suppressing UI churn, not for locking. */
	get isRefreshing(): boolean {
		return this.inFlight !== null;
	}

	/** True once a rotation has failed under `latchOnFailure`, until `reset()`. */
	get isLatched(): boolean {
		return this.latchedFailure !== null;
	}

	/**
	 * Runs `operation`, or joins the rotation already in progress.
	 *
	 * Every joined caller observes the same resolution — and the same rejection. A failed
	 * refresh must reject rather than resolve to a falsy value: callers decide whether that
	 * means "sign out", and swallowing it here would leave them retrying a dead session.
	 *
	 * The slot is cleared in a `finally`, so a rejection cannot wedge the coordinator into a
	 * state where no future refresh is ever attempted. A synchronous throw from `operation`
	 * is converted into a rejected promise for the same reason: without that, the slot would
	 * never be assigned and the error would escape past the bookkeeping.
	 */
	run(operation: RefreshOperation<T>): Promise<T> {
		if (this.latchedFailure !== null) return Promise.reject(this.latchedFailure);
		if (this.inFlight) return this.inFlight;

		let started: Promise<T>;
		try {
			started = operation();
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error));
			this.latch(failure);
			return Promise.reject(failure);
		}

		const tracked = Promise.resolve(started)
			.catch((error: unknown) => {
				this.latch(error);
				throw error;
			})
			.finally(() => {
				// Only clear our own slot. A `reset()` between start and settle may already have
				// replaced it, and blindly nulling would discard a newer rotation.
				if (this.inFlight === tracked) this.inFlight = null;
			}) as Promise<T>;

		this.inFlight = tracked;
		return tracked;
	}

	/**
	 * Abandons the tracked rotation and clears any latch.
	 *
	 * Two cases, and they are the same case: the app's belief about the session has changed,
	 * so nothing recorded here is still relevant. Either the session is known to be gone (an
	 * explicit logout) and a joined caller should not wait on a rotation whose result no
	 * longer matters, or the user has just authenticated and a previous failure must stop
	 * suppressing attempts. The underlying request is not aborted — this package owns no
	 * transport — it is merely no longer shared.
	 */
	reset(): void {
		this.inFlight = null;
		this.latchedFailure = null;
	}

	private latch(failure: unknown): void {
		// `null`/`undefined` would read as "not latched", so keep a real error either way.
		if (this.latchOnFailure) this.latchedFailure = failure ?? new Error('Session refresh failed');
	}
}
