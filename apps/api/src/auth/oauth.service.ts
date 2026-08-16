import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
	OAuthProviderUnavailableError,
	type AuthIdentityRepository,
	type OAuthStateRepository,
	type OAuthVerifierPort,
	type VerifiedOAuthIdentity,
} from '@saha-textile/core-domain';
import type { OAuthProvider } from '@saha-textile/contracts';
import { FacebookTokenVerifier, GoogleIdTokenVerifier } from '@saha-textile/adapters-auth';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AUTH_IDENTITY_REPOSITORY, OAUTH_STATE_REPOSITORY } from '../infra/tokens';
import { AuthService } from './auth.service';

/**
 * The provider round-trip (`DEC-SIGNUP-VERIFICATION`).
 *
 * Owns the state that binds a provider callback to the browser that started it, and delegates
 * every token check to an adapter. No provider vocabulary appears here: this service knows
 * that a credential either resolves to a verified identity or does not.
 */

/** Short — a state exists only for the seconds between the button and the callback. */
const STATE_TTL_MS = 10 * 60_000;

export class OAuthStateInvalidError extends Error {
	constructor() {
		super('oauth_state_invalid');
		this.name = 'OAuthStateInvalidError';
	}
}

export class OAuthIdentityConflictError extends Error {
	constructor() {
		super('oauth_identity_conflict');
		this.name = 'OAuthIdentityConflictError';
	}
}

@Injectable()
export class OAuthService {
	private readonly verifiers: Record<OAuthProvider, OAuthVerifierPort>;

	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(OAUTH_STATE_REPOSITORY) private readonly states: OAuthStateRepository,
		@Inject(AUTH_IDENTITY_REPOSITORY) private readonly identities: AuthIdentityRepository,
		private readonly auth: AuthService,
	) {
		// Constructed once. The Google verifier caches Google's signing keys on its client, so a
		// per-request instance would add a key fetch to every social login.
		this.verifiers = {
			google: new GoogleIdTokenVerifier(config.oauth.googleClientId),
			facebook: new FacebookTokenVerifier(config.oauth.facebookAppId, config.oauth.facebookAppSecret),
		};
	}

	/** Whether a provider may be offered at all. Unconfigured is unavailable, never partial. */
	isConfigured(provider: OAuthProvider): boolean {
		return provider === 'google'
			? Boolean(this.config.oauth.googleClientId)
			: Boolean(this.config.oauth.facebookAppId && this.config.oauth.facebookAppSecret);
	}

	/**
	 * Mints the single-use state the round-trip is bound to.
	 *
	 * Only HASHES are stored. A database dump must not yield a usable state value, for the same
	 * reason password reset tokens are stored hashed — the row is a check, not a credential.
	 *
	 * The nonce is Google-only: its ID token carries the value back for us to compare, which is
	 * what makes a captured token from another session unusable here. Meta has no equivalent, so
	 * its state exists purely to bind the callback to this browser.
	 */
	async start(input: {
		provider: OAuthProvider;
		guestCartId?: string | null;
	}): Promise<{ stateId: string; nonce: string | null; expiresAt: string }> {
		if (!this.isConfigured(input.provider)) throw new OAuthProviderUnavailableError(input.provider);

		const stateId = `oas_${randomUUID()}`;
		const nonce = input.provider === 'google' ? `non_${randomUUID()}` : null;
		const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

		await this.states.create({
			id: `oa_${randomUUID()}`,
			provider: input.provider,
			audience: 'storefront',
			stateHash: this.auth.hash(stateId),
			nonceHash: nonce ? this.auth.hash(nonce) : null,
			codeVerifierHash: null,
			redirectAfterLogin: null,
			guestCartId: input.guestCartId ?? null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
			expiresAt,
			consumedAt: null,
		});

		return { stateId, nonce, expiresAt };
	}

	/**
	 * Consumes the state and verifies the credential.
	 *
	 * Order matters. The state is consumed FIRST and atomically, so a replayed callback is
	 * refused before a provider is ever contacted — otherwise an attacker could spend our Graph
	 * quota, and our credits, simply by resending an old request.
	 *
	 * The nonce is compared inside the adapter, against the value recovered here. The state row
	 * stores only its hash, so the plaintext nonce cannot be recovered from the database — which
	 * is why the caller hands back the nonce it was given and we check the hash matches.
	 */
	async verify(input: {
		provider: OAuthProvider;
		stateId: string;
		credential: string;
		nonce?: string | null;
	}): Promise<{ identity: VerifiedOAuthIdentity; guestCartId: string | null }> {
		if (!this.isConfigured(input.provider)) throw new OAuthProviderUnavailableError(input.provider);

		const state = await this.states.consume(this.auth.hash(input.stateId));
		if (!state) throw new OAuthStateInvalidError();
		if (state.provider !== input.provider) throw new OAuthStateInvalidError();
		if (Date.parse(state.expiresAt) <= Date.now()) throw new OAuthStateInvalidError();

		// A state that expected a nonce must be answered with the matching one.
		if (state.nonceHash) {
			if (!input.nonce || this.auth.hash(input.nonce) !== state.nonceHash) throw new OAuthStateInvalidError();
		}

		const identity = await this.verifiers[input.provider].verify({
			credential: input.credential,
			expectedNonce: input.nonce ?? null,
		});

		return { identity, guestCartId: state.guestCartId };
	}

	/** The customer this provider identity already belongs to, if any. */
	async findCustomerIdFor(identity: VerifiedOAuthIdentity): Promise<string | null> {
		const existing = await this.identities.findByProviderSubject(identity.provider, identity.subject);
		if (!existing) return null;
		// Storefront identities only. An identity attached to an operator must never open a
		// customer session, and vice versa — the populations do not meet.
		return existing.subjectType === 'customer' ? existing.subjectId : null;
	}

	/** Every identity currently attached to this customer, for the account screen. */
	async listIdentities(customerId: string) {
		return this.identities.listForSubject('customer', customerId);
	}

	/** Detaches one provider. The caller decides whether removal is permitted. */
	async unlink(customerId: string, provider: OAuthProvider): Promise<boolean> {
		return this.identities.unlink('customer', customerId, provider);
	}

	/**
	 * Links a verified identity to a customer.
	 *
	 * Refuses when the identity already belongs to somebody else. The unique index would refuse
	 * too, but as a duplicate-key error — a 500 where the honest answer is "that account is
	 * already connected elsewhere".
	 */
	async link(customerId: string, identity: VerifiedOAuthIdentity): Promise<void> {
		const owner = await this.findCustomerIdFor(identity);
		if (owner && owner !== customerId) throw new OAuthIdentityConflictError();
		if (owner === customerId) return;

		await this.identities.link({
			id: `aid_${randomUUID()}`,
			subjectType: 'customer',
			subjectId: customerId,
			provider: identity.provider,
			providerSubject: identity.subject,
			email: identity.email,
			linkedAt: new Date().toISOString(),
			lastUsedAt: null,
		});
	}
}
