/**
 * Cross-tab mutual exclusion for session rotation.
 *
 * `RefreshCoordinator` makes one tab rotate once. It cannot see the tab next to it, and two
 * tabs of the same app share one cookie jar — so when their access cookies lapse together,
 * both can rotate. The window is narrow: if the first tab's response lands before the second
 * tab's request leaves, the second carries the already-rotated cookie and simply rotates
 * again, harmlessly. Only a request that is ALREADY in flight presents the rotated-away
 * token, which the API cannot distinguish from theft — it revokes the whole refresh family
 * and signs the user out, recording a "reuse detected" security event that never happened.
 *
 * The Web Locks API closes that window. It is a real mutex held per origin across tabs and
 * workers, and — the property that makes it worth preferring over a hand-rolled leader
 * elected over `BroadcastChannel` — the browser releases it automatically if the holding tab
 * is closed mid-rotation. A hand-rolled leader needs a timeout for that case, and any value
 * is either short enough to allow the second rotation it was meant to prevent or long enough
 * to hang every other tab.
 *
 * A follower that waits and then rotates a second time is accepted rather than optimised
 * away: by then the leader's rotation has completed and set a new cookie, so the follower
 * presents a current token and no reuse is detected. Sharing the result instead would need
 * exactly the message protocol this avoids.
 */

/** The subset of the Web Locks API used here. Declared locally so no DOM lib is required. */
export interface LockManagerLike {
	request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/**
 * Runs `work` while holding a named cross-tab lock, or directly when locking is unavailable.
 *
 * Falling through rather than failing is deliberate. Web Locks needs a secure context and
 * arrived in Safari 15.4, and there is no jar or second tab under server rendering at all.
 * Where it is missing the caller is exactly as exposed to the race as before this existed —
 * which is to say, no worse — and refusing to rotate would trade a narrow race for a certain
 * logout.
 *
 * `locks` is injectable so the behaviour can be tested: jsdom implements `BroadcastChannel`
 * but not `navigator.locks`, so an ambient-only implementation could only ever be observed
 * taking its fallback path.
 */
export function withBrowserLock<T>(
	name: string,
	work: () => Promise<T>,
	locks: LockManagerLike | null = ambientLockManager(),
): Promise<T> {
	if (!locks) return work();

	try {
		return locks.request(name, work);
	} catch {
		// A browser that exposes the API but refuses the request (an insecure context, for
		// instance) must not take the rotation down with it.
		return work();
	}
}

interface NavigatorWithLocks {
	readonly locks?: unknown;
}

function ambientLockManager(): LockManagerLike | null {
	const navigator = (globalThis as { navigator?: NavigatorWithLocks }).navigator;
	const locks = navigator?.locks;

	if (typeof locks !== 'object' || locks === null) return null;
	if (typeof (locks as LockManagerLike).request !== 'function') return null;

	return locks as LockManagerLike;
}
