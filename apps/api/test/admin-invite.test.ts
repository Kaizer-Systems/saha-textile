import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { AdminInvite, AuditLog } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AdminInviteService } from '../src/auth/admin-invite.service';
import type { AuthService } from '../src/auth/auth.service';

/**
 * Admin invites are the ENTIRE privilege-granting surface — there is no admin
 * self-registration — so these assert the properties that make that surface safe: the
 * token never leaves in a response, the grant is audited under the seven-year tier, and
 * consumption is single-use.
 */

const captured = {
	invites: [] as AdminInvite[],
	audits: [] as AuditLog[],
	notifications: [] as Array<{ templateKey: string; variables?: Record<string, string | number> }>,
};

function buildService(overrides: Partial<Record<string, unknown>> = {}) {
	captured.invites = [];
	captured.audits = [];
	captured.notifications = [];

	const auth = {
		normalizeEmail: (email: string) => email.trim().toLowerCase(),
		hash: (value: string) => `hash(${value})`,
		hashPassword: async (value: string) => `argon2(${value})`,
	} as unknown as AuthService;

	const invites = {
		create: async (invite: AdminInvite) => {
			captured.invites.push(invite);
			return invite;
		},
		consume: overrides.consume ?? (async () => null),
		listPending: async () => captured.invites,
		revoke: vi.fn(async () => undefined),
		findByTokenHash: async () => null,
	};

	const authUsers = {
		findAuthStateByIdentifier:
			overrides.findAuthStateByIdentifier ?? overrides.findAuthStateByEmail ?? (async () => null),
		setPasswordHash: vi.fn(async () => undefined),
		setPinHash: vi.fn(async () => undefined),
		setPreferredLoginMethod: vi.fn(async () => undefined),
	};

	const users = {
		save: async (user: Record<string, unknown>) => user,
	};

	const audit = {
		append: async (entry: AuditLog) => {
			captured.audits.push(entry);
			return entry;
		},
	};

	const notifications = {
		send: async (message: { templateKey: string; variables?: Record<string, string | number> }) => {
			captured.notifications.push(message);
			return { status: 'sent' as const, providerMessageId: 'p', outboxEntryId: 'o' };
		},
	};

	// Runs the work in-memory; the real manager opens a driver session.
	const transactions = { withTransaction: async (work: (ctx: object) => Promise<unknown>) => work({}) };

	return new AdminInviteService(
		auth,
		invites as never,
		authUsers as never,
		users as never,
		audit as never,
		notifications as never,
		transactions as never,
	);
}

describe('AdminInviteService.create', () => {
	it('persists only the token hash and mails the plaintext exactly once', async () => {
		const service = buildService();
		const invite = await service.create({
			request: { email: 'New.Admin@Example.com', role: 'staff' },
			invitedByUserId: 'user_admin',
		});

		expect(invite.emailNormalized).toBe('new.admin@example.com');
		// The stored value is a hash, and the plaintext appears only in the message.
		expect(invite.tokenHash.startsWith('hash(')).toBe(true);
		expect(captured.notifications).toHaveLength(1);
		expect(captured.notifications[0]?.templateKey).toBe('admin_invite');
		expect(String(captured.notifications[0]?.variables?.token)).not.toBe(invite.tokenHash);
	});

	it('audits the grant under the seven-year tier', async () => {
		const service = buildService();
		await service.create({ request: { email: 'a@example.com', role: 'admin' }, invitedByUserId: 'user_admin' });

		const entry = captured.audits.at(-1);
		expect(entry?.action).toBe('admin.invite.create');
		// Privilege grants are security evidence, not routine catalog churn.
		expect(entry?.retentionTier).toBe('financial_security');
		expect(entry?.severity).toBe('warn');
		expect(entry?.actorUserId).toBe('user_admin');
		// No token material in the audit trail.
		expect(JSON.stringify(entry)).not.toContain('hash(');
	});

	it('refuses to invite an address that already has an account', async () => {
		const service = buildService({ findAuthStateByIdentifier: async () => ({ id: 'adm_existing' }) });
		await expect(
			service.create({ request: { email: 'taken@example.com', role: 'staff' }, invitedByUserId: 'user_admin' }),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('sets an expiry in the future', async () => {
		const service = buildService();
		const invite = await service.create({
			request: { email: 'b@example.com', role: 'staff' },
			invitedByUserId: 'user_admin',
		});
		expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
	});
});

describe('AdminInviteService.accept', () => {
	const invite: AdminInvite = {
		id: 'inv_1',
		emailNormalized: 'new.admin@example.com',
		role: 'staff',
		permissions: ['catalog.read'],
		invitedByUserId: 'user_admin',
		tokenHash: 'hash(tok)',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 3600_000).toISOString(),
		acceptedAt: null,
		revokedAt: null,
	};

	it('creates the account with the invited role and a verified address', async () => {
		const service = buildService({ consume: async () => invite });
		const user = await service.accept({ token: 'tok', password: 'CorrectHorse12' });

		expect(user.role).toBe('staff');
		// Redeeming the link proves control of the mailbox it was sent to.
		expect(user.emailVerified).toBe(true);
		expect(user.email).toBe('new.admin@example.com');
	});

	it('refuses an invalid, expired, revoked or already-used token identically', async () => {
		const service = buildService({ consume: async () => null });
		await expect(service.accept({ token: 'nope', password: 'CorrectHorse12' })).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
	});

	it('audits the acceptance', async () => {
		const service = buildService({ consume: async () => invite });
		await service.accept({ token: 'tok', password: 'CorrectHorse12' });
		expect(captured.audits.at(-1)?.action).toBe('admin.invite.accept');
	});
});
