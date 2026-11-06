import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
	AssignmentAlreadyActiveError,
	DuplicateIdentifierError,
	OAuthProviderUnavailableError,
} from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AdminUsersService } from '../src/admin/admin-users.service';
import { CustomerLifecycleService } from '../src/admin/customer-lifecycle.service';
import { RolesService } from '../src/admin/roles.service';
import { AdminInviteService } from '../src/auth/admin-invite.service';
import { OAuthService } from '../src/auth/oauth.service';
import { Principal } from '../src/auth/ownership';
import { SessionService } from '../src/auth/session.service';
import { CartService } from '../src/cart/cart.service';
import { csrfCookieOptions } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';
import { deploymentHardeningProblems } from '../src/config/deployment-hardening';
import { PersistenceModule } from '../src/infra/persistence.module';
import { AUTH_PORT } from '../src/infra/tokens';
import { ContactChangeService } from '../src/storefront/contact-change.service';
import { StorefrontAddressesController } from '../src/storefront/storefront-addresses.controller';
import { StorefrontProfileController } from '../src/storefront/storefront-profile.controller';

const secrets = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };

const role = (overrides: Record<string, unknown> = {}) => ({
	id: 'role_1',
	key: 'editor',
	label: 'Editor',
	baseRole: 'staff',
	permissions: [],
	isSystem: false,
	...overrides,
});
const operator = (overrides: Record<string, unknown> = {}) => ({
	id: 'u1',
	status: 'active',
	role: 'admin',
	permissions: [],
	...overrides,
});

describe('AdminUsersService edges', () => {
	const build = () => {
		const roles = { findById: vi.fn(async (_id: string) => role() as unknown), listAll: vi.fn(async () => []) };
		const assignments = {
			listActiveForUser: vi.fn(async () => [] as unknown[]),
			listActiveForRole: vi.fn(async () => [] as unknown[]),
			assign: vi.fn(async () => ({})),
			revoke: vi.fn(async () => true as unknown),
		};
		const users = {
			findAuthStateById: vi.fn(async () => operator() as unknown),
			bumpPermissionsVersion: vi.fn(async () => 1),
			bumpTokenVersion: vi.fn(async () => 1),
			setStatus: vi.fn(async () => undefined),
		};
		const adminUsers = { list: vi.fn(async () => 'page') };
		const service = new AdminUsersService(
			roles as never,
			assignments as never,
			users as never,
			adminUsers as never,
			{ revokeAllForUser: vi.fn(async () => 0) } as never,
			{ append: vi.fn(async () => ({})) } as never,
		);
		return { service, roles, assignments, users, adminUsers };
	};

	it('lists the directory', async () => {
		const { service } = build();
		await expect(service.list({} as never)).resolves.toBe('page');
	});

	it('leaves out an assignment whose role is gone', async () => {
		const { service, roles, assignments } = build();
		assignments.listActiveForUser.mockResolvedValue([{ roleId: 'gone', assignedAt: 'now' }]);
		roles.findById.mockResolvedValue(null);
		const authority = await service.authority('u1');
		expect(authority.roles).toEqual([]);
	});

	it('refuses to assign for a missing actor, target or role', async () => {
		const { service, users, roles } = build();
		users.findAuthStateById.mockResolvedValueOnce(null);
		await expect(service.assignRole('a', 't', 'r', null)).rejects.toThrow('Actor not found');
		users.findAuthStateById.mockResolvedValueOnce(operator()).mockResolvedValueOnce(null);
		await expect(service.assignRole('a', 't', 'r', null)).rejects.toThrow('User not found');
		roles.findById.mockResolvedValueOnce(null);
		await expect(service.assignRole('a', 't', 'r', null)).rejects.toThrow('Role not found');
	});

	it('explains a repeat grant and passes on anything else', async () => {
		const { service, assignments } = build();
		assignments.assign.mockRejectedValueOnce(new AssignmentAlreadyActiveError('u1', 'r'));
		await expect(service.assignRole('a', 't', 'r', null)).rejects.toBeInstanceOf(ConflictException);
		const failure = new Error('database');
		assignments.assign.mockRejectedValueOnce(failure);
		await expect(service.assignRole('a', 't', 'r', null)).rejects.toBe(failure);
	});

	it('treats a vanished actor as holding nothing', async () => {
		const { service, users, roles } = build();
		roles.findById.mockResolvedValue(role({ permissions: ['product.index'] }));
		users.findAuthStateById
			.mockResolvedValueOnce(operator())
			.mockResolvedValueOnce(operator())
			.mockResolvedValueOnce(null);
		await expect(service.assignRole('a', 't', 'r', null)).rejects.toThrow('You cannot grant permissions');
	});

	it('counts roles from assignments, skipping one that was removed', async () => {
		const { service, users, roles, assignments } = build();
		const wanted = role();
		roles.findById.mockImplementation(async (id: string) => (id === 'gone' ? null : wanted));
		assignments.listActiveForUser.mockResolvedValue([{ roleId: 'gone' }, { roleId: 'r' }]);
		users.findAuthStateById.mockResolvedValue(operator({ role: 'admin' }));
		await expect(service.assignRole('a', 't', 'r', null)).resolves.toBeDefined();
	});

	it('refuses to revoke a missing role or an unassigned one', async () => {
		const { service, roles, assignments } = build();
		roles.findById.mockResolvedValueOnce(null);
		await expect(service.revokeRole('a', 't', 'r', null)).rejects.toBeInstanceOf(NotFoundException);
		assignments.revoke.mockResolvedValueOnce(false);
		await expect(service.revokeRole('a', 't', 'r', null)).rejects.toThrow('not assigned');
	});

	it('refuses a status change for a missing user', async () => {
		const { service, users } = build();
		users.findAuthStateById.mockResolvedValueOnce(null);
		await expect(service.setStatus('a', 't', 'active', null, null)).rejects.toThrow('User not found');
	});

	it('logs a failed bump of any kind without failing the grant', async () => {
		const { service, users } = build();
		const logged = vi.spyOn((service as unknown as { logger: { error: () => void } }).logger, 'error');
		logged.mockImplementation(() => undefined);
		users.bumpPermissionsVersion.mockRejectedValueOnce(new Error('down'));
		await service.revokeRole('a', 't', 'r', null);
		users.bumpPermissionsVersion.mockRejectedValueOnce('text');
		await service.revokeRole('a', 't', 'r', null);
		expect(logged).toHaveBeenCalledTimes(2);
		expect(logged).toHaveBeenLastCalledWith(expect.any(String), 'text');
	});
});

