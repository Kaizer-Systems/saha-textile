import { ShippingException, ShippingRuleSet, ShippingRuleSetVersion, ShippingSettings } from '@saha-textile/contracts';
import type { ShippingRuleRepository } from '@saha-textile/core-domain';

import {
	ProductModel,
	ShippingExceptionModel,
	ShippingProviderConfigModel,
	ShippingRuleSetModel,
	ShippingRuleSetVersionModel,
	type ShippingExceptionDoc,
	type ShippingRuleSetDoc,
	type ShippingRuleSetVersionDoc,
} from '../models/index';

const SETTINGS_ID = 'zones';
const versionId = (ruleSetId: string, version: number): string => `${ruleSetId}:${version}`;
const iso = (value: Date | string | undefined): string | undefined =>
	value ? new Date(value).toISOString() : undefined;

/** Stored rows go back through the contracts, so a body that no longer fits fails here, not at checkout. */
const toRuleSet = (doc: ShippingRuleSetDoc): ShippingRuleSet =>
	ShippingRuleSet.parse({
		id: doc._id,
		name: doc.name,
		description: doc.description ?? '',
		use: doc.use,
		kind: doc.kind,
		premadeKey: doc.premadeKey ?? null,
		copiedFromId: doc.copiedFromId ?? null,
		activeVersion: doc.activeVersion ?? null,
		draft: doc.draft,
		hasDraftChanges: doc.hasDraftChanges ?? true,
		testCarts: doc.testCarts ?? [],
		revision: doc.revision ?? 0,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
		updatedBy: doc.updatedBy ?? null,
	});

const ruleSetFields = (ruleSet: ShippingRuleSet) => ({
	name: ruleSet.name,
	description: ruleSet.description,
	use: ruleSet.use,
	kind: ruleSet.kind,
	premadeKey: ruleSet.premadeKey,
	copiedFromId: ruleSet.copiedFromId,
	activeVersion: ruleSet.activeVersion,
	draft: ruleSet.draft,
	hasDraftChanges: ruleSet.hasDraftChanges,
	testCarts: ruleSet.testCarts,
	revision: ruleSet.revision,
	updatedAt: new Date(ruleSet.updatedAt ?? Date.now()),
	updatedBy: ruleSet.updatedBy,
});

const toVersion = (doc: ShippingRuleSetVersionDoc): ShippingRuleSetVersion =>
	ShippingRuleSetVersion.parse({
		ruleSetId: doc.ruleSetId,
		version: doc.version,
		body: doc.body,
		activatedAt: new Date(doc.activatedAt).toISOString(),
		activatedBy: doc.activatedBy ?? null,
		acceptedChanges: doc.acceptedChanges ?? [],
	});

const versionFields = (version: ShippingRuleSetVersion) => ({
	ruleSetId: version.ruleSetId,
	version: version.version,
	body: version.body,
	activatedAt: new Date(version.activatedAt),
	activatedBy: version.activatedBy,
	acceptedChanges: version.acceptedChanges,
});

const toException = (doc: ShippingExceptionDoc): ShippingException =>
	ShippingException.parse({
		id: doc._id,
		target: doc.target,
		domestic: doc.domestic,
		international: doc.international,
		note: doc.note ?? '',
		updatedAt: iso(doc.updatedAt),
		updatedBy: doc.updatedBy ?? null,
	});

/** Rule sets, versions, exceptions and zone settings (see `ShippingRuleRepository`). */
export class MongoShippingRuleRepository implements ShippingRuleRepository {
	async listRuleSets(): Promise<ShippingRuleSet[]> {
		const docs = await ShippingRuleSetModel.find({})
			.sort({ kind: -1, name: 1 })
			.lean<ShippingRuleSetDoc[]>()
			.exec();
		return docs.map(toRuleSet);
	}

	async findRuleSet(id: string): Promise<ShippingRuleSet | null> {
		const doc = await ShippingRuleSetModel.findById(id).lean<ShippingRuleSetDoc>().exec();
		return doc ? toRuleSet(doc) : null;
	}

	async createRuleSet(ruleSet: ShippingRuleSet): Promise<boolean> {
		const result = await ShippingRuleSetModel.updateOne(
			{ _id: ruleSet.id },
			{ $setOnInsert: { ...ruleSetFields(ruleSet), createdAt: new Date(ruleSet.createdAt ?? Date.now()) } },
			{ upsert: true },
		).exec();
		return result.upsertedCount > 0;
	}

	async saveRuleSet(ruleSet: ShippingRuleSet, expectedRevision: number): Promise<boolean> {
		const result = await ShippingRuleSetModel.updateOne(
			{ _id: ruleSet.id, revision: expectedRevision },
			{ $set: ruleSetFields(ruleSet) },
		).exec();
		return result.matchedCount > 0;
	}

	async deleteRuleSet(id: string, expectedRevision: number): Promise<boolean> {
		const result = await ShippingRuleSetModel.deleteOne({ _id: id, revision: expectedRevision }).exec();
		return result.deletedCount > 0;
	}

	async activate(
		ruleSet: ShippingRuleSet,
		version: ShippingRuleSetVersion,
		expectedRevision: number,
	): Promise<boolean> {
		const session = await ShippingRuleSetModel.db.startSession();
		try {
			let saved = false;
			await session.withTransaction(async () => {
				const result = await ShippingRuleSetModel.updateOne(
					{ _id: ruleSet.id, revision: expectedRevision },
					{ $set: ruleSetFields(ruleSet) },
					{ session },
				).exec();
				saved = result.matchedCount > 0;
				if (!saved) return;
				await ShippingRuleSetVersionModel.create(
					[{ _id: versionId(version.ruleSetId, version.version), ...versionFields(version) }],
					{ session },
				);
			});
			return saved;
		} finally {
			await session.endSession();
		}
	}

