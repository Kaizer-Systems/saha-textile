import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/** Reusable role definition (`roles`). */
export interface RoleDoc {
	_id: string;
	key: string;
	label: string;
	description: string | null;
	baseRole: 'staff' | 'admin';
	permissions: string[];
	isSystem: boolean;
	createdAt: Date;
	updatedAt: Date;
}

const RoleSchema = new Schema<RoleDoc>(
	{
		_id: { type: String, required: true },
		key: { type: String, required: true },
		label: { type: String, required: true },
		description: { type: String, default: null },
		baseRole: { type: String, enum: ['staff', 'admin'], required: true },
		/**
		 * Stored as plain strings, validated against the canonical registry at the contract
		 * boundary. Deliberately not a Mongoose enum: a role written before a code was retired
		 * must still READ, and a schema-level enum would make that document unloadable.
		 */
		permissions: { type: [String], default: [] },
		isSystem: { type: Boolean, default: false },
	},
	{ collection: COLLECTION_NAMES.Role, timestamps: true },
);

/** The machine key is the stable identifier operators and seeds refer to. */
RoleSchema.index({ key: 1 }, { unique: true });
/** Listing the roles that may be assigned within a coarse tier. */
RoleSchema.index({ baseRole: 1 });

export const RoleModel: Model<RoleDoc> = (models.Role as Model<RoleDoc>) ?? model<RoleDoc>('Role', RoleSchema);

/** Explicit user-to-role assignment (`adminUserRoleAssignments`). */
export interface AdminUserRoleAssignmentDoc {
	_id: string;
	userId: string;
	roleId: string;
	assignedByUserId: string | null;
	assignedAt: Date;
	revokedAt: Date | null;
	revokedByUserId: string | null;
	revokeReason: string | null;
}

const AdminUserRoleAssignmentSchema = new Schema<AdminUserRoleAssignmentDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, required: true },
		roleId: { type: String, required: true },
		assignedByUserId: { type: String, default: null },
		assignedAt: { type: Date, required: true },
		revokedAt: { type: Date, default: null },
		revokedByUserId: { type: String, default: null },
		revokeReason: { type: String, default: null },
	},
	{ collection: COLLECTION_NAMES.AdminUserRoleAssignment, timestamps: false },
);

/**
 * The unique ACTIVE assignment constraint.
 *
 * A user may hold a role once at a time, and may hold it again after it is revoked. A plain
 * unique index on `(userId, roleId)` would enforce the first half and permanently break the
 * second: once revoked, the row still exists, so re-granting would collide with a record that
 * no longer confers anything. The partial filter restricts uniqueness to LIVE rows, which is
 * the constraint the auth architecture actually states.
 *
 * It is enforced here rather than in application code on purpose. A read-then-write check
 * loses to a concurrent request — two grants racing both read "no active assignment" and both
 * insert. Only the database can decide that, and it does so by rejecting the second write
 * with a duplicate-key error.
 */
AdminUserRoleAssignmentSchema.index(
	{ userId: 1, roleId: 1 },
	{ unique: true, partialFilterExpression: { revokedAt: null } },
);
/** Resolving a principal's authority: every live assignment for one user. */
AdminUserRoleAssignmentSchema.index({ userId: 1, revokedAt: 1 });
/** Answering "who holds this role", and the last-admin check that 5c will need. */
AdminUserRoleAssignmentSchema.index({ roleId: 1, revokedAt: 1 });

export const AdminUserRoleAssignmentModel: Model<AdminUserRoleAssignmentDoc> =
	(models.AdminUserRoleAssignment as Model<AdminUserRoleAssignmentDoc>) ??
	model<AdminUserRoleAssignmentDoc>('AdminUserRoleAssignment', AdminUserRoleAssignmentSchema);
