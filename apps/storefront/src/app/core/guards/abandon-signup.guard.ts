import type { CanDeactivateFn } from '@angular/router';

/** What the guard needs of a screen; kept structural so the guard imports no feature code. */
export interface AbandonsSignupOnLeave {
	leaveSignup(): void;
}

/**
 * Throws away a half-finished signup when its screen is LEFT.
 *
 * ## Why leaving is the trigger and reloading is not
 *
 * A pending signup is server-side state keyed to an httpOnly cookie, and it holds proven
 * identifiers: an email Google asserted, a phone somebody waited for a code on. That is exactly
 * what should survive a refresh — the whole point of `GET /auth/storefront/signup` is that
 * pressing F5 resumes rather than restarts.
 *
 * It is also exactly what should NOT survive walking away. Left alone the record sits for its
 * full half hour, so the next person to open the registration page on a shared machine gets
 * somebody else's verified address prefilled, a locked email field, and no password fields, with
 * nothing on screen explaining any of it.
 *
 * `canDeactivate` separates the two precisely: Angular runs it on an in-app navigation and never
 * when the browser tears the page down itself. Reload keeps; leave discards.
 *
 * ## It never blocks
 *
 * Always returns `true`. Somebody who has decided to leave is not held up waiting on a request
 * they did not make, and the record TTLs out on its own — the `DELETE` only makes the ending
 * prompt. A confirmation prompt was considered and rejected: "are you sure you want to leave?"
 * on a form nobody has committed to is the kind of dialog people learn to dismiss without
 * reading.
 */
export const abandonSignupGuard: CanDeactivateFn<AbandonsSignupOnLeave> = (component) => {
	component.leaveSignup();
	return true;
};
