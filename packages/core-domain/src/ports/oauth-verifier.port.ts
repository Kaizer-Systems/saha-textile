import type { OAuthProvider } from '@saha-textile/contracts';

/**
 * Provider-token verification, expressed without naming a provider.
 *
 * ## Why this shape, and not a Google client behind an interface
 *
 * Core decides what a verified identity MEANS — whether it signs someone in, whether it may
 * be linked, what a missing email implies. It must not learn how Google signs a JWT or which
 * Graph endpoint reports a Meta token's app binding. Those are edge concerns that change on
 * the provider's schedule, and the dependency rule points inward: replacing Google Identity
 * Services with something else must touch one adapter and one DI binding, never a use case.
 *
 * So the port takes an opaque string and returns a settled fact. No SDK types, no raw provider
 * payload, no HTTP. An adapter that leaked `TokenPayload` or a Graph response through here
 * would put the provider's vocabulary into the domain, which is exactly the coupling the
 * hexagon exists to prevent.
 */

/**
 * A provider identity that has been verified — every field below is one the PROVIDER
 * asserted after cryptographic or API proof, never one the browser supplied.
 *
 * That distinction is the point of the type. A page can put anything in a JavaScript object
 * and post it; the only trustworthy profile is the one read out of a token after its signature,
 * issuer, audience and expiry have been checked, or out of an API response fetched with a
 * token whose app binding has been confirmed.
 */
export interface VerifiedOAuthIdentity {
	provider: OAuthProvider;
	/**
	 * The stable provider subject — Google `sub`, Facebook app-scoped id.
	 *
	 * The identity key, and never the email. An email is a mutable attribute of a person;
	 * keying on it is how two accounts silently become one. Note that a Facebook id is scoped
	 * to the APP, so the same person carries a different id under a different Meta app.
	 */
	subject: string;
	/** Null when the provider supplied none — routine for Facebook, not an error. */
	email: string | null;
	/**
	 * Whether the PROVIDER asserts the address is verified.
	 *
	 * True only for Google's `email_verified`. The Facebook adapter reports `false`
	 * unconditionally, even when Meta returns an address: Meta offers no equivalent claim, and
	 * a value we cannot check is indistinguishable from one we should not trust. The
	 * consequence is deliberate — the Facebook path always earns its own OTP.
	 */
	emailVerified: boolean;
	displayName: string | null;
}

/** What an adapter is given. `expectedNonce` is Google-only; Meta has no nonce concept. */
export interface OAuthVerificationInput {
	credential: string;
	expectedNonce: string | null;
}

/**
 * One provider's verifier.
 *
 * Implementations REJECT rather than return a degraded result: a token whose audience, issuer,
 * signature, expiry, nonce or app binding fails is not a weaker identity, it is not an
 * identity. Returning something partial would leave the decision to a caller that has less
 * information than the adapter did.
 */
export interface OAuthVerifierPort {
	readonly provider: OAuthProvider;
	verify(input: OAuthVerificationInput): Promise<VerifiedOAuthIdentity>;
}

/** Raised when a provider is unconfigured. Fails closed — never a silent pass-through. */
export class OAuthProviderUnavailableError extends Error {
	constructor(readonly provider: OAuthProvider) {
		super(`OAuth provider ${provider} is not configured`);
		this.name = 'OAuthProviderUnavailableError';
	}
}

/** Raised when a credential fails any verification step. Deliberately says which, to LOGS only. */
export class OAuthTokenInvalidError extends Error {
	constructor(
		readonly provider: OAuthProvider,
		reason: string,
	) {
		super(`OAuth token rejected for ${provider}: ${reason}`);
		this.name = 'OAuthTokenInvalidError';
	}
}
