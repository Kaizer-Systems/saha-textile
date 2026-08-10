import { PERMISSION_CODES, type Role } from '@saha-textile/contracts';

import { RoleModel } from '../models/index';

/**
 * The one role the platform cannot be administered without.
 *
 * ## Why exactly one
 *
 * Composing a `staff` role — which of the 33 codes an ordinary operator should hold — is a
 * business decision, and seeding a guess would make it look ratified. `administrator` is the
 * only role whose content is not a judgement call: it is the one that can do everything, so
 * it holds every code by definition and stays correct as the registry grows.
 *
 * ## Why it is `isSystem`
 *
 * The role-management surface (5c.3) refuses to edit or delete system roles. Without that,
 * the UI that administers authority could remove the only authority able to administer it —
 * and with no first-administrator bootstrap yet (6a), there would be no way back in.
 */
export const ADMINISTRATOR_ROLE_KEY = 'administrator';

export const SYSTEM_ROLE_IDS = { administrator: 'role_system_administrator' } as const;

function administratorRole(now: string): Role {
	return {
		id: SYSTEM_ROLE_IDS.administrator,
		key: ADMINISTRATOR_ROLE_KEY,
		label: 'Administrator',
		description: 'Full administrative authority. Seeded, and not editable through the admin surface.',
		baseRole: 'admin',
		// Every code, so the role does not silently fall behind a registry that grows.
		permissions: [...PERMISSION_CODES],
		isSystem: true,
		createdAt: now,
		updatedAt: now,
	};
}

export interface SystemRoleSeedResult {
	created: string[];
	updated: string[];
}

/**
 * Idempotently ensures the system roles exist and hold the current permission set.
 *
 * Deliberately NOT run at application bootstrap. A write on every process start is a side
 * effect nobody asked for, it races when several instances start together, and it would make
 * an accidental registry change reach production without anybody deciding to apply it. This
 * is an operator action: `pnpm --filter @saha-textile/adapters-db-mongo seed:system-roles`.
 *
 * Re-running is safe and is how a registry addition reaches the role: `permissions` and the
 * labels are refreshed, while `createdAt` is preserved so the audit record of when the role
 * first appeared is not rewritten.
 */
export async function ensureSystemRoles(now = new Date().toISOString()): Promise<SystemRoleSeedResult> {
	const result: SystemRoleSeedResult = { created: [], updated: [] };

	for (const role of [administratorRole(now)]) {
		const existing = await RoleModel.findById(role.id).lean<{ _id: string }>().exec();

		await RoleModel.updateOne(
			{ _id: role.id },
			{
				$set: {
					key: role.key,
					label: role.label,
					description: role.description,
					baseRole: role.baseRole,
					permissions: role.permissions,
					isSystem: true,
					updatedAt: new Date(now),
				},
				$setOnInsert: { createdAt: new Date(now) },
			},
			{ upsert: true },
		).exec();

		(existing ? result.updated : result.created).push(role.key);
	}

	return result;
}
