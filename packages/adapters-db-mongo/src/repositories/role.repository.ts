import type { PermissionCode, Role, AdminUserRoleAssignment } from '@saha-textile/contracts';
import type { RoleRepository, AdminUserRoleAssignmentRepository } from '@saha-textile/core-domain';
import { AssignmentAlreadyActiveError } from '@saha-textile/core-domain';

import {
	RoleModel,
	AdminUserRoleAssignmentModel,
	type RoleDoc,
	type AdminUserRoleAssignmentDoc,
} from '../models/index';

/** MongoDB's duplicate-key error. The only collision the unique partial index can raise. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && (error as { code?: unknown }).code === DUPLICATE_KEY;

const toRole = (doc: RoleDoc): Role => ({
	id: doc._id,
	key: doc.key,
	label: doc.label,
	description: doc.description ?? null,
	baseRole: doc.baseRole,
	permissions: doc.permissions as PermissionCode[],
	isSystem: doc.isSystem,
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt).toISOString(),
});

const toAssignment = (doc: AdminUserRoleAssignmentDoc): AdminUserRoleAssignment => ({
	id: doc._id,
	userId: doc.userId,
	roleId: doc.roleId,
	assignedByUserId: doc.assignedByUserId ?? null,
	assignedAt: new Date(doc.assignedAt).toISOString(),
	revokedAt: doc.revokedAt ? new Date(doc.revokedAt).toISOString() : null,
	revokedByUserId: doc.revokedByUserId ?? null,
	revokeReason: doc.revokeReason ?? null,
});

export class MongoRoleRepository implements RoleRepository {
	async findById(roleId: string): Promise<Role | null> {
		const doc = await RoleModel.findById(roleId).lean<RoleDoc>().exec();
		return doc ? toRole(doc) : null;
	}

	async findByKey(key: string): Promise<Role | null> {
		const doc = await RoleModel.findOne({ key }).lean<RoleDoc>().exec();
		return doc ? toRole(doc) : null;
	}

	async listAll(): Promise<Role[]> {
		const docs = await RoleModel.find().sort({ key: 1 }).lean<RoleDoc[]>().exec();
		return docs.map(toRole);
	}

	async create(role: Role): Promise<Role> {
		const { id, createdAt, updatedAt, ...rest } = role;
		await RoleModel.create([{ _id: id, ...rest, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) }]);
		return role;
	}

	/**
	 * Only the mutable half is accepted, and the filter refuses system roles in the QUERY
	 * rather than after a read. A read-then-check would let a concurrent write flip `isSystem`
	 * between the two, and it is one more round trip for the same answer.
	 */
	async update(
		roleId: string,
		changes: Partial<Pick<Role, 'label' | 'description' | 'permissions'>>,
	): Promise<Role | null> {
		const doc = await RoleModel.findOneAndUpdate({ _id: roleId, isSystem: false }, { $set: changes }, { new: true })
			.lean<RoleDoc>()
			.exec();
		return doc ? toRole(doc) : null;
	}

	/** Refuses system roles the same way: they simply do not match the delete filter. */
	async deleteById(roleId: string): Promise<boolean> {
		const result = await RoleModel.deleteOne({ _id: roleId, isSystem: false }).exec();
		return result.deletedCount === 1;
	}
}

export class MongoAdminUserRoleAssignmentRepository implements AdminUserRoleAssignmentRepository {
	async listActiveForUser(userId: string): Promise<AdminUserRoleAssignment[]> {
		const docs = await AdminUserRoleAssignmentModel.find({ userId, revokedAt: null })
			.sort({ assignedAt: 1 })
			.lean<AdminUserRoleAssignmentDoc[]>()
			.exec();
		return docs.map(toAssignment);
	}

	async listAllForUser(userId: string): Promise<AdminUserRoleAssignment[]> {
		const docs = await AdminUserRoleAssignmentModel.find({ userId })
			.sort({ assignedAt: 1 })
			.lean<AdminUserRoleAssignmentDoc[]>()
			.exec();
		return docs.map(toAssignment);
	}

	async listActiveForRole(roleId: string): Promise<AdminUserRoleAssignment[]> {
		const docs = await AdminUserRoleAssignmentModel.find({ roleId, revokedAt: null })
			.sort({ assignedAt: 1 })
			.lean<AdminUserRoleAssignmentDoc[]>()
			.exec();
		return docs.map(toAssignment);
	}

	async findActive(userId: string, roleId: string): Promise<AdminUserRoleAssignment | null> {
		const doc = await AdminUserRoleAssignmentModel.findOne({ userId, roleId, revokedAt: null })
			.lean<AdminUserRoleAssignmentDoc>()
			.exec();
		return doc ? toAssignment(doc) : null;
	}

	/**
	 * The duplicate is caught from the INDEX, not from a preceding read.
	 *
	 * Two concurrent grants would both observe "no active assignment" and both insert; only
	 * the unique partial index can arbitrate that, and it does so by failing the second write.
	 * The driver's code 11000 is translated into a named domain error here so no layer above
	 * the adapter has to know what a MongoDB error code is.
	 */
	async assign(assignment: AdminUserRoleAssignment): Promise<AdminUserRoleAssignment> {
		const { id, assignedAt, revokedAt, ...rest } = assignment;
		try {
			await AdminUserRoleAssignmentModel.create([
				{
					_id: id,
					...rest,
					assignedAt: new Date(assignedAt),
					revokedAt: revokedAt ? new Date(revokedAt) : null,
				},
			]);
			return assignment;
		} catch (error) {
			if (isDuplicateKey(error)) throw new AssignmentAlreadyActiveError(assignment.userId, assignment.roleId);
			throw error;
		}
	}

	/**
	 * Revocation is a state change on the LIVE row, never a delete: the record is what makes
	 * "who held this authority, and when" answerable afterwards. `revokedAt: null` in the
	 * filter also makes the operation idempotent — revoking twice returns null the second
	 * time rather than rewriting the revocation timestamp and losing when it truly happened.
	 */
	async revoke(input: {
		userId: string;
		roleId: string;
		revokedByUserId: string | null;
		reason: string | null;
		revokedAt: string;
	}): Promise<AdminUserRoleAssignment | null> {
		const doc = await AdminUserRoleAssignmentModel.findOneAndUpdate(
			{ userId: input.userId, roleId: input.roleId, revokedAt: null },
			{
				$set: {
					revokedAt: new Date(input.revokedAt),
					revokedByUserId: input.revokedByUserId,
					revokeReason: input.reason,
				},
			},
			{ new: true },
		)
			.lean<AdminUserRoleAssignmentDoc>()
			.exec();
		return doc ? toAssignment(doc) : null;
	}
}
