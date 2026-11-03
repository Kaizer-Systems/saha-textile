import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuditLog, Customer } from '@saha-textile/contracts';
import { type AuthIdentity, DuplicateIdentifierError } from '@saha-textile/core-domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerLifecycleService } from '../src/admin/customer-lifecycle.service';

const customerFixture = (overrides: Partial<Customer> = {}): Customer => ({
	id: 'cus_life_1',
	email: 'leaver@example.test',
	emailVerified: true,
	phone: '+919800000001',
	phoneVerified: true,
	displayName: 'Leaver',
	status: 'active',
	identities: [],
	addresses: [],
	contacts: [],
	savedSizes: [],
	measurementProfiles: [],
	guestCartId: null,
	...overrides,
});

const googleLink: AuthIdentity = {
	id: 'aid_1',
	subjectType: 'customer',
	subjectId: 'cus_life_1',
	provider: 'google',
	providerSubject: 'google-sub-1',
	email: 'leaver@gmail.example',
	linkedAt: '2026-10-01T00:00:00.000Z',
	lastUsedAt: null,
};

const ACTOR = { actorUserId: 'adm_actor', requestId: 'req-1' };

/** The issue message a domain refusal carries — what the admin toast shows. */
const refusalMessage = (error: unknown): string => {
	const body = (error as BadRequestException).getResponse() as { issues: { message: string; code: string }[] };
	return `${body.issues[0]?.code}: ${body.issues[0]?.message}`;
};

