import { ForbiddenException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminCustomersController } from '../src/admin/admin-customers.controller';
import { AdminNotificationsController } from '../src/admin/admin-notifications.controller';
import { AdminUsersController } from '../src/admin/admin-users.controller';
import { AuditLogsController } from '../src/admin/audit-logs.controller';
import { AuditLogsService } from '../src/admin/audit-logs.service';
import { PermissionsController } from '../src/admin/permissions.controller';
import { RolesController } from '../src/admin/roles.controller';
import { AUDIENCE_KEY, PUBLIC_ROUTE_KEY, ROLES_KEY, SessionGuard } from '../src/auth/session.guard';
import { cookieNames, sessionCookieOptions } from '../src/common/cookies';
import { CsrfGuard } from '../src/common/csrf.guard';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { resolveClientIp } from '../src/common/request-context';
import { SecurityController } from '../src/security/security.controller';
import { StorefrontContactController } from '../src/storefront/storefront-contact.controller';

const principal = { userId: 'adm_1', sessionId: 's1', audience: 'admin', permissions: [] } as never;
const request = (id: unknown = 'req-1') => ({ id, ip: '1.2.3.4' }) as never;

describe('admin customer routes', () => {
	const customers = {
		list: vi.fn(async () => 'list'),
		create: vi.fn(async () => 'created'),
		get: vi.fn(async () => 'one'),
		listOrders: vi.fn(async () => 'orders'),
		update: vi.fn(async () => 'updated'),
		resendActivation: vi.fn(async () => 'resent'),
		addAddress: vi.fn(async () => 'added'),
		updateAddress: vi.fn(async () => 'changed'),
		deleteAddress: vi.fn(async () => 'gone'),
	};
	const lifecycle = { softDelete: vi.fn(async () => 'deleted'), restore: vi.fn(async () => 'restored') };
	const controller = new AdminCustomersController(customers as never, lifecycle as never);

	it('hands every route to the service', async () => {
		expect(await controller.list({} as never)).toBe('list');
		await controller.listDeleted({ page: 1 } as never);
		expect(customers.list).toHaveBeenLastCalledWith({ page: 1, status: 'deleted' });
		expect(await controller.create({} as never)).toBe('created');
		expect(await controller.get('c')).toBe('one');
		expect(await controller.listOrders('c', {} as never)).toBe('orders');
		expect(await controller.update('c', {} as never)).toBe('updated');
		expect(await controller.resend('c', {} as never)).toBe('resent');
		expect(await controller.addAddress('c', {} as never)).toBe('added');
		expect(await controller.updateAddress('c', 'a', {} as never)).toBe('changed');
		expect(await controller.deleteAddress('c', 'a')).toBe('gone');
	});

	it('names the actor on delete and restore, and needs one', async () => {
		await controller.softDelete('c', principal, request());
		expect(lifecycle.softDelete).toHaveBeenLastCalledWith('c', { actorUserId: 'adm_1', requestId: 'req-1' });
		await controller.restore('c', principal, request(7));
		expect(lifecycle.restore).toHaveBeenLastCalledWith('c', { actorUserId: 'adm_1', requestId: null });
		expect(() => controller.softDelete('c', undefined, request())).toThrow(UnauthorizedException);
	});
});

