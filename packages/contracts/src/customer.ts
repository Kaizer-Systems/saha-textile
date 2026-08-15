import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Account lifecycle status (auth plan §7.1). Shared by customers and operators.
 * Non-`active` accounts cannot receive new sessions.
 */
export const UserStatus = z.enum(['active', 'pending', 'disabled', 'locked', 'deleted']);
export type UserStatus = z.infer<typeof UserStatus>;

/**
 * Customer primary key (`DEC-ACCOUNT-SEPARATION` D5).
 *
 * Prefix makes a cross-population id substitution fail on sight. Legacy `user_…` rows
 * are rewritten by the split migration; audit may still see them until then.
 */
export const CustomerId = z.string().min(1).regex(/^cus_/, 'must start with cus_');
export type CustomerId = z.infer<typeof CustomerId>;

/** Login identity providers. `phone_otp` and `passkey` are future seams (schema-only, no launch implementation). */
export const AuthProvider = z.enum(['password', 'email_otp', 'phone_otp', 'google', 'facebook', 'passkey']);
export type AuthProvider = z.infer<typeof AuthProvider>;

/** One of possibly several auth identities linked to a customer. */
export const AuthIdentity = z.object({
	provider: AuthProvider,
	/** Stable provider subject: Google `sub`, Facebook user id, normalized email/phone. */
	providerId: z.string().optional(),
	email: z.email().optional(),
});
export type AuthIdentity = z.infer<typeof AuthIdentity>;

/**
 * Named saved address (`DEC-ACCOUNT-SEPARATION` D9).
 *
 * `label` is the Home/Office name. Billing-vs-shipping policy flags are deliberately
 * absent — those remain open under `DEC-ADDRESS`.
 */
export const Address = z.object({
	id: Id,
	/** Human label such as Home or Office. */
	label: z.string().min(1).max(80).optional(),
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
 * Consent snapshot kept on the customer (latest effective consent). Granular
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
 * Reserved contact sub-document. No route writes these in the account-separation
 * task; the array exists so the customer collection is not reshaped again shortly.
 */
export const CustomerContact = z.object({
	id: Id,
	label: z.string().min(1).max(80),
	fullName: z.string().min(1).max(120).optional(),
	email: z.email().optional(),
	phone: z.string().max(32).optional(),
});
export type CustomerContact = z.infer<typeof CustomerContact>;

/**
 * Reserved saved-size sub-document. Keys inside `values` are not locked
 * (`DEC-ADDON-MEASUREMENTS` stays open).
 */
export const CustomerSavedSize = z.object({
	id: Id,
	label: z.string().min(1).max(80),
	values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});
export type CustomerSavedSize = z.infer<typeof CustomerSavedSize>;

/**
 * Reserved measurement-profile sub-document for blouse/salwaar tailoring.
 * Exact measurement keys stay open under `DEC-ADDON-MEASUREMENTS`.
 */
export const CustomerMeasurementProfile = z.object({
	id: Id,
	label: z.string().min(1).max(80),
	measurements: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});
export type CustomerMeasurementProfile = z.infer<typeof CustomerMeasurementProfile>;

/**
 * Public customer shape (API contract). Secret/internal fields (password hashes,
 * token versions, lockout counters) live only in the DB layer and never appear here.
 *
 * No `role` field (`DEC-ACCOUNT-SEPARATION` D7). Operator fields live on `AdminUser`.
 */
export const Customer = z.object({
	id: CustomerId,
	email: z.email().nullable().default(null),
	emailVerified: z.boolean().default(false),
	/** Collected at checkout/address stage, optional (owner lock 2026-06-29) — not at registration. */
	phone: z.string().nullable().default(null),
	phoneVerified: z.boolean().default(false),
	displayName: z.string().optional(),
	status: UserStatus.default('active'),
	identities: z.array(AuthIdentity).default([]),
	addresses: z.array(Address).default([]),
	/** Reserved; empty until a contacts surface writes them. */
	contacts: z.array(CustomerContact).default([]),
	/** Reserved; empty until a sizes surface writes them. */
	savedSizes: z.array(CustomerSavedSize).default([]),
	/** Reserved; empty until a measurement-profile surface writes them. */
	measurementProfiles: z.array(CustomerMeasurementProfile).default([]),
	guestCartId: Id.nullable().default(null),
	consent: ConsentRecord.optional(),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type Customer = z.infer<typeof Customer>;
