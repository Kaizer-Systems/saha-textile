import type { Connection } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Remap retired operator permission codes to their `admin_user*` names in stored grants.
 *
 * Targets role documents, admin-user embedded grants, and outstanding invite payloads.
 * Idempotent: a second run finds nothing to rewrite.
 *
 * The `user_role.*` pair joined this map on 2026-08-15, when the assignment family was
 * renamed. Same defect as the `user.*` codes above it and therefore the same remedy: the
 * join is operator-only, so a bare `user` prefix claimed a population it never addressed.
 * Codes retired without a successor — the marketplace vocabulary and the ambiguous
 * `user.edit` / `user.destroy` — are deliberately absent: they map to nothing, and a grant
 * holding one is dropped by the registry's own validation rather than translated here.
 */
export const LEGACY_ADMIN_USER_PERMISSION_MAP = {
	'user.create': 'admin_user.create',
	'user.index': 'admin_user.index',
	'user.update': 'admin_user.update',
	'user_role.assign': 'admin_user_role.assign',
	'user_role.revoke': 'admin_user_role.revoke',
} as const;

export type RenameAdminUserPermissionsReport = {
	rolesUpdated: number;
	adminUsersUpdated: number;
	invitesUpdated: number;
	codesRewritten: number;
};

function remapCodes(codes: unknown): { next: string[]; rewritten: number } {
	if (!Array.isArray(codes)) return { next: [], rewritten: 0 };
	let rewritten = 0;
	const next = [
		...new Set(
			codes.map((code) => {
				if (typeof code !== 'string') return code;
				const mapped = LEGACY_ADMIN_USER_PERMISSION_MAP[code as keyof typeof LEGACY_ADMIN_USER_PERMISSION_MAP];
				if (mapped) {
					rewritten += 1;
					return mapped;
				}
				return code;
			}),
		),
	].filter((code): code is string => typeof code === 'string');
	next.sort((a, b) => a.localeCompare(b));
	return { next, rewritten };
}

export async function renameAdminUserPermissions(
	connection: Connection,
	options: { dryRun?: boolean } = {},
): Promise<RenameAdminUserPermissionsReport> {
	const dryRun = options.dryRun === true;
	const report: RenameAdminUserPermissionsReport = {
		rolesUpdated: 0,
		adminUsersUpdated: 0,
		invitesUpdated: 0,
		codesRewritten: 0,
	};

	const roles = connection.collection(COLLECTION_NAMES.Role);
	const adminUsers = connection.collection(COLLECTION_NAMES.AdminUser);
	const invites = connection.collection(COLLECTION_NAMES.AdminInvite);

	for (const doc of await roles
		.find({ permissions: { $in: Object.keys(LEGACY_ADMIN_USER_PERMISSION_MAP) } })
		.toArray()) {
		const { next, rewritten } = remapCodes(doc.permissions);
		report.codesRewritten += rewritten;
		report.rolesUpdated += 1;
		if (!dryRun) {
			await roles.updateOne({ _id: doc._id }, { $set: { permissions: next, updatedAt: new Date() } });
		}
	}

	for (const doc of await adminUsers
		.find({ permissions: { $in: Object.keys(LEGACY_ADMIN_USER_PERMISSION_MAP) } })
		.toArray()) {
		const { next, rewritten } = remapCodes(doc.permissions);
		report.codesRewritten += rewritten;
		report.adminUsersUpdated += 1;
		if (!dryRun) {
			await adminUsers.updateOne({ _id: doc._id }, { $set: { permissions: next, updatedAt: new Date() } });
		}
	}

	for (const doc of await invites
		.find({ permissions: { $in: Object.keys(LEGACY_ADMIN_USER_PERMISSION_MAP) } })
		.toArray()) {
		const { next, rewritten } = remapCodes(doc.permissions);
		report.codesRewritten += rewritten;
		report.invitesUpdated += 1;
		if (!dryRun) {
			await invites.updateOne({ _id: doc._id }, { $set: { permissions: next } });
		}
	}

	return report;
}
