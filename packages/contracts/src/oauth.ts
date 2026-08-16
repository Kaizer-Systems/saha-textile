import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { PendingSignupState } from './signup';
import { SessionInfo } from './session';
import { Customer } from './customer';

/**
 * Storefront social identity (`DEC-SIGNUP-VERIFICATION`, owner lock 2026-08-16).
 *
 * Storefront only. There is no admin equivalent and there must never be one — a compromised
 * social account must not open the back office (security matrix: "Admin social login — DO NOT
 * BUILD").
 *
 * ## Identity is the subject, never the email
 *
 * An identity is `provider + stable provider subject`: Google's `sub`, Facebook's app-scoped
 * id. Email is a mutable attribute of a person, not a name for them, and treating it as the
 * key is how accounts get merged into each other. Accounts are never linked automatically on
 * a matching address; linking is a deliberate act from the account page, with step-up.
 *
 * ## The Facebook id is scoped to the APP
 *
 * The same person has a DIFFERENT app-scoped id under a different Meta app. Ids collected
 * against the development app therefore do not survive to a production app — a migration
 * concern to plan for, not a surprise to discover.
 */
export const OAuthProvider = z.enum(['google', 'facebook']);
export type OAuthProvider = z.infer<typeof OAuthProvider>;

/**
 * `POST /auth/storefront/oauth/state`
 *
 * Mints the single-use, short-lived state row the provider round-trip is bound to, reusing
 * the existing `oauthStates` collection and its atomic `consume`. The nonce is returned only
 * for Google, whose ID token carries it back for us to compare; Meta has no nonce concept, so
 * its state exists purely to bind the callback to this browser.
 */
export const OAuthStartRequest = z.object({
	provider: OAuthProvider,
	/** Carried through the round-trip so a guest cart survives a social signup. */
	guestCartId: Id.optional(),
});
export type OAuthStartRequest = z.infer<typeof OAuthStartRequest>;

export const OAuthStartResponse = z.object({
	stateId: z.string().min(1),
	/** Google only — passed to `google.accounts.id.initialize({ nonce })`. */
	nonce: z.string().min(1).nullable().default(null),
	expiresAt: IsoDateTime,
});
export type OAuthStartResponse = z.infer<typeof OAuthStartResponse>;

/**
 * `POST /auth/storefront/oauth/google`
 *
 * `credential` is the ID token Google Identity Services hands the browser. It is verified
 * server-side against Google's keys — signature, issuer, audience, expiry, nonce, subject and
 * `email_verified`. Nothing the browser says about the user is trusted; the claims are read
 * from the token after it is proven, never from a profile object the page could edit.
 */
export const GoogleVerifyRequest = z.object({
	stateId: z.string().min(1),
	credential: z.string().min(1),
	/**
	 * The nonce this browser was handed by `oauth/state`, echoed back.
	 *
	 * The state row stores only a HASH of it, so the plaintext cannot be recovered server-side —
	 * the caller returns it and the server checks the hash matches, then the adapter compares it
	 * against the value inside the signed token. A captured token from another session fails,
	 * because its nonce belongs to a state we did not mint for this browser.
	 */
	nonce: z.string().min(1).nullable().optional(),
});
export type GoogleVerifyRequest = z.infer<typeof GoogleVerifyRequest>;

/**
 * `POST /auth/storefront/oauth/facebook`
 *
 * `accessToken` is the short-lived user token from the Meta JS SDK. It is verified through
 * Graph `debug_token` using an app access token built server-side from the app secret, which
 * is what proves the token was issued for OUR app and is neither expired nor revoked.
 *
 * Meta's email is never treated as proof. Whatever it returns is a PREFILL, and the Facebook
 * path always requires our own email OTP — the same reasoning that refuses to trust Meta on a
 * phone number, applied to the field Meta is weaker on.
 */
export const FacebookVerifyRequest = z.object({
	stateId: z.string().min(1),
	accessToken: z.string().min(1),
});
export type FacebookVerifyRequest = z.infer<typeof FacebookVerifyRequest>;

