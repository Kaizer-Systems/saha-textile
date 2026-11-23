import { CompanyProfile, FeatureSwitches, GstRegistration } from '@saha-textile/contracts';
import { type CompanyRepository, StaleVersionError } from '@saha-textile/core-domain';

import { CompanyProfileModel, FeatureSwitchesModel, GstRegistrationModel } from '../models/company.model';
import type { AggregateDoc } from '../models/purchasing.model';

const strip = (doc: AggregateDoc): Record<string, unknown> => {
	const { _id, ...rest } = doc;
	void _id;
	return rest;
};

/**
 * Writes only over the copy the editor read (the Shop details pattern). A first save (expected
 * null) inserts; a second first-save hits the existing `_id` and is refused the same way.
 */
async function guardedSave(
	model: typeof CompanyProfileModel,
	id: string,
	entity: string,
	doc: Record<string, unknown>,
	expectedUpdatedAt: string | null,
	current: () => Promise<{ updatedAt: string | null; updatedBy?: string | null } | null>,
): Promise<void> {
	try {
		const result = await model
			.updateOne({ _id: id, updatedAt: expectedUpdatedAt }, { $set: doc }, { upsert: expectedUpdatedAt === null })
			.exec();
		if (result.matchedCount === 1 || result.upsertedCount === 1) return;
	} catch (error) {
		if ((error as { code?: number }).code !== 11000) throw error;
	}
	const now = await current();
	throw new StaleVersionError(entity, id, {
		version: 0,
		updatedAt: now?.updatedAt ?? '',
		updatedBy: now?.updatedBy ?? null,
	});
}

export class MongoCompanyRepository implements CompanyRepository {
	async getProfile(): Promise<CompanyProfile | null> {
		const doc = await CompanyProfileModel.findById('company').lean<AggregateDoc>().exec();
		return doc ? CompanyProfile.parse(strip(doc)) : null;
	}

	saveProfile(profile: CompanyProfile, expectedUpdatedAt: string | null): Promise<void> {
		return guardedSave(CompanyProfileModel, 'company', 'company_profile', profile, expectedUpdatedAt, () =>
			this.getProfile(),
		);
	}

	async listRegistrations(): Promise<GstRegistration[]> {
		const docs = await GstRegistrationModel.find({}).sort({ stateCode: 1, gstin: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map((doc) => GstRegistration.parse({ ...strip(doc), id: doc._id }));
	}

	async getRegistration(id: string): Promise<GstRegistration | null> {
		const doc = await GstRegistrationModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? GstRegistration.parse({ ...strip(doc), id: doc._id }) : null;
	}

	async findRegistrationByGstin(gstin: string): Promise<GstRegistration | null> {
		const doc = await GstRegistrationModel.findOne({ gstin }).lean<AggregateDoc>().exec();
		return doc ? GstRegistration.parse({ ...strip(doc), id: doc._id }) : null;
	}

	saveRegistration(registration: GstRegistration, expectedUpdatedAt: string | null): Promise<void> {
		const { id, ...rest } = registration;
		return guardedSave(GstRegistrationModel, id, 'gst_registration', rest, expectedUpdatedAt, () =>
			this.getRegistration(id),
		);
	}

	async getFeatures(): Promise<FeatureSwitches | null> {
		const doc = await FeatureSwitchesModel.findById('features').lean<AggregateDoc>().exec();
		return doc ? FeatureSwitches.parse(strip(doc)) : null;
	}

	saveFeatures(features: FeatureSwitches, expectedUpdatedAt: string | null): Promise<void> {
		return guardedSave(FeatureSwitchesModel, 'features', 'feature_switches', features, expectedUpdatedAt, () =>
			this.getFeatures(),
		);
	}
}
