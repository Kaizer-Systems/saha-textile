import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthController } from '../src/auth/admin-auth.controller';

/**
 * `/auth/admin/me` must return effective permissions (embedded ∪ active role grants),
 * not only the embedded array. First-admin leaves `permissions: []` and assigns the
 * system administrator role — returning embedded alone blanks the whole admin UI.
 */
describe('AdminAuthController.me effective permissions', () => {
	const principal = {
		userId: 'adm_owner',
		sessionId: 'sess_1',
		audience: 'admin' as const,
		role: 'admin' as const,
		permissions: [] as string[],
	};

	const authState = {
		id: 'adm_owner',
		role: 'admin' as const,
		permissions: [] as string[],
		status: 'active' as const,
		tokenVersion: 0,
		permissionsVersion: 0,
	};

	const publicUser = {
		id: 'adm_owner',
		email: 'owner@saha-textile.test',
		emailVerified: true,
		username: 'owner',
		displayName: 'Owner',
		role: 'admin',
		status: 'active',
		pinConfigured: true,
		preferredLoginMethod: 'password',
		lastLoginAt: null,
	};

	let auth: {
		adminAuthRepository: { findAuthStateById: ReturnType<typeof vi.fn> };
		publicAdminUser: ReturnType<typeof vi.fn>;
		adminUserRepository: { findById: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
	};
	let sessions: { findLiveById: ReturnType<typeof vi.fn> };
	let roles: { findById: ReturnType<typeof vi.fn> };
	let assignments: { listActiveForUser: ReturnType<typeof vi.fn> };
	let controller: AdminAuthController;

	beforeEach(() => {
		auth = {
			adminAuthRepository: { findAuthStateById: vi.fn(async () => authState) },
			publicAdminUser: vi.fn(async () => publicUser),
			adminUserRepository: {
				findById: vi.fn(async () => publicUser),
				save: vi.fn(async (u: unknown) => u),
			},
		};
		sessions = {
			findLiveById: vi.fn(async () => ({
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			})),
		};
		roles = { findById: vi.fn() };
		assignments = { listActiveForUser: vi.fn(async () => []) };
		controller = new AdminAuthController(
			auth as never,
			sessions as never,
			{} as never,
			{} as never,
			roles as never,
			assignments as never,
		);
	});

	it('refuses anonymous callers', async () => {
		await expect(controller.me(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it('returns embedded permissions when there are no role assignments', async () => {
		auth.adminAuthRepository.findAuthStateById.mockResolvedValue({
			...authState,
			permissions: ['order.index'],
		});
		assignments.listActiveForUser.mockResolvedValue([]);

		const me = await controller.me(principal);
		expect(me.permissions).toEqual(['order.index']);
		expect(me.user.id).toBe('adm_owner');
	});

	it('unions administrator role grants when embedded permissions are empty', async () => {
		assignments.listActiveForUser.mockResolvedValue([
			{
				id: 'ura_1',
				userId: 'adm_owner',
				roleId: 'role_system_administrator',
				assignedAt: new Date().toISOString(),
				revokedAt: null,
			},
		]);
		roles.findById.mockResolvedValue({
			id: 'role_system_administrator',
			key: 'administrator',
			label: 'Administrator',
			baseRole: 'admin',
			permissions: ['product.index', 'customer.index', 'setting.index'],
			isSystem: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const me = await controller.me(principal);
		expect(me.permissions.sort()).toEqual(['customer.index', 'product.index', 'setting.index'].sort());
	});

	it('fails closed to embedded grants if assignment lookup throws', async () => {
		auth.adminAuthRepository.findAuthStateById.mockResolvedValue({
			...authState,
			permissions: ['role.index'],
		});
		assignments.listActiveForUser.mockRejectedValue(new Error('db down'));

		const me = await controller.me(principal);
		expect(me.permissions).toEqual(['role.index']);
	});

	it('persists phone on self profile update', async () => {
		const saved = await controller.updateProfile(principal, {
			displayName: 'Owner',
			phone: '+919876543210',
		});
		expect(auth.adminUserRepository.save).toHaveBeenCalledWith(
			expect.objectContaining({ displayName: 'Owner', phone: '+919876543210' }),
		);
		expect(saved).toMatchObject({ displayName: 'Owner', phone: '+919876543210' });
	});
});
