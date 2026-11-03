/**
 * The Web Lock every admin session refresh takes, in every tab: the auth interceptor's 401
 * rotation and `IdleLockService`'s keep-alive. Its own module so both import it without one
 * depending on the other.
 *
 * Web Locks are scoped per origin, and the name is audience-specific so that an origin ever
 * shared with the storefront would not serialise two unrelated sessions against each other.
 */
export const SESSION_REFRESH_LOCK = 'saha-textile-admin-session-refresh';
