import { Observable } from 'rxjs';

/**
 * The admin application's authentication boundary.
 *
 * Separate from the storefront gateway on purpose, and not by accident of file layout: an
 * admin session carries the `admin` audience, and the API rejects a storefront cookie on
 * these routes and vice versa. Keeping the two gateways apart means admin code cannot
 * reach a storefront login method, and storefront code cannot reach an admin one.
 *
 * The launch credential set is exactly what the owner locked — identifier plus password,
 * identifier plus a configured six-digit PIN, and PIN quick-resume for an existing session.
 * There is deliberately **no** social login, no self-registration and no OTP login here;
 * those are not omissions to be filled in later, they are excluded by decision.
 */

/** Sanitized admin identity. Never carries password/PIN hashes or version counters. */
export interface AdminUser {
	id: string;
	email: string | null;
	emailVerified: boolean;
	username: string | null;
	role: string;
	status: string;
	/** Whether a PIN exists — never the PIN or its hash. */
	pinConfigured: boolean;
	preferredLoginMethod: string;
	lastLoginAt: string | null;
}

export interface AdminSessionInfo {
	audience: string;
	expiresAt: string;
	refreshExpiresAt: string;
}

export interface AdminMe {
	user: AdminUser;
	/** Server-authoritative grants. Used to shape the UI only; the API re-checks each call. */
	permissions: string[];
	session: AdminSessionInfo;
}

export interface AdminSessionResult {
	user: { id: string; email: string | null; role: string; status: string };
	session: AdminSessionInfo;
}

export interface AdminPasswordLoginInput {
	/** Email or username — the API resolves either. */
	identifier: string;
	password: string;
}

export interface AdminPinLoginInput {
	identifier: string;
	pin: string;
}

export interface AdminPasswordResetInput {
	/** The single-use token from the recovery email. Never persisted client-side. */
	token: string;
	newPassword: string;
}

/**
 * What Security Settings renders.
 *
 * Says a PIN EXISTS, never anything about its value, its length or its hash. A screen needs
 * to show "change" rather than "set", and to explain why PIN login is currently refused —
 * neither of which requires the credential.
 *
 * The two suspension states are separate because they behave differently and an operator has
 * to be told which one they are in: `pinLockedUntil` is the five-failure brute-force lock and
 * clears itself after fifteen minutes, while `pinRevalidationRequiredAt` follows a privileged
 * password reset and clears only once the new password has been used.
 */
export interface AdminSecurityState {
	hasPin: boolean;
	preferredLoginMethod: string;
	/** Non-null while the brute-force lock is in force. Self-clearing. */
	pinLockedUntil: string | null;
	/** Non-null while PIN use is suspended after a privileged reset. Not self-clearing. */
	pinRevalidationRequiredAt: string | null;
	emailVerified: boolean;
	/** How many sessions this account has live, across every device. A count, never the rows. */
	activeSessions: number;
}

export interface AdminPinSetupInput {
	/** Recent-password proof. Required on every change, not only the first. */
	currentPassword: string;
	pin: string;
	/** Optionally flips the preferred method in the same call. */
	preferredLoginMethod?: string;
}

export interface AdminPasswordChangeInput {
	currentPassword: string;
	newPassword: string;
}

export abstract class AdminAuthGateway {
	/** Resolves the signed-in operator plus current permissions, or `null` when anonymous. */
	abstract currentUser(): Observable<AdminMe | null>;

	abstract ensureCsrfToken(): Observable<void>;

	abstract loginWithPassword(input: AdminPasswordLoginInput): Observable<AdminSessionResult>;

	/** Full PIN login. Five failures lock PIN use for 15 minutes; password login still works. */
	abstract loginWithPin(input: AdminPinLoginInput): Observable<AdminSessionResult>;

	/**
	 * Idle quick-resume: re-proves presence on the session that is already open, extending
	 * it rather than issuing a new one. That is what allows the UI to keep its mounted
	 * route and unsaved form state across the soft lock.
	 */
	abstract resumeWithPin(pin: string): Observable<AdminSessionResult>;