describe('CustomerLifecycleService', () => {
	const events: string[] = [];
	const transactions = {
		withTransaction: vi.fn(async (work: (context: object) => Promise<unknown>) => {
			events.push('tx:begin');
			const result = await work({ session: 'tx' });
			events.push('tx:commit');
			return result;
		}),
	};
	const customers = {
		findById: vi.fn(),
		findByEmail: vi.fn(),
		findByPhone: vi.fn(),
		softDelete: vi.fn(),
		restore: vi.fn(),
	};
	const identities = { releaseForSubject: vi.fn() };
	const sessions = { revokeAllForUser: vi.fn(async () => (events.push('sessions'), 2)) };
	const resets = { revokeAllForUser: vi.fn(async () => (events.push('resets'), 1)) };
	const verifications = { revokeAllForUser: vi.fn(async () => (events.push('verifications'), 0)) };
	const otps = { revokeOpenFor: vi.fn(async () => (events.push('otps'), 1)) };
	const contactChanges = { findByCustomerId: vi.fn(), deleteByCustomerId: vi.fn(async () => true) };
	const audit = { append: vi.fn(async (entry: AuditLog) => (events.push(`audit:${entry.action}`), entry)) };

	const service = () =>
		new CustomerLifecycleService(
			transactions as never,
			customers as never,
			identities as never,
			sessions as never,
			resets as never,
			verifications as never,
			otps as never,
			contactChanges as never,
			audit as never,
		);

	beforeEach(() => {
		vi.clearAllMocks();
		events.length = 0;
		customers.findById.mockResolvedValue(customerFixture());
		customers.findByEmail.mockResolvedValue(null);
		customers.findByPhone.mockResolvedValue(null);
		customers.softDelete.mockImplementation(
			async () => (events.push('customer:delete'), customerFixture({ status: 'deleted' })),
		);
		customers.restore.mockResolvedValue(customerFixture({ status: 'active' }));
		identities.releaseForSubject.mockImplementation(async () => (events.push('identities:release'), [googleLink]));
		contactChanges.findByCustomerId.mockResolvedValue(null);
	});

	describe('softDelete', () => {
		it('flips the row, releases provider links and audits in one transaction, then revokes access', async () => {
			const result = await service().softDelete('cus_life_1', ACTOR);

			expect(result.status).toBe('deleted');
			expect(events).toEqual([
				'tx:begin',
				'customer:delete',
				'identities:release',
				'audit:customer.delete',
				'tx:commit',
				'sessions',
				'resets',
				'verifications',
				'otps',
			]);
		});

		it('releases only the OAuth providers (DEC-SOFT-DELETED-IDENTITY-REUSE)', async () => {
			await service().softDelete('cus_life_1', ACTOR);
			expect(identities.releaseForSubject).toHaveBeenCalledWith('customer', 'cus_life_1', ['google', 'facebook']);
		});

		it('keeps the released link in the audit row, without the provider email', async () => {
			await service().softDelete('cus_life_1', ACTOR);
			const [entry, context] = audit.append.mock.calls[0] as unknown as [AuditLog, unknown];

			expect(context).toEqual({ session: 'tx' });
			expect(entry).toMatchObject({
				actorUserId: 'adm_actor',
				targetUserId: 'cus_life_1',
				entityType: 'customer',
				requestId: 'req-1',
				retentionTier: 'financial_security',
				metadata: {
					releasedIdentities: [
						{ provider: 'google', providerSubject: 'google-sub-1', linkedAt: '2026-10-01T00:00:00.000Z' },
					],
				},
			});
			expect(entry.diffs).toContainEqual({ field: 'status', before: 'active', after: 'deleted' });
			expect(JSON.stringify(entry)).not.toContain('leaver@gmail.example');
		});

		it('ends sessions and revokes links and codes for every identifier, including a contact change in flight', async () => {
			contactChanges.findByCustomerId.mockResolvedValue({
				customerId: 'cus_life_1',
				newValue: 'new@example.test',
			});
			await service().softDelete('cus_life_1', ACTOR);

			expect(sessions.revokeAllForUser).toHaveBeenCalledWith('cus_life_1', 'admin_action', expect.any(String));
			expect(resets.revokeAllForUser).toHaveBeenCalledWith('cus_life_1', expect.any(String));
			expect(verifications.revokeAllForUser).toHaveBeenCalledWith('cus_life_1', expect.any(String));
			expect(otps.revokeOpenFor).toHaveBeenCalledWith(
				{ userId: 'cus_life_1', identifiers: ['leaver@example.test', '+919800000001', 'new@example.test'] },
				expect.any(String),
			);
			expect(contactChanges.deleteByCustomerId).toHaveBeenCalledWith('cus_life_1');
		});

		it('404s for an already-deleted customer and changes nothing', async () => {
			customers.findById.mockResolvedValue(customerFixture({ status: 'deleted' }));
			await expect(service().softDelete('cus_life_1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
			expect(transactions.withTransaction).not.toHaveBeenCalled();
			expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
		});

		it('releases nothing and revokes nothing when another delete won the race', async () => {
			customers.softDelete.mockResolvedValue(null);
			await expect(service().softDelete('cus_life_1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
			expect(identities.releaseForSubject).not.toHaveBeenCalled();
			expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
		});
	});

	describe('restore', () => {
		beforeEach(() => {
			customers.findById.mockResolvedValue(customerFixture({ status: 'deleted' }));
		});

		it('restores and audits the status it came back with', async () => {
			customers.restore.mockResolvedValue(customerFixture({ status: 'locked' }));
			const result = await service().restore('cus_life_1', ACTOR);

			expect(result.status).toBe('locked');
			const [entry] = audit.append.mock.calls[0] as unknown as [AuditLog];
			expect(entry.action).toBe('customer.restore');
			expect(entry.diffs).toEqual([{ field: 'status', before: 'deleted', after: 'locked' }]);
		});

		it('does not re-attach released provider links', async () => {
			await service().restore('cus_life_1', ACTOR);
			expect(identities.releaseForSubject).not.toHaveBeenCalled();
		});

		it('refuses in words when another live customer now holds the email', async () => {
			customers.findByEmail.mockResolvedValue(customerFixture({ id: 'cus_other' }));
			const error = await service()
				.restore('cus_life_1', ACTOR)
				.catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(BadRequestException);
			expect(refusalMessage(error)).toMatch(
				/^customer_identifier_taken: .*email now belongs to another customer/,
			);
			expect(customers.restore).not.toHaveBeenCalled();
		});

		it('refuses in words when the phone is taken', async () => {
			customers.findByPhone.mockResolvedValue(customerFixture({ id: 'cus_other' }));
			const error = await service()
				.restore('cus_life_1', ACTOR)
				.catch((caught: unknown) => caught);
			expect(refusalMessage(error)).toMatch(/phone now belongs to another customer/);
		});

		it('turns a lost race on the unique index into the same refusal, not a 500', async () => {
			customers.restore.mockRejectedValue(new DuplicateIdentifierError('phone'));
			const error = await service()
				.restore('cus_life_1', ACTOR)
				.catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(BadRequestException);
			expect(refusalMessage(error)).toMatch(/phone now belongs to another customer/);
			expect(audit.append).not.toHaveBeenCalled();
		});

		it('404s for a customer who is not deleted', async () => {
			customers.findById.mockResolvedValue(customerFixture({ status: 'active' }));
			await expect(service().restore('cus_life_1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
			expect(customers.restore).not.toHaveBeenCalled();
		});
	});
});
