import {
	OAuthProviderUnavailableError,
	OAuthTokenInvalidError,
	type OAuthVerificationInput,
	type OAuthVerifierPort,
	type VerifiedOAuthIdentity,
} from '@saha-textile/core-domain';
import { OAuth2Client } from 'google-auth-library';

/**
 * Google ID-token verification, at the edge.
 *
 * Uses `google-auth-library`, which is Google's own recommendation for this job — it fetches
 * and caches Google's signing keys and checks the signature, `iss`, `aud` and `exp` for us.
 * Hand-rolling JWKS handling here would mean owning key rotation, and getting that subtly
 * wrong looks exactly like working.
 *
 * ## What the library does NOT check, and this adapter must
 *
 * `verifyIdToken` proves the token is a genuine, unexpired Google token issued for our client.
 * It says nothing about whether it is the token we are currently expecting, or whether the
 * address inside it has been confirmed. So:
 *
 * - **`nonce`** — compared against the one we minted and stored. Without this a valid token
 *   captured from another session could be replayed into ours; the signature would still pass,
 *   because the signature was never the thing in question.
 * - **`email_verified`** — Google can return an address it has not confirmed. Treating those
 *   as proof would let somebody attach an unverified address to an account.
 * - **`sub` present** — the identity key. A token without one is not an identity.
 *
 * Nothing the browser sent alongside the credential is read. The profile comes out of the
 * verified payload or it does not exist.
 */
export class GoogleIdTokenVerifier implements OAuthVerifierPort {
	readonly provider = 'google' as const;

	private readonly client: OAuth2Client;

	constructor(private readonly clientId: string | undefined) {
		// Constructed once: the library caches Google's public keys on the instance, so a new
		// client per request would refetch them and add a network round trip to every login.
		this.client = new OAuth2Client();
	}

	async verify(input: OAuthVerificationInput): Promise<VerifiedOAuthIdentity> {
		// Fail closed. A missing client id cannot be defaulted, because `audience` is the check
		// that proves the token was minted for US and not for some other site the user also
		// signed into with Google.
		if (!this.clientId) throw new OAuthProviderUnavailableError('google');

		let payload;
		try {
			const ticket = await this.client.verifyIdToken({
				idToken: input.credential,
				audience: this.clientId,
			});
			payload = ticket.getPayload();
		} catch (error) {
			// The library's message names the failing claim, which is useful in a log and
			// dangerous in a response — a caller learning WHY a token was rejected learns how to
			// build a better one. The public refusal stays `oauth_token_invalid`.
			throw new OAuthTokenInvalidError('google', error instanceof Error ? error.message : 'verification failed');
		}

		if (!payload) throw new OAuthTokenInvalidError('google', 'token carried no payload');
		if (!payload.sub) throw new OAuthTokenInvalidError('google', 'token carried no subject');

		// Compared even when we expected none: a token arriving with a nonce we did not issue is
		// as wrong as one missing the nonce we did.
		if ((input.expectedNonce ?? null) !== (payload.nonce ?? null)) {
			throw new OAuthTokenInvalidError('google', 'nonce mismatch');
		}

		const emailVerified = payload.email_verified === true;

		return {
			provider: 'google',
			subject: payload.sub,
			// An unverified address is dropped rather than passed along unverified. Carrying it
			// with a false flag invites a later caller to read the value and forget the flag.
			email: emailVerified ? (payload.email ?? null) : null,
			emailVerified,
			displayName: payload.name ?? null,
		};
	}
}