	/**
	 * Starts password recovery from an email or username.
	 *
	 * Resolves identically whether or not the account exists — the API answers generically
	 * so this endpoint cannot be used to enumerate back-office accounts. Callers must not
	 * infer existence from success.
	 *
	 * This is recovery, not a login method: it issues an emailed token and never a session.
	 */
	abstract requestPasswordReset(identifier: string): Observable<void>;

	/**
	 * Redeems the recovery token and sets a new password.
	 *
	 * The server revokes every admin session and suspends PIN use until the new password is
	 * used once, so the caller is signed out by definition and must log in again.
	 */
	abstract resetPassword(input: AdminPasswordResetInput): Observable<void>;

	/**
	 * Reads the operator's own credential state for Security Settings.
	 *
	 * A plain authenticated GET. A `401` here means the session lapsed and the transport may
	 * recover it by rotating, exactly as it does for `/me`.
	 */
	abstract securitySettings(): Observable<AdminSecurityState>;

	/**
	 * Sets or replaces the PIN, proving the current password every time.
	 *
	 * Weak PINs are refused by the server — repeats, runs and a denylist — as
	 * `validation_failed` carrying a `pin_*` issue code. The rule is deliberately NOT
	 * duplicated here: a client is the one place credential policy must never be enforced,
	 * because a client can be bypassed. Render the server's refusal; do not pre-empt it.
	 */
	abstract setPin(input: AdminPinSetupInput): Observable<void>;

	/**
	 * Removes the PIN, proving the current password.
	 *
	 * The server resets the preferred method to `password` in the same operation, so callers
	 * must re-read `securitySettings()` rather than assuming the local copy is still accurate.
	 */
	abstract removePin(currentPassword: string): Observable<void>;

	/**
	 * Changes the password, proving the old one.
	 *
	 * The server revokes EVERY admin session including this one, so a success signs the
	 * operator out by definition. Callers must send them to the login screen rather than
	 * leaving a shell mounted over a session that no longer exists.
	 *
	 * Distinct from `resetPassword`, which is for somebody who cannot sign in and is
	 * authorized by an emailed token instead.
	 */
	abstract changePassword(input: AdminPasswordChangeInput): Observable<void>;

	abstract logout(): Observable<void>;

	/**
	 * Rotates the session using the refresh cookie. Emits nothing — the new access, refresh
	 * and CSRF cookies are set by the API on the response, and the client never sees them.
	 *
	 * This matters more here than on the storefront: an admin access cookie lives 15 minutes
	 * against a 12-hour absolute window, so an operator working through a long form crosses
	 * that boundary routinely. Callers must not invoke it directly to "keep the session
	 * alive" — rotation is reuse-detecting, and two concurrent rotations look like a stolen
	 * token and revoke the whole family.
	 *
	 * It is not the idle soft lock. That is a presence check with the PIN (`resumeWithPin`)
	 * and is deliberately a separate decision from renewing an access cookie.
	 */
	abstract refreshSession(): Observable<void>;

	/**
	 * True when a `401` from this URL means "these credentials were refused" rather than
	 * "this session expired".
	 *
	 * The distinction is what keeps the transport's 401 recovery from looping: rotating the
	 * session after a wrong PIN would be pointless, and rotating after a failed rotation
	 * would be infinite. It lives on the gateway because the gateway is the one file that
	 * knows this app's route paths.
	 *
	 * `/me` is deliberately NOT one of these: a 401 there means there is no live session for
	 * this browser, which is exactly the case a refresh can still recover on a page reload.
	 */
	abstract isCredentialEndpoint(url: string): boolean;

	/**
	 * True when a SUCCESSFUL response from this URL proves a session now exists.
	 *
	 * A strict subset of the credential endpoints, and the difference is the point. The
	 * transport stops attempting rotation once one has failed, and only evidence of a live
	 * session makes that verdict obsolete. Logout, recovery request and password reset are
	 * credential endpoints that succeed by DESTROYING or not creating a session, so treating
	 * their `204` as proof would un-latch the transport into one pointless rotation per
	 * subsequent 401 — the exact loop the latch exists to prevent.
	 *
	 * PIN quick-resume counts: it extends the operator's existing session rather than issuing
	 * a new one, and a successful resume is direct evidence that session is alive.
	 */
	abstract isSessionEstablishingEndpoint(url: string): boolean;
}
