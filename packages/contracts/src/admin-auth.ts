import { z } from 'zod';

import { AdminRole, AdminUserId } from './admin-role';
import { Password } from './auth';
import { Id, IsoDateTime } from './common';
import { UserStatus } from './customer';
import { PermissionGrant } from './permission';
import { SessionInfo } from './session';

export { AdminRole, AdminUserId };
/**
 * 6-digit admin PIN (owner lock 2026-06-29 / UX lock 2026-07-23). Shape only —
 * weak-PIN rejection (denylist + sequential/repeated patterns) is a domain policy
 * check, not a schema regex: `evaluateAdminPin` in
 * `packages/core-domain/src/auth/pin-policy.ts`, enforced by the API on every path
 * that sets a PIN. A refusal returns `validation_failed` with a `pin_*` issue code.
 *
 * Strength deliberately does NOT live here. This schema is shared with the browser,
 * and a client is the one place the rule must never be enforced.
 */
export const AdminPin = z.string().regex(/^\d{6}$/, 'must be a 6-digit PIN');
export type AdminPin = z.infer<typeof AdminPin>;

/** Preferred admin quick-login method (theme form-switch; `pin` only valid when a PIN is set). */
export const PreferredLoginMethod = z.enum(['password', 'pin']);
export type PreferredLoginMethod = z.infer<typeof PreferredLoginMethod>;