/**
 * What a verified provider token resolved to.
 *
 * Exactly one of `session` or `pendingSignup` is present, and which one is the entire
 * decision: a known identity signs in, an unknown one lands in the signup form with whatever
 * the provider supplied prefilled and still editable.
 *
 * A matching EMAIL never produces a session. That is the "never auto-link" rule in wire form:
 * an unknown subject whose email happens to match an existing account is a signup that will be
 * refused at finalisation, not a silent takeover.
 */
export const OAuthVerifyResponse = z.object({
	outcome: z.enum(['signed_in', 'signup_required']),
	customer: Customer.nullable().default(null),
	session: SessionInfo.nullable().default(null),
	pendingSignup: PendingSignupState.nullable().default(null),
});
export type OAuthVerifyResponse = z.infer<typeof OAuthVerifyResponse>;

/** One provider row on the account's login-methods screen. */
export const LinkedIdentity = z.object({
	provider: OAuthProvider,
	connected: z.boolean(),
	/** Bounded snapshot for display only; never used to find or match an account. */
	email: z.string().nullable().default(null),
	linkedAt: IsoDateTime.nullable().default(null),
});
export type LinkedIdentity = z.infer<typeof LinkedIdentity>;

/**
 * `GET /auth/storefront/login-methods`
 *
 * Everything the account screen renders. `passwordSet` is false for social signups until the
 * customer deliberately sets one, which is why the screen offers "Set" rather than "Change".
 */
export const LoginMethodsResponse = z.object({
	passwordSet: z.boolean(),
	emailVerified: z.boolean(),
	phoneVerified: z.boolean(),
	identities: z.array(LinkedIdentity),
	/**
	 * Whether a password is required to prove freshness, or an OTP will be needed instead.
	 * A password is preferred wherever one exists: it is free, and it is stronger than a code
	 * sent to a channel an attacker holding the session may also be able to read.
	 */
	stepUpMethod: z.enum(['password', 'otp']),
});
export type LoginMethodsResponse = z.infer<typeof LoginMethodsResponse>;

/**
 * `POST /auth/storefront/oauth/connect`
 *
 * Requires an active session AND recent credential proof (security matrix row 70). A stolen
 * session must not be able to bolt a permanent new way in onto somebody's account.
 */
export const ConnectIdentityRequest = z.object({
	provider: OAuthProvider,
	stateId: z.string().min(1),
	/** Google ID token or Facebook access token, per provider. */
	credential: z.string().min(1),
	nonce: z.string().min(1).nullable().optional(),
	/**
	 * Freshness proof — a password when one is set, otherwise the step-up code itself.
	 *
	 * The code is presented HERE rather than exchanged for a token first. An intermediate token
	 * would need its own storage, its own expiry and its own single-use rule, all to carry a
	 * proof across one extra round trip. Presenting the code directly removes the token, the
	 * storage and the replay window it would have opened.
	 */
	password: z.string().min(1).max(256).optional(),
	otpCode: z
		.string()
		.regex(/^\d{6}$/)
		.optional(),
});
export type ConnectIdentityRequest = z.infer<typeof ConnectIdentityRequest>;

/**
 * `POST /auth/storefront/oauth/disconnect`
 *
 * Refused when it would remove the last way back in. The check is explicit rather than
 * inferred: today every account carries a verified email and phone so an OTP always remains,
 * but a later change to that assumption must break this rule loudly instead of quietly
 * turning disconnect into self-lockout.
 */
export const DisconnectIdentityRequest = z.object({
	provider: OAuthProvider,
	password: z.string().min(1).max(256).optional(),
	otpCode: z
		.string()
		.regex(/^\d{6}$/)
		.optional(),
});
export type DisconnectIdentityRequest = z.infer<typeof DisconnectIdentityRequest>;

/**
 * `POST /auth/storefront/step-up/request`
 *
 * The channel is the CALLER's choice, and that is a cost control as much as a courtesy:
 * linking a social account is not essential work, so the customer picks email or SMS before
 * anything is generated rather than having credits spent on their behalf.
 */
export const StepUpRequestBody = z.object({ channel: z.enum(['email', 'sms']) });
export type StepUpRequestBody = z.infer<typeof StepUpRequestBody>;
