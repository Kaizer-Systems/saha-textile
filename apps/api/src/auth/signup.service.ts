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
		const record = await this.find(sessionKey);
		if (!record) throw new SignupError('signup_expired');
		return record;
	}

	/**
	 * The same lookup, for the caller who is ASKING rather than acting.
	 *
	 * `GET /auth/storefront/signup` renders whatever this returns, and having no signup in
	 * flight is its ordinary first answer — for anyone opening the registration page cold. A
	 * refusal there would make the screen treat its own happy path as an error, so absence is
	 * reported as absence and only the mutating routes go through `require`.
	 *
	 * Expiry is applied here for the reason given above: Mongo's TTL sweep runs on its own
	 * schedule, so a record can outlive its `expiresAt`, and a form must not be prefilled from
	 * proof the next write is going to refuse.
	 */
	async find(sessionKey: string | null): Promise<PendingSignup | null> {
		if (!sessionKey) return null;
		const record = await this.pending.findBySessionKey(sessionKey);
		if (!record) return null;
		if (Date.parse(record.expiresAt) <= Date.now()) return null;
		return record;
	}

	/**
	 * Throws away the signup in flight for this browser.
	 *
	 * Abandonment, not failure. Someone who opens the registration page, starts a social round
	 * trip and then navigates away has left; keeping their half-finished record alive means the
	 * next visit resumes a signup they no longer remember beginning — showing a stranger's
	 * address on a shared machine, and, for a social origin, a form with no password field and
	 * no explanation of why.
	 *
	 * The record already TTLs out, so this only makes the ending prompt. Silent when there is
	 * nothing to drop: the caller is saying "I am done", not asserting that a record exists.
	 */
	async discard(sessionKey: string | null): Promise<void> {
		if (!sessionKey) return;
		await this.pending.deleteBySessionKey(sessionKey);
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
	 * Who, if anybody, already owns these values — decided while the proof is still SPENDABLE.
	 *
	 * Separate from `consume` on purpose. Both refusals this can produce, `conflict` and
	 * `existing`, were knowable before anything was spent, yet used to be raised after: somebody
	 * proved an email and a phone, was told the address was taken, and had to begin again from
	 * an empty form because the one-shot record was already gone. Answering first costs one
	 * lookup and leaves the record — and its cookie — intact, so they can correct the field and
	 * re-verify just that one.
	 *
	 * This is a courtesy, NOT the decision. It cannot close the window between reading and
	 * writing, so the unique index remains the arbiter and its refusal arrives as
	 * `DuplicateIdentifierError`.
	 */
	async resolve(record: PendingSignup): Promise<SignupResolution> {
		if (!record.email.verified || !record.phone.verified) throw new SignupError('signup_incomplete');

		const [emailOwnerId, phoneOwnerId] = await Promise.all([
			this.ownerOf('email', record.email.value),
			this.ownerOf('phone', record.phone.value),
		]);

		return resolveSignupTarget({ emailOwnerId, phoneOwnerId });
	}

	/**
	 * Spends the proof, once.
	 *
	 * Atomic read-and-delete, so two submits racing one record cannot both mint an account: the
	 * loser is told the signup expired, which is true from where it is standing. Every identifier
	 * the caller goes on to write comes from the record RETURNED here — never from the request,
	 * which is why `FinaliseSignupRequest` carries none.
	 */
	async consume(record: PendingSignup): Promise<PendingSignup> {
		const consumed = await this.pending.consume(record.id);
		if (!consumed) throw new SignupError('signup_expired');
		return consumed;
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