	async findVersion(ruleSetId: string, version: number): Promise<ShippingRuleSetVersion | null> {
		const doc = await ShippingRuleSetVersionModel.findById(versionId(ruleSetId, version))
			.lean<ShippingRuleSetVersionDoc>()
			.exec();
		return doc ? toVersion(doc) : null;
	}

	async listVersions(ruleSetId: string): Promise<ShippingRuleSetVersion[]> {
		const docs = await ShippingRuleSetVersionModel.find({ ruleSetId })
			.sort({ version: -1 })
			.lean<ShippingRuleSetVersionDoc[]>()
			.exec();
		return docs.map(toVersion);
	}

	async activeVersions(ruleSetIds: readonly string[]): Promise<ShippingRuleSetVersion[]> {
		if (ruleSetIds.length === 0) return [];
		const sets = await ShippingRuleSetModel.find(
			{ _id: { $in: [...ruleSetIds] }, activeVersion: { $ne: null } },
			{ activeVersion: 1 },
		)
			.lean<Array<Pick<ShippingRuleSetDoc, '_id' | 'activeVersion'>>>()
			.exec();
		const ids = sets.flatMap((s) => (s.activeVersion === null ? [] : [versionId(s._id, s.activeVersion)]));
		if (ids.length === 0) return [];
		const docs = await ShippingRuleSetVersionModel.find({ _id: { $in: ids } })
			.lean<ShippingRuleSetVersionDoc[]>()
			.exec();
		return docs.map(toVersion);
	}

	async createPremadeIfMissing(ruleSet: ShippingRuleSet, version: ShippingRuleSetVersion): Promise<boolean> {
		const created = await this.createRuleSet(ruleSet);
		await ShippingRuleSetVersionModel.updateOne(
			{ _id: versionId(version.ruleSetId, version.version) },
			{ $setOnInsert: versionFields(version) },
			{ upsert: true },
		).exec();
		return created;
	}

	async getSettings(): Promise<ShippingSettings | null> {
		const doc = await ShippingProviderConfigModel.findById(SETTINGS_ID).lean().exec();
		if (!doc) return null;
		return ShippingSettings.parse({
			...(doc.settings as Record<string, unknown>),
			revision: doc.revision ?? 0,
			updatedAt: iso(doc.updatedAt),
			updatedBy: doc.updatedBy ?? null,
		});
	}

	async saveSettings(settings: ShippingSettings, expectedRevision: number): Promise<boolean> {
		const { revision, updatedAt, updatedBy, ...rest } = settings;
		const fields = { settings: rest, revision, updatedAt: new Date(updatedAt ?? Date.now()), updatedBy };
		if (expectedRevision === 0) {
			const created = await ShippingProviderConfigModel.updateOne(
				{ _id: SETTINGS_ID },
				{ $setOnInsert: fields },
				{ upsert: true },
			).exec();
			if (created.upsertedCount > 0) return true;
		}
		const result = await ShippingProviderConfigModel.updateOne(
			{ _id: SETTINGS_ID, revision: expectedRevision },
			{ $set: fields },
		).exec();
		return result.matchedCount > 0;
	}

	async listExceptions(): Promise<ShippingException[]> {
		const docs = await ShippingExceptionModel.find({})
			.sort({ updatedAt: -1 })
			.lean<ShippingExceptionDoc[]>()
			.exec();
		return docs.map(toException);
	}

	async saveException(exception: ShippingException): Promise<void> {
		await ShippingExceptionModel.updateOne(
			{ _id: exception.id },
			{
				$set: {
					target: exception.target,
					domestic: exception.domestic,
					international: exception.international,
					note: exception.note,
					updatedAt: new Date(exception.updatedAt ?? Date.now()),
					updatedBy: exception.updatedBy,
				},
			},
			{ upsert: true },
		).exec();
	}

	async deleteException(id: string): Promise<boolean> {
		const result = await ShippingExceptionModel.deleteOne({ _id: id }).exec();
		return result.deletedCount > 0;
	}

	async countProductsWithoutBox(categoryIdsWithBox: readonly string[]): Promise<number> {
		// `field: null` matches a missing field too; `categoryIds.0` is the main category.
		return ProductModel.countDocuments({
			status: 'live',
			'categoryIds.0': { $nin: [...categoryIdsWithBox] },
			'shippingDefaults.weightGrams': null,
			$or: [
				{ 'shippingDefaults.lengthCm': null },
				{ 'shippingDefaults.widthCm': null },
				{ 'shippingDefaults.heightCm': null },
			],
		}).exec();
	}

	async chargeUsage(mainCategoryIds: readonly string[]): Promise<{ products: number; ownCharges: number }> {
		const base = { status: { $ne: 'discontinued' as const }, 'categoryIds.0': { $in: [...mainCategoryIds] } };
		const [products, ownCharges] = await Promise.all([
			ProductModel.countDocuments(base).exec(),
			ProductModel.countDocuments({
				...base,
				$or: [
					{ 'shippingCharges.domesticINR': { $ne: null } },
					{ 'shippingCharges.internationalFirstINR': { $ne: null } },
					{ 'shippingCharges.internationalFurtherINR': { $ne: null } },
				],
			}).exec(),
		]);
		return { products, ownCharges };
	}
}
