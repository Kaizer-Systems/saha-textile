import { z } from 'zod';

import { OtpCode } from './auth';
import { IsoDateTime } from './common';
import { Address } from './customer';

/**
 * Storefront self-service account contracts.
 *
 * ## Why these are not the admin ones
 *
 * `admin-customer.ts` already carries address bodies, and the JSON they accept is nearly the
 * same. They are kept apart anyway, because the two surfaces answer different questions and are
 * free to diverge without either one quietly changing the other:
 *
 *   - the CRM collects on someone's behalf and insists on a reachable phone and a state, because
 *     an operator typing a half-address is a support call later;
 *   - a shopper is entering their own delivery address and may legitimately have neither to hand
 *     at that moment. Forcing the CRM's stricter rule onto checkout would block a real order.
 *
 * There is no customer id in any of these. It comes from the SESSION, never from the request —
 * see `storefront-addresses.controller.ts`.
 */

/** `POST /storefront/account/addresses` — the server assigns `id`. */
export const CreateOwnAddressRequest = Address.omit({ id: true });
export type CreateOwnAddressRequest = z.infer<typeof CreateOwnAddressRequest>;

/** `PATCH /storefront/account/addresses/:addressId` — every field optional. */
export const UpdateOwnAddressRequest = Address.omit({ id: true }).partial();
export type UpdateOwnAddressRequest = z.infer<typeof UpdateOwnAddressRequest>;

/**
 * `PATCH /storefront/account/profile`
 *
 * DISPLAY NAME ONLY, deliberately.
 *
 * Email and phone are login credentials under `DEC-SIGNUP-VERIFICATION`, and the security matrix
 * requires an address change to carry recent credential proof, mint its own verification token,
 * keep the old address live until the new one is proven, and write an audit entry. None of that
 * is expressible as a field on a patch body, and accepting either here would let a stolen
 * session move an account's recovery channel with one request — the exact move an attacker makes
 * first. They get the dedicated flow below instead.
 */
export const UpdateOwnProfileRequest = z.object({
	displayName: z.string().min(1).max(120),
});
export type UpdateOwnProfileRequest = z.infer<typeof UpdateOwnProfileRequest>;

/* -------------------------------------------------------------------------------------------- *
 * Changing the email or phone on an account
 * -------------------------------------------------------------------------------------------- */

/**
 * Which login credential a pending change is for.
 *
 * The field is a SERVER fact once a change is started — it is read off the pending record, never
 * off the confirming request. Same reason `FinaliseSignupRequest` carries no identifiers: a
 * client that can name what it is confirming can name something it did not prove.
 */
export const ContactField = z.enum(['email', 'phone']);
export type ContactField = z.infer<typeof ContactField>;

/**
 * Freshness proof, exactly as `ConnectIdentityRequest` takes it.
 *
 * Which one applies is decided by whether the account has a password, and that is the server's
 * fact — a caller offering the other kind is refused rather than accommodated. Without this a
 * stolen session could move the account's recovery channel, which is the first move an attacker
 * makes and the one that turns a temporary compromise into a permanent one.
 */
const StepUpProof = {
	password: z.string().min(1).max(256).optional(),
	otpCode: OtpCode.optional(),
};

/** `POST /storefront/account/contact/email` — starts a change; the address does not move yet. */
export const StartEmailChangeRequest = z.object({
	newEmail: z.email(),
	...StepUpProof,
});
export type StartEmailChangeRequest = z.infer<typeof StartEmailChangeRequest>;

/** `POST /storefront/account/contact/phone` — starts a change; the number does not move yet. */
export const StartPhoneChangeRequest = z.object({
	newPhone: z.string().trim().min(6).max(20),
	...StepUpProof,
});
export type StartPhoneChangeRequest = z.infer<typeof StartPhoneChangeRequest>;

/**
 * `POST /storefront/account/contact/confirm` — spends the code and swaps the value.
 *
 * ONE route for both fields, and no field in the body. Which credential is moving, and to what,
 * are read from the pending record the server is holding. The brief sketched a confirm route per
 * field; collapsing them removes the only parameter a caller could have lied about.
 */
export const ConfirmContactChangeRequest = z.object({
	code: OtpCode,
});
export type ConfirmContactChangeRequest = z.infer<typeof ConfirmContactChangeRequest>;

/**
 * What the browser may know about a change in flight.
 *
 * The new value is echoed because the person typed it and is waiting for a code there; the
 * remaining send budget and the resend time drive the countdown. Nothing here reveals anything
 * about any OTHER account — see `ContactChangeRefusal`.
 */
export const PendingContactChangeState = z.object({
	field: ContactField,
	newValue: z.string(),
	sendsRemaining: z.number().int().nonnegative(),
	/** Null when a resend may be requested immediately. */
	resendAvailableAt: IsoDateTime.nullable(),
	expiresAt: IsoDateTime,
});
export type PendingContactChangeState = z.infer<typeof PendingContactChangeState>;

/** `GET /storefront/account/contact` — the change in flight, or nothing. */
export const PendingContactChangeResponse = z.object({
	pending: PendingContactChangeState.nullable(),
});
export type PendingContactChangeResponse = z.infer<typeof PendingContactChangeResponse>;

/**
 * Stable refusals for the contact-change flow, carried through `issues[].code`.
 *
 * `contact_in_use` is deliberately absent from the START of a change: refusing there would answer
 * "is this address registered?" for any value a caller cares to type, which is the enumeration
 * the whole signup flow is shaped to avoid. A start against a taken value is ACCEPTED and simply
 * never delivered — the send budget still moves, so the two outcomes are indistinguishable.
 *
 * It exists for CONFIRMATION, where the caller has proven control of the value. That is the same
 * disclosure rule `SignupService.verifyOtp` follows: before proof, say nothing; after it, saying
 * so is safe and is the only way to explain the refusal.
 */
export const ContactChangeRefusal = z.enum([
	/** No change in flight, or the one there has expired. */
	'contact_change_expired',
	/** The new value is what the account already has. Not a disclosure — it is the caller's own. */
	'contact_change_unchanged',
	/** Send budget spent, or a resend asked for before the backoff elapsed. */
	'otp_send_limit_reached',
	/** Wrong or expired code. */
	'otp_invalid',
	/** Proven at confirmation to belong to another account. See the note above. */
	'contact_in_use',
]);
export type ContactChangeRefusal = z.infer<typeof ContactChangeRefusal>;
