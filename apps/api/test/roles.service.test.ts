import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Role } from '@saha-textile/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RolesService } from '../src/admin/roles.service';

const ACTOR = 'user_actor';

const roleFixture = (overrides: Partial<Role> = {}): Role => ({
	id: 'role_1',
	key: 'catalog-editor',
	label: 'Catalog editor',
	description: null,
	baseRole: 'staff',
	permissions: ['product.index'],
	isSystem: false,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});

describe('RolesService', () => {
	const roles = {
		findById: vi.fn(),
		findByKey: vi.fn(),
		listAll: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		deleteById: vi.fn(),
	};
	const assignments = { listActiveForRole: vi.fn(async (): Promise<unknown[]> => []) };
	const users = { bumpPermissionsVersion: vi.fn(async () => 2) };
	const audit = { append: vi.fn(async (entry: unknown) => entry) };

	const service = () => new RolesService(roles as never, assignments as never, users as never, audit as never);

	beforeEach(() => {
		vi.clearAllMocks();
		roles.findByKey.mockResolvedValue(null);
		roles.create.mockImplementation(async (role: Role) => role);
		assignments.listActiveForRole.mockResolvedValue([]);
	});

	describe('create', () => {
		it('persists and audits a new role', async () => {
			const created = await service().create(
				ACTOR,
				{ key: 'catalog-editor', label: 'Catalog editor', baseRole: 'staff', permissions: ['product.index'] },
				'req_1',
			);

			expect(created.key).toBe('catalog-editor');
			expect(audit.append).toHaveBeenCalledTimes(1);
			expect(audit.append.mock.calls[0]?.[0]).toMatchObject({
				action: 'admin.role.create',
				entityType: 'role',
				actorUserId: ACTOR,
				severity: 'warn',
				retentionTier: 'financial_security',
				requestId: 'req_1',
			});
		});

		/**
		 * A caller who could set this would be minting a role the administration surface then
		 * refuses to delete — an undeletable rogue role, created through the screen meant to
		 * control them.
		 */
		it('never accepts isSystem from the caller', async () => {
			const created = await service().create(
				ACTOR,
				{ key: 'x', label: 'X', baseRole: 'staff', permissions: [], isSystem: true } as never,
				null,
			);

			expect(created.isSystem).toBe(false);
		});

		it('answers 409 rather than letting the unique index surface as a 500', async () => {
			roles.findByKey.mockResolvedValue(roleFixture());

			await expect(
				service().create(
					ACTOR,
					{ key: 'catalog-editor', label: 'X', baseRole: 'staff', permissions: [] },
					null,
				),
			).rejects.toBeInstanceOf(ConflictException);
			expect(roles.create).not.toHaveBeenCalled();
		});
	});

	describe('update', () => {
		it('refuses a system role with a reason rather than a silent miss', async () => {
			roles.findById.mockResolvedValue(roleFixture({ isSystem: true }));

			await expect(service().update(ACTOR, 'role_1', { label: 'Hijacked' }, null)).rejects.toBeInstanceOf(
				ConflictException,
			);
			expect(roles.update).not.toHaveBeenCalled();
		});

		it('answers 404 for a role that does not exist', async () => {
			roles.findById.mockResolvedValue(null);

			await expect(service().update(ACTOR, 'missing', { label: 'X' }, null)).rejects.toBeInstanceOf(
				NotFoundException,
			);
		});

		/**
		 * The invalidation rule. A permission change must re-authorize live holders, or their
		 * sessions keep running on the authority they held a moment ago.
		 */
		it('invalidates every live holder when the permission set changes', async () => {
			roles.findById.mockResolvedValue(roleFixture({ permissions: ['product.index'] }));
			roles.update.mockResolvedValue(roleFixture({ permissions: ['product.index', 'order.index'] }));
			assignments.listActiveForRole.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);

			const result = await service().update(
				ACTOR,
				'role_1',
				{ permissions: ['product.index', 'order.index'] },
				null,
			);

			expect(result.invalidatedSessions).toBe(2);
			expect(users.bumpPermissionsVersion).toHaveBeenCalledWith('u1');
			expect(users.bumpPermissionsVersion).toHaveBeenCalledWith('u2');
		});

		/** The other half: a rename must not force everyone through a token rotation. */
		it('does not invalidate anybody for a label-only edit', async () => {
			roles.findById.mockResolvedValue(roleFixture());
			roles.update.mockResolvedValue(roleFixture({ label: 'Renamed' }));
			assignments.listActiveForRole.mockResolvedValue([{ userId: 'u1' }]);

			const result = await service().update(ACTOR, 'role_1', { label: 'Renamed' }, null);

			expect(result.invalidatedSessions).toBe(0);
			expect(users.bumpPermissionsVersion).not.toHaveBeenCalled();
		});

		it('does not invalidate when the same permissions are resent in another order', async () => {
			roles.findById.mockResolvedValue(roleFixture({ permissions: ['order.index', 'product.index'] }));
			roles.update.mockResolvedValue(roleFixture({ permissions: ['product.index', 'order.index'] }));
			assignments.listActiveForRole.mockResolvedValue([{ userId: 'u1' }]);

			const result = await service().update(
				ACTOR,
				'role_1',
				{ permissions: ['product.index', 'order.index'] },
				null,
			);

			expect(result.invalidatedSessions).toBe(0);
		});

		/**
		 * One unbumpable account must not abandon the operation half-applied, leaving the role
		 * changed while some holders were invalidated and others silently were not.
		 */
		it('continues invalidating after a single holder fails', async () => {
			roles.findById.mockResolvedValue(roleFixture({ permissions: [] }));
			roles.update.mockResolvedValue(roleFixture({ permissions: ['order.index'] }));
			assignments.listActiveForRole.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
			users.bumpPermissionsVersion.mockRejectedValueOnce(new Error('write conflict'));

			const result = await service().update(ACTOR, 'role_1', { permissions: ['order.index'] }, null);

			expect(result.invalidatedSessions).toBe(2);
			expect(users.bumpPermissionsVersion).toHaveBeenCalledTimes(3);
		});
	});

	describe('delete', () => {
		it('refuses a system role', async () => {
			roles.findById.mockResolvedValue(roleFixture({ isSystem: true }));

			await expect(service().remove(ACTOR, 'role_1', null)).rejects.toBeInstanceOf(ConflictException);
			expect(roles.deleteById).not.toHaveBeenCalled();
		});

		/**
		 * Deleting already removes the authority — a dangling assignment resolves to nothing —
		 * but a live session keeps its minted version until something forces a re-derive.
		 */
		it('invalidates holders as well as deleting', async () => {
			roles.findById.mockResolvedValue(roleFixture());
			roles.deleteById.mockResolvedValue(true);
			assignments.listActiveForRole.mockResolvedValue([{ userId: 'u1' }]);

			const result = await service().remove(ACTOR, 'role_1', null);

			expect(result.invalidatedSessions).toBe(1);
			expect(users.bumpPermissionsVersion).toHaveBeenCalledWith('u1');
			expect(audit.append.mock.calls[0]?.[0]).toMatchObject({ action: 'admin.role.delete' });
		});

		it('answers 404 for a role that does not exist', async () => {
			roles.findById.mockResolvedValue(null);

			await expect(service().remove(ACTOR, 'missing', null)).rejects.toBeInstanceOf(NotFoundException);
		});
	});
});
