import { z } from 'zod';

import { Password } from './auth';
import { Id, IsoDateTime } from './common';
import { SessionInfo } from './session';
import { UserStatus } from './user';

/**
 * 6-digit admin PIN (owner lock 2026-06-29 / UX lock 2026-07-23). Shape only —
 * weak-PIN rejection (denylist + sequential/repeated patterns) is a domain
 * policy check in core-domain, not a schema regex.
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

/**
 * Admin/staff user profile as returned by `GET /auth/admin/me`. Sanitized:
 * exposes preference/status fields but never credential material or
 * token/permission versions.
 */
export const AdminUserProfile = z.object({
	id: Id,
	email: z.email().nullable().default(null),
	emailVerified: z.boolean().default(false),
	username: z.string().nullable().default(null),
	displayName: z.string().optional(),
	role: z.enum(['staff', 'admin']),
	status: UserStatus,
	/** Whether a PIN credential is currently set (drives Security Settings UI). */
	pinConfigured: z.boolean().default(false),
	preferredLoginMethod: PreferredLoginMethod.default('password'),
	adminProfile: AdminProfile.optional(),
	lastLoginAt: IsoDateTime.nullable().default(null),
	createdAt: IsoDateTime.optional(),
});
export type AdminUserProfile = z.infer<typeof AdminUserProfile>;

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
	role: z.enum(['staff', 'admin']),
	permissions: z.array(z.string()).optional(),
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