/** `POST /auth/admin/login` — email OR username in one identifier field. Staff/admin only. */
export const AdminLoginRequest = z.object({
	identifier: z.string().min(1).max(320),
	password: z.string().min(1).max(256),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequest>;

/** `POST /auth/admin/login/pin` — full login via PIN (lockout: 5 fails → 15 min or password login). */
export const AdminPinLoginRequest = z.object({
	identifier: z.string().min(1).max(320),
	pin: AdminPin,
});
export type AdminPinLoginRequest = z.infer<typeof AdminPinLoginRequest>;

/**
 * `POST /auth/admin/resume` — idle soft-lock presence proof on an existing session.
 * PIN when configured; password when the operator has no PIN (L1).
 */
export const AdminResumeRequest = z.union([
	z.object({ pin: AdminPin }),
	z.object({ password: z.string().min(1).max(256) }),
]);
export type AdminResumeRequest = z.infer<typeof AdminResumeRequest>;

/** Set/change the admin PIN from Security Settings or onboarding — always requires password proof. */
export const AdminPinSetupRequest = z.object({
	currentPassword: z.string().min(1).max(256),
	pin: AdminPin,
	/** Optionally flip the preferred method in the same call (form-switch UX). */
	preferredLoginMethod: PreferredLoginMethod.optional(),
});
export type AdminPinSetupRequest = z.infer<typeof AdminPinSetupRequest>;

/** Sanitized admin-scope profile extras (never includes hashes, versions, or raw risk data). */
export const AdminProfile = z.object({
	employeeCode: z.string().nullable().default(null),
	department: z.string().nullable().default(null),
	invitedByUserId: Id.nullable().default(null),
	acceptedInviteAt: IsoDateTime.nullable().default(null),
});
export type AdminProfile = z.infer<typeof AdminProfile>;

/** `PATCH /auth/admin/profile` — operator self-service profile fields only. */
export const AdminSelfProfileUpdateRequest = z.object({
	displayName: z.string().min(1).max(120),
	phone: z.string().min(1).max(32).nullable().optional(),
});
export type AdminSelfProfileUpdateRequest = z.infer<typeof AdminSelfProfileUpdateRequest>;

/**
 * Public AdminUser entity / `GET /auth/admin/me` profile (`DEC-ACCOUNT-SEPARATION`).
 * Sanitized: preference/status fields only — never credential material or version counters.
 */
export const AdminUserProfile = z.object({
	id: AdminUserId,
	email: z.email().nullable().default(null),
	emailVerified: z.boolean().default(false),
	username: z.string().nullable().default(null),
	displayName: z.string().optional(),
	phone: z.string().min(1).max(32).nullable().optional(),
	role: AdminRole,
	status: UserStatus,
	/** Whether a PIN credential is currently set (drives Security Settings UI). */
	pinConfigured: z.boolean().default(false),
	preferredLoginMethod: PreferredLoginMethod.default('password'),
	adminProfile: AdminProfile.optional(),
	lastLoginAt: IsoDateTime.nullable().default(null),
	createdAt: IsoDateTime.optional(),
});
export type AdminUserProfile = z.infer<typeof AdminUserProfile>;

/** Canonical name for the operator account entity. Same shape as `AdminUserProfile`. */
export const AdminUser = AdminUserProfile;
export type AdminUser = AdminUserProfile;

/** `GET /auth/admin/me` response. */
export const AdminMeResponse = z.object({
	user: AdminUserProfile,
	permissions: z.array(z.string()).default([]),
	session: SessionInfo,
});
export type AdminMeResponse = z.infer<typeof AdminMeResponse>;

/**
 * `POST /auth/admin/password/forgot` — response is ALWAYS generic (anti-enumeration).
 *
 * Recovery is a single-use, short-lived, hash-only token delivered by email. It is
 * deliberately NOT an OTP challenge and must never become a routine admin login method
 * (owner lock: admin OTP login is `DO NOT BUILD AS LOGIN`).
 *
 * The identifier is email-or-username, matching admin login, so an operator who remembers
 * only their username can still start recovery.
 */
export const AdminPasswordForgotRequest = z.object({
	identifier: z.string().min(1).max(320),
});
export type AdminPasswordForgotRequest = z.infer<typeof AdminPasswordForgotRequest>;

/**
 * `POST /auth/admin/password/reset` — consumes the token and re-secures the account.
 *
 * A successful privileged reset revokes every admin session and puts the PIN into an
 * explicit revalidation state: PIN full-login and quick-resume stay unavailable until the
 * administrator authenticates once with the new password. The PIN is never silently
 * deleted — the transition is recorded and audited (owner security decision).
 */
export const AdminPasswordResetRequest = z.object({
	token: z.string().min(1),
	newPassword: Password,
});
export type AdminPasswordResetRequest = z.infer<typeof AdminPasswordResetRequest>;

/** `POST /admin/users/invite` — no admin self-registration; invite-only (auth plan §7.9). */
export const AdminInviteRequest = z.object({
	email: z.email(),
	role: AdminRole,
	/**
	 * Validated against the canonical registry, so an unknown or mistyped code is refused
	 * here rather than stored and silently authorizing nothing. Strict on the way IN only:
	 * the persisted `AdminInvite` and `AdminUserAuthState` keep a permissive `string[]`,
	 * because rows written before this registry existed must still parse on read. Tightening
	 * those would turn a historical grant into an unreadable document.
	 */
	permissions: PermissionGrant.optional(),
});
export type AdminInviteRequest = z.infer<typeof AdminInviteRequest>;

/** Invite acceptance — sets the initial password (policy floor applies); PIN setup is optional/skippable. */
export const AdminInviteAcceptRequest = z.object({
	token: z.string().min(1),
	password: Password,
	displayName: z.string().min(1).max(120).optional(),
	username: z.string().min(3).max(60).optional(),
	/** Optional onboarding PIN setup (owner lock 2026-07-23: skippable). */
	pin: AdminPin.optional(),
	preferredLoginMethod: PreferredLoginMethod.optional(),
});
export type AdminInviteAcceptRequest = z.infer<typeof AdminInviteAcceptRequest>;

/**
 * Read model for the admin Security Settings screen (`GET /auth/admin/security`).
 *
 * Deliberately says whether a PIN EXISTS, never anything about the PIN itself. A screen needs
 * to render "change" rather than "set", and to explain why PIN login is currently refused —
 * neither of which requires the value, its length, or its hash.
 *
 * The two suspension states are separate because they behave differently and an operator has
 * to be told which one they are in: `pinLockedUntil` is the five-failure brute-force lock and
 * clears itself after fifteen minutes, while `pinRevalidationRequiredAt` follows a privileged
 * password reset and clears only when the new password is used once.
 */
export const AdminSecuritySettingsResponse = z.object({
	hasPin: z.boolean(),
	preferredLoginMethod: PreferredLoginMethod,
	/** Non-null while the brute-force lock is in force. Self-clearing. */
	pinLockedUntil: IsoDateTime.nullable(),
	/** Non-null while PIN use is suspended after a privileged reset. Not self-clearing. */
	pinRevalidationRequiredAt: IsoDateTime.nullable(),
	emailVerified: z.boolean(),
	/** How many sessions this account currently has live, across every device. */
	activeSessions: z.number().int().nonnegative(),
});
export type AdminSecuritySettingsResponse = z.infer<typeof AdminSecuritySettingsResponse>;

/**
 * Change the signed-in administrator's password (`POST /auth/admin/password/change`).
 *
 * `currentPassword` is the recent-password proof: a hijacked session must not be able to
 * change the credential it rode in on, which would lock the real owner out of their own
 * account. Distinct from the RESET flow, which is for somebody who cannot sign in and is
 * authorized by an emailed single-use token instead.
 */
export const AdminPasswordChangeRequest = z.object({
	currentPassword: z.string().min(1).max(256),
	newPassword: Password,
});
export type AdminPasswordChangeRequest = z.infer<typeof AdminPasswordChangeRequest>;

/**
 * Remove the PIN entirely (`DELETE /auth/admin/pin`).
 *
 * Password proof again, for the same reason it guards setting one: removing a credential is
 * as sensitive as adding one, and an attacker who could clear the PIN could then set their
 * own through the endpoint next door.
 */
export const AdminPinRemovalRequest = z.object({
	currentPassword: z.string().min(1).max(256),
});
export type AdminPinRemovalRequest = z.infer<typeof AdminPinRemovalRequest>;
