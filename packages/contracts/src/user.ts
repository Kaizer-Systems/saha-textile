import { z } from 'zod';

import { Id, IsoDateTime } from './common';

export const UserRole = z.enum(['customer', 'staff', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

/** Account lifecycle status (auth plan §7.1). Non-`active` users cannot receive new sessions. */
export const UserStatus = z.enum(['active', 'pending', 'disabled', 'locked', 'deleted']);
export type UserStatus = z.infer<typeof UserStatus>;

/** Login identity providers. `phone_otp` and `passkey` are future seams (schema-only, no launch implementation). */
export const AuthProvider = z.enum(['password', 'email_otp', 'phone_otp', 'google', 'facebook', 'passkey']);
export type AuthProvider = z.infer<typeof AuthProvider>;

/** One of possibly several auth identities linked to a user. */
export const AuthIdentity = z.object({
	provider: AuthProvider,
	/** Stable provider subject: Google `sub`, Facebook user id, normalized email/phone. */
	providerId: z.string().optional(),
	email: z.email().optional(),
});
export type AuthIdentity = z.infer<typeof AuthIdentity>;

export const Address = z.object({
	id: Id,
	fullName: z.string().min(1),
	line1: z.string().min(1),
	line2: z.string().optional(),
	city: z.string().min(1),
	state: z.string().optional(),
	postalCode: z.string().min(1),
	country: z.string().min(2),
	phone: z.string().optional(),
	isDefault: z.boolean().default(false),
});
export type Address = z.infer<typeof Address>;

/**
 * Consent snapshot kept on the user (latest effective consent). Granular
 * categories per the GDPR lock 2026-06-29; full history lives in `consentEvents`
 * (see `consent.ts`). `necessary` is always on.
 */
export const ConsentRecord = z.object({
	necessary: z.boolean().default(true),
	functional: z.boolean().default(false),
	analytics: z.boolean().default(false),
	targeting: z.boolean().default(false),
	marketing: z.boolean().default(false),
	promotional: z.boolean().default(false),
	policyVersion: z.string().optional(),
	at: IsoDateTime,
});
export type ConsentRecord = z.infer<typeof ConsentRecord>;

/**
 * Public user shape (API contract). Secret/internal fields (password/PIN hashes,
 * token/permission versions, risk flags, lockout counters) live only in the DB
 * layer and never appear here. Admin-facing profile fields are in
 * `AdminUserProfile` (`admin-auth.ts`), which is still sanitized.
 */
export const User = z.object({
	id: Id,
	email: z.email().nullable().default(null),
	emailVerified: z.boolean().default(false),
	/** Collected at checkout/address stage, optional (owner lock 2026-06-29) — not at registration. */
	phone: z.string().nullable().default(null),
	phoneVerified: z.boolean().default(false),
	displayName: z.string().optional(),
	role: UserRole.default('customer'),
	status: UserStatus.default('active'),
	identities: z.array(AuthIdentity).default([]),
	addresses: z.array(Address).default([]),
	guestCartId: Id.nullable().default(null),
	consent: ConsentRecord.optional(),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type User = z.infer<typeof User>;