describe('RolesService edges', () => {
	const build = () => {
		const roles = {
			findById: vi.fn(async () => role() as unknown),
			listAll: vi.fn(async () => ['all']),
			update: vi.fn(async () => role() as unknown),
			deleteById: vi.fn(async () => true),
		};
		const assignments = { listActiveForRole: vi.fn(async () => [] as unknown[]) };
		const users = { bumpPermissionsVersion: vi.fn(async () => 1) };
		const service = new RolesService(
			roles as never,
			assignments as never,
			users as never,
			{ append: vi.fn(async () => ({})) } as never,
		);
		return { service, roles, assignments, users };
	};

	it('lists and reads', async () => {
		const { service, roles } = build();
		await expect(service.list()).resolves.toEqual(['all']);
		await expect(service.get('r')).resolves.toMatchObject({ id: 'role_1' });
		roles.findById.mockResolvedValue(null);
		await expect(service.get('r')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('sends a changed description, and notices a role that vanished mid-edit', async () => {
		const { service, roles } = build();
		await service.update('a', 'r', { description: 'New' } as never, null);
		expect(roles.update).toHaveBeenCalledWith('r', { description: 'New' });
		roles.update.mockResolvedValue(null);
		await expect(service.update('a', 'r', {} as never, null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('notices a role that vanished mid-delete', async () => {
		const { service, roles } = build();
		roles.deleteById.mockResolvedValue(false);
		await expect(service.remove('a', 'r', null)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('logs a failed bump given as text', async () => {
		const { service, assignments, users } = build();
		const logged = vi.spyOn((service as unknown as { logger: { error: () => void } }).logger, 'error');
		logged.mockImplementation(() => undefined);
		assignments.listActiveForRole.mockResolvedValue([{ userId: 'u1' }]);
		users.bumpPermissionsVersion.mockRejectedValueOnce('text');
		await service.remove('a', 'r', null);
		expect(logged).toHaveBeenCalledWith(expect.any(String), 'text');
	});
});

describe('CustomerLifecycleService edges', () => {
	const build = () => {
		const customers = {
			findById: vi.fn(async () => ({ id: 'c1', status: 'deleted', email: null, phone: null }) as unknown),
			findByEmail: vi.fn(async () => null),
			findByPhone: vi.fn(async () => null),
			softDelete: vi.fn(async () => ({ id: 'c1', status: 'deleted' })),
			restore: vi.fn(async () => null as unknown),
		};
		const audit = { append: vi.fn(async (entry: unknown) => entry) };
		const service = new CustomerLifecycleService(
			{ withTransaction: async (work: (context: object) => Promise<unknown>) => work({}) } as never,
			customers as never,
			{ releaseForSubject: vi.fn(async () => []) } as never,
			{ revokeAllForUser: vi.fn(async () => 0) } as never,
			{ revokeAllForUser: vi.fn(async () => 0) } as never,
			{ revokeAllForUser: vi.fn(async () => 0) } as never,
			{ revokeOpenFor: vi.fn(async () => 0) } as never,
			{ findByCustomerId: vi.fn(async () => null), deleteByCustomerId: vi.fn(async () => true) } as never,
			audit as never,
		);
		return { service, customers, audit };
	};
	const actor = { actorUserId: 'a', requestId: null };

	it('records no identity change when none were linked', async () => {
		const { service, customers, audit } = build();
		customers.findById.mockResolvedValue({ id: 'c1', status: 'active', email: null, phone: null });
		await service.softDelete('c1', actor);
		const entry = audit.append.mock.lastCall?.[0] as { diffs: unknown[] };
		expect(entry.diffs).toHaveLength(1);
	});

	it('notices a restore that found nothing', async () => {
		const { service } = build();
		await expect(service.restore('c1', actor)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('passes on a failure that is not a taken identifier', async () => {
		const { service, customers } = build();
		const failure = new Error('database');
		customers.restore.mockRejectedValueOnce(failure);
		await expect(service.restore('c1', actor)).rejects.toBe(failure);
		customers.restore.mockRejectedValueOnce(new DuplicateIdentifierError('email'));
		await expect(service.restore('c1', actor)).rejects.toThrow();
	});
});

describe('AdminInviteService edges', () => {
	const build = () => {
		const authUsers = {
			findAuthStateByIdentifier: vi.fn(async () => null),
			setPasswordHash: vi.fn(async () => undefined),
			setPinHash: vi.fn(async () => undefined),
			setPreferredLoginMethod: vi.fn(async () => undefined),
		};
		const invites = {
			consume: vi.fn(async () => ({
				id: 'i1',
				email: 'a@b.co',
				role: 'staff',
				invitedByUserId: 'u',
				permissions: [],
			})),
			listPending: vi.fn(async () => ['pending']),
		};
		const service = new AdminInviteService(
			{
				normalizeEmail: (value: string) => value,
				hash: (value: string) => value,
				hashPassword: async (value: string) => value,
			} as never,
			invites as never,
			authUsers as never,
			{ save: async (user: unknown) => ({ ...(user as object), id: 'u9' }) } as never,
			{ append: async (entry: unknown) => entry } as never,
			{ send: async () => ({}) } as never,
			{ withTransaction: async (work: (context: object) => Promise<unknown>) => work({}) } as never,
		);
		return { service, authUsers };
	};

	it('lists what is pending', async () => {
		await expect(build().service.listPending()).resolves.toEqual(['pending']);
	});

	it('stores a chosen login method', async () => {
		const { service, authUsers } = build();
		await service.accept({
			token: 't',
			password: 'long-enough-password',
			preferredLoginMethod: 'pin',
			pin: '482916',
		} as never);
		expect(authUsers.setPreferredLoginMethod).toHaveBeenCalledWith('u9', 'pin');
	});
});

describe('OAuthService edges', () => {
	const build = (state: Record<string, unknown> | null, env: NodeJS.ProcessEnv = {}) => {
		const identities = { listForSubject: vi.fn(async () => ['id']), unlink: vi.fn(async () => true) };
		const service = new OAuthService(
			loadConfig({ ...secrets, ...env }) as never,
			{ consume: vi.fn(async () => state) } as never,
			identities as never,
			{ hash: (value: string) => `h:${value}` } as never,
		);
		return { service, identities };
	};
	const configured = { GOOGLE_OAUTH_CLIENT_ID: '1234.apps.googleusercontent.com' };
	const future = new Date(Date.now() + 60_000).toISOString();

	it('refuses a provider that is not configured', async () => {
		const { service } = build(null);
		await expect(service.verify({ provider: 'google', stateId: 's', credential: 'c' })).rejects.toBeInstanceOf(
			OAuthProviderUnavailableError,
		);
	});

	it.each([
		[
			'a state with no nonce',
			{ provider: 'google', expiresAt: future, nonceHash: null, guestCartId: 'g' },
			undefined,
			null,
		],
		['a matching nonce', { provider: 'google', expiresAt: future, nonceHash: 'h:n', guestCartId: null }, 'n', 'n'],
	])('verifies with %s', async (_name, state, nonce, expected) => {
		const { service } = build(state, configured);
		const verify = vi.fn(async () => ({ subject: 's' }));
		(service as unknown as { verifiers: { google: { verify: typeof verify } } }).verifiers.google = { verify };
		const result = await service.verify({ provider: 'google', stateId: 's', credential: 'c', nonce });
		expect(verify).toHaveBeenCalledWith({ credential: 'c', expectedNonce: expected });
		expect(result).toEqual({ identity: { subject: 's' }, guestCartId: state.guestCartId });
	});

	it('lists and detaches identities', async () => {
		const { service, identities } = build(null);
		await expect(service.listIdentities('c1')).resolves.toEqual(['id']);
		await expect(service.unlink('c1', 'google')).resolves.toBe(true);
		expect(identities.unlink).toHaveBeenCalledWith('customer', 'c1', 'google');
	});
});

describe('ContactChangeService edges', () => {
	const record = (overrides: Record<string, unknown> = {}) => ({
		id: 'p1',
		customerId: 'c1',
		field: 'email',
		newValue: 'new@example.test',
		sends: 1,
		lastSentAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 600_000).toISOString(),
		absoluteExpiresAt: new Date(Date.now() + 1_200_000).toISOString(),
		...overrides,
	});
	const build = (held: unknown = record()) => {
		const pending = {
			findByCustomerId: vi.fn(async () => held),
			recordSend: vi.fn(async () => null as unknown),
			consume: vi.fn(async () => null as unknown),
			deleteByCustomerId: vi.fn(async () => true),
		};
		const notifications = { send: vi.fn(async () => ({})) };
		const service = new ContactChangeService(
			pending as never,
			{ findByEmail: async () => null, findByPhone: async () => null } as never,
			{} as never,
			notifications as never,
			{ append: async () => ({}) } as never,
			{ withTransaction: async (work: () => Promise<unknown>) => work() } as never,
			{
				normalizeEmail: (value: string) => value,
				publicCustomer: async () => ({ id: 'c1', email: 'old@example.test', phone: null }),
				issueOtp: async () => undefined,
				verifyOtp: async () => ({ userId: 'c1' }),
				assertStepUp: async () => undefined,
			} as never,
		);
		return { service, pending, notifications };
	};
	const notify = (service: ContactChangeService) =>
		(service as unknown as { notifyPrevious: (...args: unknown[]) => Promise<void> }).notifyPrevious.bind(service);

	it('reports the change in flight, with its resend time', async () => {
		const { service } = build();
		const state = await service.pendingFor('c1');
		expect(state).toMatchObject({ field: 'email', sendsRemaining: expect.any(Number) });
		expect(state?.resendAvailableAt).toEqual(expect.any(String));
	});

	it('offers a resend at once when nothing was sent yet', async () => {
		const { service } = build(record({ lastSentAt: null, sends: 0 }));
		expect((await service.pendingFor('c1'))?.resendAvailableAt).toBeNull();
	});

	it('hides an expired change or none', async () => {
		expect(await build(record({ expiresAt: '2020-01-01T00:00:00.000Z' })).service.pendingFor('c1')).toBeNull();
		expect(await build(null).service.pendingFor('c1')).toBeNull();
	});

	it('cancels', async () => {
		const { service, pending } = build();
		await service.cancel('c1');
		expect(pending.deleteByCustomerId).toHaveBeenCalledWith('c1');
	});

	it('keeps its record when the resend is not stored', async () => {
		const { service } = build();
		const internals = service as unknown as { send: (held: unknown) => Promise<unknown> };
		const held = record({ lastSentAt: null, sends: 0 });
		await expect(internals.send(held)).resolves.toBe(held);
	});

	it('refuses when somebody else finished the change first', async () => {
		const { service } = build();
		await expect(service.confirm('c1', '123456')).rejects.toMatchObject({
			response: { issues: [{ code: 'contact_change_expired' }] },
		});
	});

	it('warns the old value, never failing the change', async () => {
		const { service, notifications } = build();
		notifications.send.mockRejectedValueOnce(new Error('bounced'));
		await expect(
			notify(service)({ id: 'c1', email: 'old@example.test', phone: null }, 'email', 'new@example.test'),
		).resolves.toBeUndefined();
		expect(notifications.send).toHaveBeenCalledOnce();
	});

	it('warns nobody when there was no old value', async () => {
		const { service, notifications } = build();
		await notify(service)({ id: 'c1', email: null, phone: null }, 'phone', '+919000000000');
		expect(notifications.send).not.toHaveBeenCalled();
	});
});

describe('storefront controllers', () => {
	const principal = { userId: 'c1' } as never;

	it('refuses addresses for an account that is gone', async () => {
		const customers = { findById: vi.fn(async () => null), addAddress: vi.fn(async () => null) };
		const controller = new StorefrontAddressesController(customers as never);
		await expect(controller.list(principal)).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(controller.add({} as never, principal)).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('refuses a profile change for an account that is gone', async () => {
		const controller = new StorefrontProfileController({ update: vi.fn(async () => null) } as never);
		await expect(controller.update({ displayName: 'A' } as never, principal)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});
});

describe('small rules', () => {
	it('reads the principal off the request', () => {
		class Holder {
			handler(): void {}
		}
		Principal()(Holder.prototype, 'handler', 0);
		const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Holder, 'handler') as Record<
			string,
			{ factory: (data: unknown, context: unknown) => unknown }
		>;
		const parameter = Object.values(metadata)[0];
		const context = { switchToHttp: () => ({ getRequest: () => ({ principal: 'me' }) }) };
		expect(parameter?.factory(undefined, context)).toBe('me');
	});

	it('peppers tokens with the refresh secret when there is no CSRF secret', () => {
		const config = { cookies: {}, jwt: { refreshSecret: 'refresh' } } as never;
		const sessions = new SessionService(config, {} as never, {} as never, {} as never, {} as never);
		expect(sessions.hashOpaqueToken('t')).toHaveLength(64);
		expect(new CartService({} as never, config).hashGuestToken('t')).toHaveLength(64);
	});

	it('scopes the CSRF cookie to a configured domain', () => {
		const config = loadConfig({ ...secrets, COOKIE_DOMAIN: '.example.test' });
		expect(csrfCookieOptions(config)).toMatchObject({ domain: '.example.test' });
	});

	it('needs both Cloudflare settings or neither', () => {
		expect(() => loadConfig({ ...secrets, CLOUDFLARE_ZONE_ID: 'zone' })).toThrow();
	});

	it('refuses a fixed one-time code on a real deployment', () => {
		const config = loadConfig({ ...secrets });
		const problems = deploymentHardeningProblems(
			{ ...config, nodeEnv: 'production', otp: { ...config.otp, localFixedCode: '123456' } } as never,
			{},
		);
		expect(problems).toContain('OTP_LOCAL_FIXED_CODE must not be set: it makes every one-time code guessable.');
	});

	it('wires the auth port from the configuration', () => {
		const providers = Reflect.getMetadata('providers', PersistenceModule) as Array<{
			provide?: unknown;
			useFactory?: (config: unknown) => unknown;
		}>;
		const factory = providers.find((row) => row.provide === AUTH_PORT)?.useFactory;
		expect(factory?.(loadConfig({ ...secrets }))).toBeDefined();
	});
});
