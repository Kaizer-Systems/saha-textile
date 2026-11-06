import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapFirstAdmin, FirstAdminAlreadyExistsError } from '../src/first-admin';
import {
	ADMIN_USER_AUTH_REPOSITORY,
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	AUTH_PORT,
	ROLE_REPOSITORY,
} from '../src/infra/tokens';

const policy = vi.hoisted(() => ({ refusal: null as string | null }));

vi.mock('@saha-textile/core-domain', async (original) => {
	const real = await original<{ evaluatePassword: (password: string) => unknown }>();
	return {
		...real,
		evaluatePassword: (password: string) =>
			policy.refusal ? { acceptable: false, refusal: policy.refusal } : real.evaluatePassword(password),
	};
});

const build = () => {
	const roles = { findByKey: vi.fn(async () => ({ id: 'role_admin', key: 'administrator' }) as unknown) };
	const assignments = { listActiveForRole: vi.fn(async () => [] as unknown[]), assign: vi.fn(async () => ({})) };
	const audit = { append: vi.fn(async (entry: unknown) => entry) };
	const auth = { hashPassword: vi.fn(async () => 'hashed') };
	const adminAuth = { setPasswordHash: vi.fn(async () => undefined) };
	const tokens = new Map<unknown, unknown>([
		[ROLE_REPOSITORY, roles],
		[ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY, assignments],
		[AUDIT_LOG_REPOSITORY, audit],
		[AUTH_PORT, auth],
		[ADMIN_USER_AUTH_REPOSITORY, adminAuth],
	]);
	const existing = { value: null as unknown };
	const create = vi.fn(async () => []);
	const deps = {
		models: { AdminUserModel: { findOne: () => ({ lean: () => ({ exec: async () => existing.value }) }), create } },
		ensureSystemRoles: vi.fn(async () => undefined),
		administratorRoleKey: 'administrator',
	};
	const app = { get: (token: unknown) => tokens.get(token) } as never;
	return { app, deps, roles, assignments, audit, adminAuth, existing, create };
};

afterEach(() => {
	policy.refusal = null;
});

describe('bootstrapFirstAdmin', () => {
	it('creates the account, its assignment and a critical audit row', async () => {
		const { app, deps, assignments, audit, adminAuth, create } = build();
		const result = await bootstrapFirstAdmin(app, { email: ' Owner@Example.Test ' }, deps);
		expect(result.email).toBe('owner@example.test');
		expect(result.password.length).toBeGreaterThan(20);
		expect(result.roleKey).toBe('administrator');
		expect(create).toHaveBeenCalledOnce();
		expect(adminAuth.setPasswordHash).toHaveBeenCalledWith(result.userId, 'hashed');
		expect(assignments.assign).toHaveBeenCalledWith(expect.objectContaining({ assignedByUserId: null }));
		expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
		expect(JSON.stringify(audit.append.mock.calls)).not.toContain(result.password);
	});

	it('stops when the administrator role is missing after seeding', async () => {
		const { app, deps, roles } = build();
		roles.findByKey.mockResolvedValue(null);
		await expect(bootstrapFirstAdmin(app, { email: 'a@b.co' }, deps)).rejects.toThrow('is missing after seeding');
	});

	it('refuses when an assignment already exists', async () => {
		const { app, deps, assignments, create } = build();
		assignments.listActiveForRole.mockResolvedValue([{ userId: 'u' }]);
		await expect(bootstrapFirstAdmin(app, { email: 'a@b.co' }, deps)).rejects.toBeInstanceOf(
			FirstAdminAlreadyExistsError,
		);
		expect(create).not.toHaveBeenCalled();
	});

	it('refuses when an account already holds the admin role', async () => {
		const { app, deps, existing } = build();
		existing.value = { _id: 'u' };
		await expect(bootstrapFirstAdmin(app, { email: 'a@b.co' }, deps)).rejects.toThrow(
			'an account already holds the admin role',
		);
	});

	it('refuses a generated password that fails the policy, without echoing it', async () => {
		const { app, deps, create } = build();
		policy.refusal = 'too_short';
		await expect(bootstrapFirstAdmin(app, { email: 'a@b.co' }, deps)).rejects.toThrow('(too_short)');
		expect(create).not.toHaveBeenCalled();
	});
});
