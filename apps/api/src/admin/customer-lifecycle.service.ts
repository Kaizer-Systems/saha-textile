import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type AuditLog, type Customer, OAuthProvider } from '@saha-textile/contracts';
import {
	type AuditLogRepository,
	type AuthIdentity,
	type AuthIdentityRepository,
	type AuthSessionRepository,
	type CustomerRepository,
	DuplicateIdentifierError,
	type EmailVerificationTokenRepository,
	type OtpChallengeRepository,
	type PasswordResetTokenRepository,
	type PendingContactChangeRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import { domainRefusal } from '../auth/domain-refusal';
import {
	AUDIT_LOG_REPOSITORY,
	AUTH_IDENTITY_REPOSITORY,
	AUTH_SESSION_REPOSITORY,
	CUSTOMER_REPOSITORY,
	EMAIL_VERIFICATION_TOKEN_REPOSITORY,
	OTP_CHALLENGE_REPOSITORY,
	PASSWORD_RESET_TOKEN_REPOSITORY,
	PENDING_CONTACT_CHANGE_REPOSITORY,
	TRANSACTION_MANAGER,
} from '../infra/tokens';

/** Who asked, for the audit row. */
export interface LifecycleActor {
	actorUserId: string;
	requestId: string | null;
}

/**
 * Customer soft delete and restore — the recycle bin (`DEC-CUSTOMER-SOFT-DELETE-OPS`) and the
 * provider-identity release (`DEC-SOFT-DELETED-IDENTITY-REUSE`).
 *
 * Split from `AdminCustomersService` because both operations reach well past the customer row:
 * sessions, single-use links, one-time codes, provider links and the audit log. The directory
 * service stays about the directory.
 *
 * ## What a delete commits together, and what follows it
 *
 * The status flip (which also bumps the token version), the provider release and the audit row
 * are ONE transaction: a customer must never be deleted with their Google link still attached,
 * nor lose the link without the record of whose it was.
 *
 * Ending sessions and spending links and codes runs after the commit. Each step is idempotent
 * and none of them is what makes the account unusable — the status and the token version
 * already are, on the next request — so a failure there leaves dead credentials lying around
 * for their TTL rather than a half-deleted customer. Doing them inside the transaction would
 * have needed every one of those repositories to join it for no gain in safety.
 */
@Injectable()
export class CustomerLifecycleService {
	private readonly logger = new Logger('CustomerLifecycleService');

	constructor(
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
		@Inject(AUTH_IDENTITY_REPOSITORY) private readonly identities: AuthIdentityRepository,
		@Inject(AUTH_SESSION_REPOSITORY) private readonly sessions: AuthSessionRepository,
		@Inject(PASSWORD_RESET_TOKEN_REPOSITORY) private readonly resets: PasswordResetTokenRepository,
		@Inject(EMAIL_VERIFICATION_TOKEN_REPOSITORY) private readonly verifications: EmailVerificationTokenRepository,
		@Inject(OTP_CHALLENGE_REPOSITORY) private readonly otps: OtpChallengeRepository,
		@Inject(PENDING_CONTACT_CHANGE_REPOSITORY) private readonly contactChanges: PendingContactChangeRepository,
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
	) {}

	async softDelete(customerId: string, actor: LifecycleActor): Promise<Customer> {
		const before = await this.customers.findById(customerId);
		if (!before || before.status === 'deleted') throw new NotFoundException('Customer not found');

		const at = new Date().toISOString();
		const { deleted, released } = await this.transactions.withTransaction(async (context) => {
			const row = await this.customers.softDelete(customerId, at);
			// Lost a race with another delete: nothing was changed, so nothing is released.
			if (!row) throw new NotFoundException('Customer not found');

			const links = await this.identities.releaseForSubject('customer', customerId, OAuthProvider.options);
			await this.audit.append(
				this.entry(
					actor,
					customerId,
					'customer.delete',
					'warn',
					at,
					[
						{ field: 'status', before: before.status, after: 'deleted' },
						...(links.length > 0
							? [{ field: 'identities', before: links.map((link) => link.provider), after: [] }]
							: []),
					],
					{ releasedIdentities: links.map(releasedIdentity) },
				),
				context,
			);
			return { deleted: row, released: links };
		});

		const revoked = await this.revokeAccess(before, at);
		this.logger.log(
			`Customer ${customerId} soft-deleted: ${released.length} provider link(s) released, ` +
				`${revoked.sessions} session(s), ${revoked.links} link(s), ${revoked.codes} code(s) revoked`,
		);
		return deleted;
	}

	/**
	 * Brings a deleted customer back with the status they had.
	 *
	 * Released provider links do NOT come back (owner choice 2026-11-03): the customer reconnects
	 * Google or Facebook from their account page. Email, phone and password do come back — they
	 * never left the row — unless another live customer has taken the email or phone since, in
	 * which case the restore is refused and says which.
	 */
	async restore(customerId: string, actor: LifecycleActor): Promise<Customer> {
		const before = await this.customers.findById(customerId);
		if (!before || before.status !== 'deleted') throw new NotFoundException('Deleted customer not found');

		// The courtesy check: a clear answer before any write. The unique index below is still the
		// arbiter, because somebody can sign up with the address between this read and the write.
		if (before.email && (await this.customers.findByEmail(before.email))) throw identifierTaken('email');
		if (before.phone && (await this.customers.findByPhone(before.phone))) throw identifierTaken('phone');

		const at = new Date().toISOString();
		try {
			return await this.transactions.withTransaction(async (context) => {
				const restored = await this.customers.restore(customerId);
				if (!restored) throw new NotFoundException('Deleted customer not found');
				await this.audit.append(
					this.entry(actor, customerId, 'customer.restore', 'warn', at, [
						{ field: 'status', before: 'deleted', after: restored.status },
					]),
					context,
				);
				return restored;
			});
		} catch (error) {
			if (error instanceof DuplicateIdentifierError) throw identifierTaken(error.field);
			throw error;
		}
	}

	/**
	 * Everything that could still let the departed customer in, or reach them.
	 *
	 * The identifiers include a contact change in flight, whose code went to the NEW address —
	 * an address this customer had not proven and that somebody else may now register.
	 */
	private async revokeAccess(
		customer: Customer,
		at: string,
	): Promise<{ sessions: number; links: number; codes: number }> {
		const pending = await this.contactChanges.findByCustomerId(customer.id);
		const identifiers = [customer.email, customer.phone, pending?.newValue].filter(
			(value): value is string => typeof value === 'string' && value.length > 0,
		);

		const sessions = await this.sessions.revokeAllForUser(customer.id, 'admin_action', at);
		const links =
			(await this.resets.revokeAllForUser(customer.id, at)) +
			(await this.verifications.revokeAllForUser(customer.id, at));
		const codes = await this.otps.revokeOpenFor({ userId: customer.id, identifiers }, at);
		if (pending) await this.contactChanges.deleteByCustomerId(customer.id);

		return { sessions, links, codes };
	}

	private entry(
		actor: LifecycleActor,
		customerId: string,
		action: string,
		severity: AuditLog['severity'],
		at: string,
		diffs: AuditLog['diffs'],
		metadata: AuditLog['metadata'] = {},
	): AuditLog {
		return {
			id: `audit_${randomUUID()}`,
			actorUserId: actor.actorUserId,
			targetUserId: customerId,
			audience: 'admin',
			action,
			entityType: 'customer',
			entityId: customerId,
			severity,
			// Account removal and recovery are security events: kept for the seven-year tier.
			retentionTier: 'financial_security',
			diffs,
			metadata,
			requestId: actor.requestId,
			ipHash: null,
			userAgentHash: null,
			createdAt: at,
		};
	}
}

/**
 * The history the owner asked the audit log to keep: which provider account was attached, and
 * since when. The provider's email snapshot is left out — the customer row still holds the
 * account's email, and the audit trail does not need a second copy.
 */
function releasedIdentity(link: AuthIdentity): Record<string, string> {
	return { provider: link.provider, providerSubject: link.providerSubject, linkedAt: link.linkedAt };
}

function identifierTaken(field: 'email' | 'phone') {
	return domainRefusal(
		'customer_identifier_taken',
		`This customer's ${field} now belongs to another customer, so it can't be restored. ` +
			`Change the ${field} on that account first.`,
	);
}
