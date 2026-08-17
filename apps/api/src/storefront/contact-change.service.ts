import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ContactField, Customer, PendingContactChangeState } from '@saha-textile/contracts';
import {
	resendDelaySeconds,
	type AuditLogRepository,
	type CustomerAuthRepository,
	type CustomerRepository,
	type NotificationPort,
	type PendingContactChange,
	type PendingContactChangeRepository,
} from '@saha-textile/core-domain';

import { AuthService } from '../auth/auth.service';
import { domainRefusal } from '../auth/domain-refusal';
import {
	AUDIT_LOG_REPOSITORY,
	CUSTOMER_AUTH_REPOSITORY,
	CUSTOMER_REPOSITORY,
	NOTIFICATION_PORT,
	PENDING_CONTACT_CHANGE_REPOSITORY,
} from '../infra/tokens';

/**
 * Moving the email or phone on an account.
 *
 * Owns the pending record and the rules; no HTTP, no cookies. The controller decides what to
 * answer, this decides what is TRUE — the same split `SignupService` makes.
 *
 * ## The shape of the flow, and why
 *
 * Start proves the caller (step-up), records the wanted value, and sends a code THERE. Confirm
 * spends the code and only then does the customer row move. Between the two the account is
 * completely unchanged: the old address still signs in, still receives recovery mail, still
 * works. That is the security matrix's "retain old address until new one is verified", and it is
 * what keeps a session stolen for five minutes from becoming permanent ownership.
 */

/** Sliding window, and the ceiling it may never slide past. Mirrors `SignupService`. */
const SLIDING_TTL_MS = 15 * 60_000;
const ABSOLUTE_TTL_MS = 30 * 60_000;

/** Sends per change — the same 5 the signup flow allows per destination. */
const MAX_SENDS = 5;

@Injectable()
export class ContactChangeService {
	constructor(
		@Inject(PENDING_CONTACT_CHANGE_REPOSITORY) private readonly pending: PendingContactChangeRepository,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(CUSTOMER_AUTH_REPOSITORY) private readonly customerAuth: CustomerAuthRepository,
		@Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		private readonly auth: AuthService,
	) {}

