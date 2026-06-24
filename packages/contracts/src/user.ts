import { z } from 'zod';

import { Id, IsoDateTime } from './common';

export const UserRole = z.enum(['customer', 'staff', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

export const AuthProvider = z.enum(['password', 'email_otp', 'google', 'facebook']);
export type AuthProvider = z.infer<typeof AuthProvider>;

/** One of possibly several auth identities linked to a user. */
export const AuthIdentity = z.object({
	provider: AuthProvider,
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

/** GDPR/consent record with timestamp. */
export const ConsentRecord = z.object({
	necessary: z.boolean().default(true),
	analytics: z.boolean().default(false),
	marketing: z.boolean().default(false),
	at: IsoDateTime,
});
export type ConsentRecord = z.infer<typeof ConsentRecord>;

/**
 * Public user shape (API contract). Secret fields (password hash, internal
 * flags) live only in the DB layer and never appear here.
 */
export const User = z.object({
	id: Id,
	email: z.email().nullable().default(null),
	emailVerified: z.boolean().default(false),
	displayName: z.string().optional(),
	role: UserRole.default('customer'),
	identities: z.array(AuthIdentity).default([]),
	addresses: z.array(Address).default([]),
	guestCartId: Id.nullable().default(null),
	consent: ConsentRecord.optional(),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type User = z.infer<typeof User>;
