import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
	isAccountEnterable,
	resendDelaySeconds,
	resolveSignupTarget,
	type CustomerAuthRepository,
	type CustomerRepository,
	type PendingSignup,
	type PendingSignupFieldName,
	type PendingSignupRepository,
	type SignupResolution,
} from '@saha-textile/core-domain';
import type { PendingSignupState, SignupFieldState } from '@saha-textile/contracts';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CUSTOMER_AUTH_REPOSITORY, CUSTOMER_REPOSITORY, PENDING_SIGNUP_REPOSITORY } from '../infra/tokens';
import { AuthService } from './auth.service';

/**
 * The signup lifecycle (`DEC-SIGNUP-VERIFICATION`).
 *
 * Owns the pending record and nothing else: no HTTP, no cookies, no provider calls. The
 * controller decides what to answer; this decides what is TRUE.
 */

/** Sliding window, and the ceiling it may never slide past. */
const SLIDING_TTL_MS = 15 * 60_000;
const ABSOLUTE_TTL_MS = 30 * 60_000;

/** Sends per destination, per pending signup — the owner's 5 + 5. */
const MAX_SENDS_PER_FIELD = 5;

export type SignupRefusal =
	| 'signup_expired'
	| 'signup_incomplete'
	| 'otp_send_limit_reached'
	| 'otp_invalid'
	| 'signup_identifier_taken'
	| 'account_not_accessible'
	| 'signup_identifier_conflict';

export class SignupError extends Error {
	constructor(readonly code: SignupRefusal) {
		super(code);
		this.name = 'SignupError';
	}
}

@Injectable()
export class SignupService {
	constructor(
		@Inject(APP_CONFIG) private readonly config: AppConfig,
		@Inject(PENDING_SIGNUP_REPOSITORY) private readonly pending: PendingSignupRepository,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(CUSTOMER_AUTH_REPOSITORY) private readonly customerAuth: CustomerAuthRepository,
		private readonly auth: AuthService,
	) {}

	/** A fresh opaque key for the `st_signup` cookie. Never derived from anything guessable. */
	newSessionKey(): string {
		return `psk_${randomUUID()}`;
	}

