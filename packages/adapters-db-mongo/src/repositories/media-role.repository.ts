import type { MediaRoleDefinition } from '@saha-textile/contracts';
import type { MediaRoleRepository } from '@saha-textile/core-domain';

import { MediaRoleModel, type MediaRoleDoc } from '../models/index';

const toRole = (doc: MediaRoleDoc): MediaRoleDefinition =>
	({
		key: doc._id,
		label: doc.label,
		seeded: doc.seeded,
		purposes: doc.purposes,
		widths: doc.widths,
		aspect: doc.aspect ?? null,
		fit: doc.fit,
		format: doc.format,
		quality: doc.quality,
		primaryOnly: doc.primaryOnly,
		respectSlotMaxWidth: doc.respectSlotMaxWidth,
		version: doc.version,
		updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
	}) as MediaRoleDefinition;

const toDoc = (role: MediaRoleDefinition) => {
	const { key: _key, updatedAt: _updatedAt, ...rest } = role;
	return rest;
};

export class MongoMediaRoleRepository implements MediaRoleRepository {
	async list(): Promise<MediaRoleDefinition[]> {
		const docs = await MediaRoleModel.find().sort({ _id: 1 }).lean<MediaRoleDoc[]>().exec();
		return docs.map(toRole);
	}

	async findByKey(key: string): Promise<MediaRoleDefinition | null> {
		const doc = await MediaRoleModel.findById(key).lean<MediaRoleDoc>().exec();
		return doc ? toRole(doc) : null;
	}

	async save(role: MediaRoleDefinition): Promise<MediaRoleDefinition> {
		await MediaRoleModel.updateOne({ _id: role.key }, { $set: toDoc(role) }, { upsert: true }).exec();
		return role;
	}

	/** `$setOnInsert` only: an operator's edited widths survive every boot. */
	async insertMissing(roles: readonly MediaRoleDefinition[]): Promise<number> {
		if (roles.length === 0) return 0;
		const result = await MediaRoleModel.bulkWrite(
			roles.map((role) => ({
				updateOne: { filter: { _id: role.key }, update: { $setOnInsert: toDoc(role) }, upsert: true },
			})),
		);
		return result.upsertedCount;
	}
}
