import {
	OAuthProviderUnavailableError,
	OAuthTokenInvalidError,
	type OAuthVerificationInput,
	type OAuthVerifierPort,
	type VerifiedOAuthIdentity,
} from '@saha-textile/core-domain';

/**
 * Meta access-token verification, at the edge.
 *
 * No SDK. Meta ships no server library worth the dependency for two HTTP calls, and `fetch` is
 * built into Node 24 — adding a package here would be surface area for nothing.
 *
 * ## Why a token has to be debugged rather than merely used
 *
 * A Facebook access token is an opaque string. Presented to Graph it will happily identify its
 * owner — but a token minted for a DIFFERENT app will do that too, which is the whole attack:
 * an attacker builds their own Meta app, gets a victim to sign into it, and posts that token
 * here. Nothing about using it would reveal the substitution.
 *
 * `GET /debug_token` is what closes it. Called with an APP access token built from our own app
 * id and secret, it reports which app the token was issued for, whether it is still valid, and
 * whose it is. So this adapter checks, in order:
 *
 * - **`is_valid`** — covers revocation, which no expiry check would catch: a user who removes
 *   the app in their Facebook settings leaves a token that is unexpired and dead.
 * - **`app_id` equals ours** — the substitution check above.
 * - **`expires_at`** — belt and braces alongside `is_valid`.
 * - **`user_id` present** — the identity key, app-scoped and stable for this app.
 *
 * ## Email is never proof here
 *
 * Meta has no `email_verified` equivalent, and it returns an address only when the user
 * granted the permission and has one on file. `emailVerified` is therefore ALWAYS false from
 * this adapter, even when an address comes back. The address is a prefill for the signup form
 * and nothing more; the Facebook path earns its own OTP either way. Reporting anything else
 * would push a judgement call into every caller, and one of them would eventually get it wrong.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

interface DebugTokenData {
	app_id?: string;
	is_valid?: boolean;
	expires_at?: number;
	user_id?: string;
	scopes?: string[];
	error?: { message?: string };
}

export class FacebookTokenVerifier implements OAuthVerifierPort {
	readonly provider = 'facebook' as const;

	constructor(
		private readonly appId: string | undefined,
		private readonly appSecret: string | undefined,
		/** Injected so tests exercise this class rather than a rewritten copy of it. */
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	async verify(input: OAuthVerificationInput): Promise<VerifiedOAuthIdentity> {
		// Fail closed: without the secret the app access token cannot be built, and without that
		// the app-binding check cannot run — which would leave us accepting any Meta token at all.
		if (!this.appId || !this.appSecret) throw new OAuthProviderUnavailableError('facebook');

		const data = await this.debugToken(input.credential);

		if (data.error?.message) throw new OAuthTokenInvalidError('facebook', data.error.message);
		if (data.is_valid !== true) throw new OAuthTokenInvalidError('facebook', 'token is not valid or was revoked');
		if (data.app_id !== this.appId)
			throw new OAuthTokenInvalidError('facebook', 'token was issued for another app');
		if (typeof data.expires_at === 'number' && data.expires_at !== 0 && data.expires_at * 1000 <= Date.now()) {
			throw new OAuthTokenInvalidError('facebook', 'token has expired');
		}
		if (!data.user_id) throw new OAuthTokenInvalidError('facebook', 'token carried no user id');

		const profile = await this.fetchProfile(input.credential);

		return {
			provider: 'facebook',
			// App-scoped: the same person carries a different id under a different Meta app, so
			// ids collected against the development app do not survive to a production one.
			subject: data.user_id,
			email: profile.email ?? null,
			// Deliberately unconditional — see the class comment.
			emailVerified: false,
			displayName: profile.name ?? null,
		};
	}

	/**
	 * The app access token is `{app-id}|{app-secret}`, and it must never leave the server.
	 * It is a Meta-documented format, not a secret we invented, but it carries the app secret
	 * literally — so it is built here, used once, and never logged or returned.
	 */
	private async debugToken(token: string): Promise<DebugTokenData> {
		const appAccessToken = `${this.appId}|${this.appSecret}`;
		const url = `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appAccessToken)}`;

		const response = await this.request(url, 'debug_token');
		const body = (await response.json()) as { data?: DebugTokenData };
		if (!body.data) throw new OAuthTokenInvalidError('facebook', 'debug_token returned no data');
		return body.data;
	}

	/**
	 * The minimum identity fields, and no more.
	 *
	 * `id,email,name` only. Requesting a broader field set would collect data the account model
	 * has nowhere to put and the customer never agreed to share — minimum scope is an owner lock,
	 * and it applies to what we ASK for, not only to what we were granted.
	 */
	private async fetchProfile(token: string): Promise<{ email?: string; name?: string }> {
		const url = `${GRAPH}/me?fields=id,email,name&access_token=${encodeURIComponent(token)}`;
		const response = await this.request(url, 'profile');
		return (await response.json()) as { email?: string; name?: string };
	}

	/**
	 * A provider outage is a REFUSAL, never a pass.
	 *
	 * If Graph is unreachable we do not know whose token this is, and "we could not check" must
	 * never resolve the same way as "we checked and it was fine". Fail closed.
	 */
	private async request(url: string, what: string): Promise<Response> {
		let response: Response;
		try {
			response = await this.fetchImpl(url, { method: 'GET' });
		} catch (error) {
			throw new OAuthTokenInvalidError(
				'facebook',
				`${what} request failed: ${error instanceof Error ? error.message : 'network error'}`,
			);
		}
		if (!response.ok) throw new OAuthTokenInvalidError('facebook', `${what} responded ${response.status}`);
		return response;
	}
}