describe('admin user and role routes', () => {
	it('hands user work to the service', async () => {
		const users = {
			list: vi.fn(async () => 'list'),
			authority: vi.fn(async () => 'authority'),
			assignRole: vi.fn(async () => 'assigned'),
			revokeRole: vi.fn(async () => 'revoked'),
			setStatus: vi.fn(async () => 'status'),
		};
		const controller = new AdminUsersController(users as never);
		expect(await controller.list({} as never)).toBe('list');
		expect(await controller.authority('u')).toBe('authority');
		await controller.assign('u', { roleId: 'r' } as never, principal, request());
		expect(users.assignRole).toHaveBeenCalledWith('adm_1', 'u', 'r', 'req-1');
		await controller.revoke('u', 'r', principal, request(7));
		expect(users.revokeRole).toHaveBeenCalledWith('adm_1', 'u', 'r', null);
		await controller.setStatus('u', { status: 'active', reason: 'why' } as never, principal, request());
		expect(users.setStatus).toHaveBeenLastCalledWith('adm_1', 'u', 'active', 'why', 'req-1');
		await controller.setStatus('u', { status: 'active' } as never, principal, request());
		expect(users.setStatus).toHaveBeenLastCalledWith('adm_1', 'u', 'active', null, 'req-1');
		expect(() => controller.assign('u', {} as never, undefined, request())).toThrow(UnauthorizedException);
		expect(() => controller.revoke('u', 'r', undefined, request())).toThrow(UnauthorizedException);
		expect(() => controller.setStatus('u', {} as never, undefined, request())).toThrow(UnauthorizedException);
	});

	it('hands role work to the service', async () => {
		const roles = {
			list: vi.fn(async () => ['r']),
			get: vi.fn(async () => 'one'),
			create: vi.fn(async () => 'created'),
			update: vi.fn(async () => ({ role: 'updated' })),
			remove: vi.fn(async () => undefined),
		};
		const controller = new RolesController(roles as never);
		expect(await controller.list()).toEqual({ items: ['r'] });
		expect(await controller.get('r')).toBe('one');
		expect(await controller.create({} as never, principal, request())).toBe('created');
		expect(await controller.update('r', {} as never, principal, request(7))).toBe('updated');
		await controller.remove('r', principal, request());
		expect(roles.remove).toHaveBeenCalledWith('adm_1', 'r', 'req-1');
		expect(() => controller.create({} as never, undefined, request())).toThrow(UnauthorizedException);
		await expect(controller.update('r', {} as never, undefined, request())).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		await expect(controller.remove('r', undefined, request())).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('hands notification work to the service', async () => {
		const notifications = {
			providerStatus: vi.fn(() => 'status'),
			listChannels: vi.fn(async () => ['c']),
			toggle: vi.fn(async () => 'toggled'),
			usage: vi.fn(async () => ['u']),
			listTemplates: vi.fn(async () => ['t']),
			upsertTemplate: vi.fn(async () => 'saved'),
		};
		const controller = new AdminNotificationsController(notifications as never);
		expect(controller.provider()).toBe('status');
		expect(await controller.listChannels()).toEqual({ items: ['c'] });
		expect(await controller.toggle({} as never, principal, request())).toBe('toggled');
		expect(await controller.usage()).toEqual({ items: ['u'] });
		expect(await controller.listTemplates()).toEqual({ items: ['t'] });
		expect(await controller.upsertTemplate({} as never, principal, request(7))).toBe('saved');
		expect(() => controller.toggle({} as never, undefined, request())).toThrow(UnauthorizedException);
		expect(() => controller.upsertTemplate({} as never, undefined, request())).toThrow(UnauthorizedException);
	});

	it('reads the audit trail and the permission list', async () => {
		const repo = {
			list: vi.fn(async () => ({
				items: [
					{
						id: 'a',
						actorUserId: 'adm_1',
						targetUserId: null,
						audience: 'admin',
						action: 'x',
						entityType: null,
						entityId: null,
						severity: 'info',
						retentionTier: 'catalog_admin',
						diffs: [],
						metadata: {},
						requestId: null,
						ipHash: 'hash',
						userAgentHash: 'hash',
						createdAt: '2026-11-06T00:00:00.000Z',
					},
				],
				total: 1,
				page: 1,
				pageSize: 20,
			})),
		};
		const controller = new AuditLogsController(new AuditLogsService(repo as never));
		const page = await controller.list({ page: 1, pageSize: 20 } as never);
		expect(page.total).toBe(1);
		expect(JSON.stringify(page.items)).not.toContain('hash');
		expect(new PermissionsController().list().items.length).toBeGreaterThan(0);
	});

	it('sends the CSRF token', async () => {
		const reply = { status: vi.fn(), send: vi.fn() };
		reply.status.mockReturnValue(reply);
		await new SecurityController({ issueCsrfToken: async () => 'token' } as never).issueCsrfToken(
			{} as never,
			reply as never,
		);
		expect(reply.send).toHaveBeenCalledWith({ csrfToken: 'token' });
	});
});

describe('contact change routes', () => {
	const build = () => {
		const contact = {
			pendingFor: vi.fn(async () => 'pending'),
			start: vi.fn(async () => 'started'),
			resend: vi.fn(async () => 'resent'),
			confirm: vi.fn(async () => 'customer'),
			cancel: vi.fn(async () => {}),
		};
		const sessions = { revokeOtherSessions: vi.fn(async () => 1) };
		const auth = { consumeRateLimit: vi.fn(async () => ({ allowed: true }) as unknown) };
		return {
			contact,
			sessions,
			auth,
			controller: new StorefrontContactController(contact as never, sessions as never, auth as never),
		};
	};
	const shopper = { userId: 'cus_1' } as never;
	const reply = () => ({ header: vi.fn() }) as never;

	it('needs a session', async () => {
		const { controller } = build();
		await expect(controller.pending(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(controller.confirm({ code: '1' } as never, undefined)).rejects.toBeInstanceOf(
			UnauthorizedException,
		);
		await expect(controller.cancel(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('starts each kind of change within budget', async () => {
		const { controller, contact, auth } = build();
		expect(await controller.pending(shopper)).toEqual({ pending: 'pending' });
		await controller.startEmail(
			{ newEmail: 'a@example.test', password: 'p' } as never,
			shopper,
			request(),
			reply(),
		);
		expect(contact.start).toHaveBeenLastCalledWith(
			expect.objectContaining({ field: 'email', rawValue: 'a@example.test' }),
		);
		await controller.startPhone({ newPhone: '+91', otpCode: '1' } as never, shopper, request(), reply());
		expect(contact.start).toHaveBeenLastCalledWith(
			expect.objectContaining({ field: 'phone', proof: { password: undefined, otpCode: '1' } }),
		);
		expect(await controller.resend(shopper, request(), reply())).toBe('resent');
		auth.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 3 });
		await expect(controller.resend(shopper, request(), reply())).rejects.toBeInstanceOf(HttpException);
	});

	it('signs other devices out after a confirmed change, and cancels', async () => {
		const { controller, sessions, contact } = build();
		expect(await controller.confirm({ code: '1' } as never, shopper)).toBe('customer');
		expect(sessions.revokeOtherSessions).toHaveBeenCalledTimes(1);
		await controller.cancel(shopper);
		expect(contact.cancel).toHaveBeenCalledWith('cus_1');
	});
});

describe('SessionGuard on public routes', () => {
	const config = { cookies: { accessName: 'st_access', refreshName: 'st_refresh', secure: false } } as never;
	const names = cookieNames(config);
	const metadata = (values: Record<string, unknown>) => ({
		getAllAndOverride: vi.fn((key: string) => values[key]),
	});
	const context = (cookies: Record<string, string>) => {
		const req = { cookies, headers: {} } as Record<string, unknown>;
		return {
			req,
			value: {
				getHandler: () => ({}),
				getClass: () => ({}),
				switchToHttp: () => ({ getRequest: () => req }),
			} as unknown as ExecutionContext,
		};
	};
	const guard = (reflector: unknown, overrides: Record<string, unknown> = {}) => {
		const auth = {
			verifyToken: vi.fn(
				async () => ({ sub: 'cus_1', sid: 's1', aud: 'storefront', tokenVersion: 1 }) as unknown,
			),
		};
		const customerAuth = {
			findAuthStateById: vi.fn(async () => ({ id: 'cus_1', status: 'active', tokenVersion: 1 }) as unknown),
		};
		const adminAuth = {
			findAuthStateById: vi.fn(
				async () =>
					({
						id: 'adm_1',
						status: 'active',
						role: 'staff',
						tokenVersion: 1,
						permissionsVersion: 1,
						permissions: [],
					}) as unknown,
			),
		};
		const sessions = { findLiveById: vi.fn(async () => ({ id: 's1' }) as unknown) };
		const assignments = { listActiveForUser: vi.fn(async () => [] as unknown[]) };
		const value = new SessionGuard(
			reflector as never,
			config,
			auth as never,
			customerAuth as never,
			adminAuth as never,
			{ findById: vi.fn() } as never,
			assignments as never,
			sessions as never,
		);
		return { value, auth, customerAuth, adminAuth, sessions, ...overrides };
	};

	it('lets a public route through on every kind of bad session, with no principal', async () => {
		const key = PUBLIC_ROUTE_KEY;
		const check = async (mutate: (parts: ReturnType<typeof guard>) => void) => {
			const parts = guard(metadata({ [key]: true }));
			mutate(parts);
			const { req, value } = context({ [names.access]: 'jwt' });
			expect(await parts.value.canActivate(value)).toBe(true);
			expect(req['principal']).toBeUndefined();
		};
		await check((parts) => parts.auth.verifyToken.mockRejectedValue(new Error('expired')));
		await check((parts) => parts.auth.verifyToken.mockResolvedValue({}));
		await check((parts) => parts.sessions.findLiveById.mockResolvedValue(null));
		await check((parts) => parts.customerAuth.findAuthStateById.mockResolvedValue(null));
		await check((parts) => parts.customerAuth.findAuthStateById.mockResolvedValue({ status: 'disabled' }));
		await check((parts) =>
			parts.auth.verifyToken.mockResolvedValue({ sub: 'cus_1', sid: 's1', aud: 'storefront' }),
		);
	});

	it('lets a public route through with no cookie, and with an admin token whose grants moved', async () => {
		const key = PUBLIC_ROUTE_KEY;
		const empty = context({});
		expect(await guard(metadata({ [key]: true })).value.canActivate(empty.value)).toBe(true);
		const parts = guard(metadata({ [key]: true }));
		parts.auth.verifyToken.mockResolvedValue({ sub: 'adm_1', sid: 's1', aud: 'admin', tokenVersion: 1 });
		const { req, value } = context({ [names.access]: 'jwt' });
		expect(await parts.value.canActivate(value)).toBe(true);
		expect(req['principal']).toBeUndefined();
	});

	it('resolves the principal on a public route with a good session', async () => {
		const key = PUBLIC_ROUTE_KEY;
		const { req, value } = context({ [names.access]: 'jwt' });
		expect(await guard(metadata({ [key]: true })).value.canActivate(value)).toBe(true);
		expect(req['principal']).toMatchObject({ userId: 'cus_1', role: null });
	});

	it('ignores a wrong audience on a public route', async () => {
		const key = PUBLIC_ROUTE_KEY;
		const { value } = context({ [names.access]: 'jwt' });
		expect(await guard(metadata({ [key]: true, [AUDIENCE_KEY]: 'admin' })).value.canActivate(value)).toBe(true);
	});

	it('refuses malformed claims and a role that does not qualify', async () => {
		const parts = guard(metadata({}));
		parts.auth.verifyToken.mockResolvedValue({});
		await expect(parts.value.canActivate(context({ [names.access]: 'jwt' }).value)).rejects.toThrow(
			'Malformed session',
		);
		const staff = guard(metadata({ [ROLES_KEY]: ['admin'] }));
		staff.auth.verifyToken.mockResolvedValue({
			sub: 'adm_1',
			sid: 's1',
			aud: 'admin',
			tokenVersion: 1,
			permissionsVersion: 1,
		});
		await expect(staff.value.canActivate(context({ [names.access]: 'jwt' }).value)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		const customer = guard(metadata({ [ROLES_KEY]: ['admin'] }));
		await expect(customer.value.canActivate(context({ [names.access]: 'jwt' }).value)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
	});

	it('refuses a stale token with no version at all', async () => {
		const parts = guard(metadata({}));
		parts.auth.verifyToken.mockResolvedValue({ sub: 'cus_1', sid: 's1', aud: 'storefront' });
		await expect(parts.value.canActivate(context({ [names.access]: 'jwt' }).value)).rejects.toThrow(
			'no longer valid',
		);
		const admin = guard(metadata({}));
		admin.auth.verifyToken.mockResolvedValue({ sub: 'adm_1', sid: 's1', aud: 'admin', tokenVersion: 1 });
		await expect(admin.value.canActivate(context({ [names.access]: 'jwt' }).value)).rejects.toThrow(
			'Permissions changed',
		);
	});
});

describe('HttpExceptionFilter', () => {
	const run = (exception: unknown, requestOverrides: Record<string, unknown> = { id: 'r1' }) => {
		const reply = { status: vi.fn(), header: vi.fn(), send: vi.fn() };
		reply.status.mockReturnValue(reply);
		reply.header.mockReturnValue(reply);
		const host = {
			switchToHttp: () => ({
				getRequest: () => ({ method: 'GET', url: '/x', ...requestOverrides }),
				getResponse: () => reply,
			}),
		};
		new HttpExceptionFilter().catch(exception, host as never);
		return reply;
	};

	it('maps issue paths of every shape', () => {
		const reply = run(
			new HttpException(
				{
					issues: [
						{ path: 'a.b', message: 'Bad', code: 'custom' },
						{ path: ['a', 1], message: 'Worse' },
						{ path: 7, message: 3 },
					],
				},
				400,
			),
		);
		const body = reply.send.mock.calls[0]?.[0] as { error: { issues: unknown[] } };
		expect(body.error.issues).toEqual([
			{ path: ['a', 'b'], message: 'Bad', code: 'custom' },
			{ path: ['a', 1], message: 'Worse' },
			{ path: [], message: 'Invalid value' },
		]);
	});

	it('hides a crash that is not an Error, with no request id', () => {
		const reply = run('text', { id: undefined });
		const body = reply.send.mock.calls[0]?.[0] as { error: { message: string; requestId: unknown } };
		expect(body.error).toMatchObject({ message: 'Something went wrong.', requestId: null });
		expect(reply.header).toHaveBeenCalledWith(expect.any(String), '');
	});

	it('treats a numeric request id as none in the body', () => {
		const reply = run(new NotFoundException(), { id: 7 });
		expect((reply.send.mock.calls[0]?.[0] as { error: { requestId: unknown } }).error.requestId).toBeNull();
	});

	it('falls back to internal for a status it has no code for', () => {
		const reply = run(new HttpException('teapot', 418));
		expect((reply.send.mock.calls[0]?.[0] as { error: { code: string } }).error.code).toBe('internal');
	});
});

describe('small platform rules', () => {
	const config = {
		cookies: {
			secure: false,
			domain: 'shop.test',
			accessName: 'access',
			refreshName: 'st_refresh',
			csrfName: 'st_csrf',
			guestName: 'g',
			signupName: 's',
			csrfHeader: 'X-CSRF',
		},
	} as never;

	it('sets a cookie domain when one is pinned', () => {
		expect(sessionCookieOptions(config, 10)).toMatchObject({ domain: 'shop.test' });
	});

	it('prefixes an admin cookie with no st_ name', () => {
		expect(cookieNames(config, 'admin').access).toBe('admin_access');
	});

	it('reads the first value of a repeated header', () => {
		const trusted = { trustProxy: true, clientIpHeader: 'CF-Connecting-IP' } as never;
		expect(
			resolveClientIp({ headers: { 'cf-connecting-ip': ['9.9.9.9, 1.1.1.1'] }, ip: '1.2.3.4' } as never, trusted),
		).toBe('9.9.9.9');
	});

	it('reads a CSRF header given as a list, and a request with no cookies', async () => {
		const sessions = {
			resolveLiveSessionFromRequest: vi.fn(async () => ({ id: 's1' })),
			verifyCsrfForSession: vi.fn(() => true),
		};
		const guard = new CsrfGuard(config, sessions as never);
		const contextFor = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;
		const names = cookieNames(config);
		await expect(
			guard.canActivate(
				contextFor({
					method: 'POST',
					headers: { 'x-csrf': ['token'] },
					cookies: { [names.access]: 'a', [names.csrf]: 'token' },
				}),
			),
		).resolves.toBe(true);
		await expect(guard.canActivate(contextFor({ method: 'POST', headers: {} }))).resolves.toBe(true);
	});
});