	/**
	 * Starts a change: proves the caller, parks the new value, sends a code to it.
	 *
	 * Step-up comes FIRST, before anything is written or any message leaves — so a caller who
	 * cannot prove themselves learns nothing and costs nothing, and cannot use this route to
	 * send mail to an address they do not own.
	 */
	async start(input: {
		customerId: string;
		field: ContactField;
		rawValue: string;
		proof: { password?: string; otpCode?: string };
	}): Promise<PendingContactChangeState> {
		await this.auth.assertStepUp(input.customerId, input.proof);

		const newValue = this.normalise(input.field, input.rawValue);
		const customer = await this.auth.publicCustomer(input.customerId);

		// Refusing this is not a disclosure — it is the caller's own value, which they can
		// already read on the same screen. Accepting it would send a code to confirm a change
		// that changes nothing.
		if (newValue === (input.field === 'email' ? customer.email : customer.phone)) {
			throw domainRefusal('contact_change_unchanged', 'That is already the value on this account');
		}

		const now = Date.now();
		const record = await this.pending.start({
			id: `pcc_${randomUUID()}`,
			customerId: input.customerId,
			field: input.field,
			newValue,
			sends: 0,
			lastSentAt: null,
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + SLIDING_TTL_MS).toISOString(),
			absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS).toISOString(),
		});

		// The OLD value is told a change was asked for, which is the matrix's "old email
		// notification". It is the one message that reaches the person an attacker is trying to
		// displace, so it goes out at the START and not at the swap — by the swap it is too late
		// to be a warning.
		await this.notifyPrevious(customer, input.field, newValue);

		return this.toState(await this.send(record));
	}

	/**
	 * Sends again to the value already parked.
	 *
	 * Takes no step-up: the value was fixed by a request that already proved the caller, and this
	 * cannot redirect it anywhere. Asking for the password again to re-send to an address the
	 * server chose would be ceremony, not security.
	 */
	async resend(customerId: string): Promise<PendingContactChangeState> {
		return this.toState(await this.send(await this.require(customerId)));
	}

	/**
	 * Dispatches a code, or declines to — and the difference must not be observable.
	 *
	 * The budget and the backoff move IDENTICALLY whether or not a message actually goes out.
	 * When the wanted value already belongs to another account nothing is dispatched, because
	 * saying so would answer "is this address registered?" for any value a caller cares to type.
	 * Recording the send anyway is what makes the two cases indistinguishable — the response,
	 * the countdown and the remaining budget are the same, and the only difference is a code
	 * that never arrives, exactly as if it had gone astray.
	 */
	private async send(record: PendingContactChange): Promise<PendingContactChange> {
		if (record.sends >= MAX_SENDS) {
			throw domainRefusal('otp_send_limit_reached', 'No more codes can be sent for this change');
		}
		const waitSeconds = resendDelaySeconds(record.sends);
		if (record.lastSentAt && Date.now() - Date.parse(record.lastSentAt) < waitSeconds * 1000) {
			throw domainRefusal('otp_send_limit_reached', 'A code was just sent — wait before asking for another');
		}

		if (!(await this.ownedByAnother(record))) {
			await this.auth.issueOtp({
				identifier: record.newValue,
				purpose: 'change_contact',
				channel: record.field === 'email' ? 'email' : 'sms',
				userId: record.customerId,
			});
		}

		return (await this.pending.recordSend(record.id, new Date().toISOString(), this.slide(record))) ?? record;
	}

	/**
	 * Spends the code and moves the value.
	 *
	 * The code is verified BEFORE the record is consumed. Consuming first would mean one mistyped
	 * digit ended the attempt and forced the whole step-up dance again; verification is already
	 * single-use and attempt-capped in `verifyOtp`, so it is the right gate to hang this on.
	 *
	 * `contact_in_use` may finally be spoken here. The caller has just proven control of the
	 * value, so telling them it belongs to somebody else discloses nothing they could not
	 * establish anyway — the same rule `SignupService.verifyOtp` follows.
	 */
	async confirm(customerId: string, code: string): Promise<Customer> {
		const record = await this.require(customerId);

		const verified = await this.auth.verifyOtp({
			identifier: record.newValue,
			purpose: 'change_contact',
			code,
		});
		if (!verified) throw domainRefusal('otp_invalid', 'That code is not valid');

		if (await this.ownedByAnother(record)) {
			throw domainRefusal('contact_in_use', 'That value already belongs to another account');
		}

		const consumed = await this.pending.consume(record.id);
		if (!consumed) throw domainRefusal('contact_change_expired', 'That change is no longer in flight');

		const previous = await this.auth.publicCustomer(customerId);
		if (consumed.field === 'email') {
			await this.customerAuth.markEmailVerified(customerId, consumed.newValue);
		} else {
			await this.customerAuth.markPhoneVerified(customerId, consumed.newValue);
		}

		await this.recordAudit(previous, consumed);
		return this.auth.publicCustomer(customerId);
	}

	/** The change in flight, or nothing. Expiry is checked here, not left to Mongo's sweep. */
	async pendingFor(customerId: string): Promise<PendingContactChangeState | null> {
		const record = await this.pending.findByCustomerId(customerId);
		if (!record || Date.parse(record.expiresAt) <= Date.now()) return null;
		return this.toState(record);
	}

	async cancel(customerId: string): Promise<void> {
		await this.pending.deleteByCustomerId(customerId);
	}

	/**
	 * Loads the record and refuses once it has expired.
	 *
	 * Checked here rather than relying on the TTL index, for the reason `SignupService.require`
	 * gives: Mongo's expiry sweep runs on its own schedule, so a row can outlive its `expiresAt`
	 * by up to a minute. Trusting deletion would make the window in which a stale change can
	 * still be confirmed a matter of background timing.
	 */
	private async require(customerId: string): Promise<PendingContactChange> {
		const record = await this.pending.findByCustomerId(customerId);
		if (!record) throw domainRefusal('contact_change_expired', 'No change is in flight');
		if (Date.parse(record.expiresAt) <= Date.now()) {
			throw domainRefusal('contact_change_expired', 'That change has expired');
		}
		return record;
	}

	/** Whether the wanted value is already some OTHER account's. Never revealed at start. */
	private async ownedByAnother(record: PendingContactChange): Promise<boolean> {
		const owner =
			record.field === 'email'
				? await this.customers.findByEmail(record.newValue)
				: await this.customers.findByPhone(record.newValue);
		return owner !== null && owner.id !== record.customerId;
	}

	private normalise(field: ContactField, raw: string): string {
		return field === 'email' ? this.auth.normalizeEmail(raw) : raw.trim();
	}

	/** The sliding extension, clamped so activity can never push past the absolute ceiling. */
	private slide(record: PendingContactChange): string {
		const wanted = Date.now() + SLIDING_TTL_MS;
		return new Date(Math.min(wanted, Date.parse(record.absoluteExpiresAt))).toISOString();
	}

	/**
	 * Tells the value being replaced that a replacement was requested.
	 *
	 * Best-effort on purpose: a bounced warning must not fail the change the person is legitimately
	 * making. The send is already recorded in the outbox, so a delivery failure is visible there
	 * rather than lost.
	 */
	private async notifyPrevious(customer: Customer, field: ContactField, newValue: string): Promise<void> {
		const previous = field === 'email' ? customer.email : customer.phone;
		if (!previous) return;

		await this.notifications
			.send({
				channel: field === 'email' ? 'email' : 'sms',
				category: 'transactional',
				templateKey: 'contact_change_requested',
				destination: previous,
				userId: customer.id,
				// The new value is deliberately NOT a variable: this message goes to the address an
				// attacker is trying to displace, and it should not hand them a confirmed
				// alternative contact for the victim if they are reading it.
				variables: { field, maskedNewValue: maskValue(field, newValue) },
			})
			.catch(() => undefined);
	}

	private async recordAudit(previous: Customer, consumed: PendingContactChange): Promise<void> {
		await this.audit.append({
			id: `aud_${randomUUID()}`,
			actorUserId: previous.id,
			targetUserId: previous.id,
			audience: 'storefront',
			action: `customer.contact.${consumed.field}.change`,
			entityType: 'customer',
			entityId: previous.id,
			severity: 'warn',
			// A credential moved. `financial_security` is the seven-year tier, and the question
			// "when did this account's recovery channel change, and to what" is exactly the one
			// asked long after the fact.
			retentionTier: 'financial_security',
			diffs: [
				{
					field: consumed.field,
					before: consumed.field === 'email' ? previous.email : previous.phone,
					after: consumed.newValue,
				},
			],
			metadata: {},
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		});
	}

	/** The browser-facing projection: what to render, never what the server is holding it to. */
	private toState(record: PendingContactChange): PendingContactChangeState {
		const waitSeconds = resendDelaySeconds(record.sends);
		const readyAt = record.lastSentAt ? Date.parse(record.lastSentAt) + waitSeconds * 1000 : 0;
		return {
			field: record.field,
			newValue: record.newValue,
			sendsRemaining: Math.max(0, MAX_SENDS - record.sends),
			resendAvailableAt: readyAt > Date.now() ? new Date(readyAt).toISOString() : null,
			expiresAt: record.expiresAt,
		};
	}
}

/**
 * Enough of the new value to recognise it, not enough to reuse it.
 *
 * The warning has to say what is being changed to, or it cannot be acted on; it must not hand a
 * reader a working address for the account holder.
 */
function maskValue(field: ContactField, value: string): string {
	if (field === 'phone') return `••••${value.slice(-4)}`;
	const [local = '', domain = ''] = value.split('@');
	return `${local.slice(0, 2)}•••@${domain}`;
}