	async start(input: {
		sessionKey: string;
		origin: PendingSignup['origin'];
		email?: string;
		phone?: string;
		displayName?: string;
		marketingOptIn: boolean;
		guestCartId?: string | null;
		/** Google asserts its own address, so the form may not overwrite it. */
		emailPreVerified?: boolean;
		emailLocked?: boolean;
	}): Promise<PendingSignup> {
		const now = Date.now();
		return this.pending.start({
			id: `psu_${randomUUID()}`,
			sessionKey: input.sessionKey,
			origin: input.origin,
			email: {
				value: input.email ? this.auth.normalizeEmail(input.email) : null,
				verified: input.emailPreVerified === true,
				locked: input.emailLocked === true,
				sends: 0,
				lastSentAt: null,
			},
			phone: { value: input.phone ?? null, verified: false, locked: false, sends: 0, lastSentAt: null },
			displayName: input.displayName ?? null,
			marketingOptIn: input.marketingOptIn,
			guestCartId: input.guestCartId ?? null,
			provider: null,
			providerSubject: null,
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + SLIDING_TTL_MS).toISOString(),
			absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS).toISOString(),
		});
	}

	/**
	 * Loads the record and refuses once it has expired.
	 *
	 * Checked here rather than relying on the TTL index: Mongo's expiry sweep runs on its own
	 * schedule, so a record can outlive its `expiresAt` by up to a minute. Trusting deletion
	 * would make the window in which a stale proof still works a matter of background timing.
	 */
	async require(sessionKey: string | null): Promise<PendingSignup> {
		if (!sessionKey) throw new SignupError('signup_expired');
		const record = await this.pending.findBySessionKey(sessionKey);
		if (!record) throw new SignupError('signup_expired');
		if (Date.parse(record.expiresAt) <= Date.now()) throw new SignupError('signup_expired');
		return record;
	}

	/** The sliding extension, clamped so activity can never push past the absolute ceiling. */
	private slide(record: PendingSignup): string {
		const wanted = Date.now() + SLIDING_TTL_MS;
		const ceiling = Date.parse(record.absoluteExpiresAt);
		return new Date(Math.min(wanted, ceiling)).toISOString();
	}

	async setField(record: PendingSignup, field: PendingSignupFieldName, rawValue: string): Promise<PendingSignup> {
		// A locked field is Google's asserted address. Refusing the edit protects a claim we did
		// not make and cannot re-verify.
		if (record[field].locked) return record;
		const value = field === 'email' ? this.auth.normalizeEmail(rawValue) : rawValue.trim();
		return (await this.pending.setFieldValue(record.id, field, value)) ?? record;
	}

	/**
	 * Sends a code, or declines to.
	 *
	 * Signup ALWAYS dispatches when it dispatches at all: ownership is exactly what is in
	 * question, so there is no account to check against and nothing to save by skipping. The
	 * budget and the backoff are the controls, and both are per destination — the sharp scope,
	 * which punishes nobody sharing an address with the caller.
	 */
	async requestOtp(record: PendingSignup, field: PendingSignupFieldName): Promise<PendingSignup> {
		const state = record[field];
		if (!state.value) throw new SignupError('otp_invalid');
		if (state.sends >= MAX_SENDS_PER_FIELD) throw new SignupError('otp_send_limit_reached');

		const waitSeconds = resendDelaySeconds(state.sends);
		if (state.lastSentAt && Date.now() - Date.parse(state.lastSentAt) < waitSeconds * 1000) {
			throw new SignupError('otp_send_limit_reached');
		}

		await this.auth.issueOtp({
			identifier: state.value,
			purpose: 'register',
			channel: field === 'email' ? 'email' : 'sms',
		});

		return (
			(await this.pending.recordSend(record.id, field, new Date().toISOString(), this.slide(record))) ?? record
		);
	}

	/**
	 * Verifies a code and reports what proving control revealed.
	 *
	 * The disclosure rule lives here. Before this point nothing is said about whether an address
	 * is registered; after it the caller has PROVEN control, so telling them is safe — and it is
	 * the only way the flow can offer "sign in instead" rather than failing at the end.
	 */
	async verifyOtp(
		record: PendingSignup,
		field: PendingSignupFieldName,
		code: string,
	): Promise<{ record: PendingSignup; existingCustomerId: string | null; accountUsable: boolean }> {
		const state = record[field];
		if (!state.value) throw new SignupError('otp_invalid');

		const result = await this.auth.verifyOtp({ identifier: state.value, purpose: 'register', code });
		if (!result) throw new SignupError('otp_invalid');

		const updated = (await this.pending.markVerified(record.id, field, this.slide(record))) ?? record;
		const owner = await this.ownerOf(field, state.value);

		if (!owner) return { record: updated, existingCustomerId: null, accountUsable: true };

		const customer = await this.customers.findById(owner);
		const usable = customer ? isAccountEnterable(customer.status) : false;
		return { record: updated, existingCustomerId: owner, accountUsable: usable };
	}

	/**
	 * Turns a fully proven record into an account, or into the reason it cannot be one.
	 *
	 * Consumption is atomic and single-use, so two submits cannot both mint an account from one
	 * proof. Every identifier comes from the CONSUMED record — never from the request, which is
	 * why `FinaliseSignupRequest` carries none.
	 */
	async finalise(record: PendingSignup): Promise<{ resolution: SignupResolution; consumed: PendingSignup }> {
		if (!record.email.verified || !record.phone.verified) throw new SignupError('signup_incomplete');

		const consumed = await this.pending.consume(record.id);
		if (!consumed) throw new SignupError('signup_expired');

		const [emailOwnerId, phoneOwnerId] = await Promise.all([
			this.ownerOf('email', consumed.email.value),
			this.ownerOf('phone', consumed.phone.value),
		]);

		return { resolution: resolveSignupTarget({ emailOwnerId, phoneOwnerId }), consumed };
	}

	private async ownerOf(field: PendingSignupFieldName, value: string | null): Promise<string | null> {
		if (!value) return null;
		const found =
			field === 'email'
				? await this.customerAuth.findAuthStateByEmail(this.auth.normalizeEmail(value))
				: await this.customers.findByPhone(value);
		return found?.id ?? null;
	}

	/**
	 * Binds a verified provider identity to the pending record, SERVER-side.
	 *
	 * The subject is never re-posted at finalisation for the same reason the verified email is
	 * not: a client that could name its own provider subject could name somebody else's.
	 */
	async attachProvider(
		record: PendingSignup,
		identity: { provider: 'google' | 'facebook'; subject: string },
	): Promise<PendingSignup> {
		return (
			(await this.pending.attachProvider(record.id, identity.provider, identity.subject, this.slide(record))) ??
			record
		);
	}

	/** The browser-facing projection: what to render, never what the server is holding it to. */
	toState(record: PendingSignup): PendingSignupState {
		const field = (name: PendingSignupFieldName): SignupFieldState => {
			const state = record[name];
			const remaining = Math.max(0, MAX_SENDS_PER_FIELD - state.sends);
			const waitSeconds = resendDelaySeconds(state.sends);
			const readyAt = state.lastSentAt ? Date.parse(state.lastSentAt) + waitSeconds * 1000 : 0;
			return {
				value: state.value,
				verified: state.verified,
				locked: state.locked,
				sendsRemaining: remaining,
				resendAvailableAt: readyAt > Date.now() ? new Date(readyAt).toISOString() : null,
			};
		};

		return {
			origin: record.origin,
			email: field('email'),
			phone: field('phone'),
			displayName: record.displayName,
			complete: record.email.verified && record.phone.verified,
			expiresAt: record.expiresAt,
		};
	}
}
