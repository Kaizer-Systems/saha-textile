import type { AdminUser, PageQuery, Paginated } from '@saha-textile/contracts';
import type { AdminUserRepository } from '@saha-textile/core-domain';

import { toAdminUser } from '../mappers';
import { type AdminUserDoc, AdminUserModel, PinCredentialModel } from '../models/index';

async function pinConfiguredFor(ids: string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const rows = await PinCredentialModel.find({ adminUserId: { $in: ids } })
		.select({ adminUserId: 1 })
		.lean<{ adminUserId: string }[]>()
		.exec();
	return new Set(rows.map((row) => row.adminUserId));
}

async function mapAdmin(doc: AdminUserDoc): Promise<AdminUser> {
	const configured = await pinConfiguredFor([doc._id]);
	return toAdminUser(doc, configured.has(doc._id));
}

export class MongoAdminUserRepository implements AdminUserRepository {
	async findById(id: string): Promise<AdminUser | null> {
		const doc = await AdminUserModel.findById(id).lean<AdminUserDoc>().exec();
		return doc ? mapAdmin(doc) : null;
	}

	async findByEmail(email: string): Promise<AdminUser | null> {
		const doc = await AdminUserModel.findOne({ email }).lean<AdminUserDoc>().exec();
		return doc ? mapAdmin(doc) : null;
	}

	async findByUsername(username: string): Promise<AdminUser | null> {
		const doc = await AdminUserModel.findOne({ username }).lean<AdminUserDoc>().exec();
		return doc ? mapAdmin(doc) : null;
	}

	async list(query: PageQuery): Promise<Paginated<AdminUser>> {
		const page = query.page;
		const pageSize = query.pageSize;
		const filter = {};
		const [total, docs] = await Promise.all([
			AdminUserModel.countDocuments(filter).exec(),
			AdminUserModel.find(filter)
				.sort({ createdAt: -1 })
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<AdminUserDoc[]>()
				.exec(),
		]);
		const configured = await pinConfiguredFor(docs.map((doc) => doc._id));
		const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
		return {
			items: docs.map((doc) => toAdminUser(doc, configured.has(doc._id))),
			meta: {
				page,
				pageSize,
				total,
				totalPages,
				hasNext: page < totalPages,
				hasPrev: page > 1,
			},
		};
	}

	async save(adminUser: AdminUser): Promise<AdminUser> {
		const { id, pinConfigured: _pinConfigured, ...rest } = adminUser;
		const doc = await AdminUserModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<AdminUserDoc>()
			.exec();
		return mapAdmin(doc as AdminUserDoc);
	}
}
