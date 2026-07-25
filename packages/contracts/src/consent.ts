import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Granular cookie/privacy consent categories (owner lock 2026-06-29: self-hosted,
 * no paid CMP, per-category toggles). `necessary` is always true and not user-disableable.
 */
export const ConsentCategories = z.object({
	necessary: z.literal(true).default(true),
	functional: z.boolean().default(false),
	analytics: z.boolean().default(false),
	targeting: z.boolean().default(false),
	marketing: z.boolean().default(false),
	promotional: z.boolean().default(false),
});
export type ConsentCategories = z.infer<typeof ConsentCategories>;

/** Which surface recorded the consent. */
export const ConsentSource = z.enum(['storefront', 'admin']);
export type ConsentSource = z.infer<typeof ConsentSource>;

/**
 * Consent history entity (`consentEvents` collection). Append-only; the latest
 * event per user/guest is the effective consent. Hashes only — never raw IP/UA.
 */
export const ConsentEvent = z.object({
	id: Id,
	userId: Id.nullable().default(null),
	guestId: Id.nullable().default(null),
	categories: ConsentCategories,
	/** Version of the privacy/cookie policy the user accepted. */
	policyVersion: z.string().min(1),
	source: ConsentSource,
	ipHash: z.string().nullable().default(null),
	userAgentHash: z.string().nullable().default(null),
	createdAt: IsoDateTime,
});
export type ConsentEvent = z.infer<typeof ConsentEvent>;

/** `POST /privacy/consent` request — records a new consent event for the current user/guest. */
export const ConsentUpdateRequest = z.object({
	categories: ConsentCategories,
	policyVersion: z.string().min(1),
});
export type ConsentUpdateRequest = z.infer<typeof ConsentUpdateRequest>;

/** `GET /privacy/consent` response — current effective consent (or defaults when none recorded). */
export const ConsentStateResponse = z.object({
	categories: ConsentCategories,
	policyVersion: z.string().nullable().default(null),
	updatedAt: IsoDateTime.nullable().default(null),
});
export type ConsentStateResponse = z.infer<typeof ConsentStateResponse>;
