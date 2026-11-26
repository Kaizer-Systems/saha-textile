import { PERMISSION_CODES, type Role } from '@saha-textile/contracts';

import { RoleModel } from '../models/index';

/**
 * The roles whose content is not a judgement call.
 *
 * ## Why so few
 *
 * Composing an operator's role — which codes a cashier or a store manager should hold — is a
 * business decision, and seeding a guess would make it look ratified. `administrator` holds
 * every code by definition and stays correct as the registry grows. `staff` (brief 26 AT-D1,
 * approved by the owner 2026-11-26) holds only marking one's own attendance, so a shop-floor
 * login opens My attendance and nothing else; any other access comes from a second role.
 *
 * ## Why it is `isSystem`
 *
 * The role-management surface (5c.3) refuses to edit or delete system roles. Without that,
 * the UI that administers authority could remove the only authority able to administer it —
 * and with no first-administrator bootstrap yet (6a), there would be no way back in.
 */
export const ADMINISTRATOR_ROLE_KEY = 'administrator';

/** Not `staff`: a role a business made itself may already carry that key, which is unique. */
export const STAFF_ROLE_KEY = 'staff_attendance';

export const SYSTEM_ROLE_IDS = { administrator: 'role_system_administrator', staff: 'role_system_staff' } as const;

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

function staffRole(now: string): Role {
	return {
		id: SYSTEM_ROLE_IDS.staff,
		key: STAFF_ROLE_KEY,
		label: 'Staff',
		description: 'Marks their own attendance and asks for leave (My attendance). Seeded, and not editable.',
		baseRole: 'staff',
		permissions: ['attendance.use'],
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

	for (const role of [administratorRole(now), staffRole(now)]) {
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
