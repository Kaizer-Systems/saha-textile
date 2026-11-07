import type { AuthIdentity, AuthIdentityRepository, IdentitySubjectType } from '@saha-textile/core-domain';

import { AuthIdentityModel, type AuthIdentityDoc } from '../models/credential.model';
import { sessionFrom } from '../transaction-manager';

/** Mongo-backed `authIdentities`. Documents never escape; ISO strings cross the port. */
export class MongoAuthIdentityRepository implements AuthIdentityRepository {
	async findByProviderSubject(provider: string, providerSubject: string): Promise<AuthIdentity | null> {
		const doc = await AuthIdentityModel.findOne({ provider, providerSubject }).lean<AuthIdentityDoc>().exec();
		return doc ? toDomain(doc) : null;
	}

	async listForSubject(subjectType: IdentitySubjectType, subjectId: string): Promise<AuthIdentity[]> {
		const docs = await AuthIdentityModel.find({ subjectType, subjectId }).lean<AuthIdentityDoc[]>().exec();
		return docs.map(toDomain);
	}

	async link(identity: AuthIdentity): Promise<AuthIdentity> {
		// `create` with an array + options is how mongoose accepts a session here. Joins the
		// signup transaction so a provider link cannot outlive a rolled-back account.
		const [created] = await AuthIdentityModel.create(
			[
				{
					_id: identity.id,
					subjectType: identity.subjectType,
					subjectId: identity.subjectId,
					provider: identity.provider,
					providerSubject: identity.providerSubject,
					email: identity.email,
					linkedAt: new Date(identity.linkedAt),
					lastUsedAt: identity.lastUsedAt ? new Date(identity.lastUsedAt) : null,
				},
			],
			{ session: sessionFrom() },
		);
		return toDomain(created!.toObject() as AuthIdentityDoc);
	}

	async unlink(subjectType: IdentitySubjectType, subjectId: string, provider: string): Promise<boolean> {
		const result = await AuthIdentityModel.deleteOne({ subjectType, subjectId, provider }).exec();
		return (result.deletedCount ?? 0) > 0;
	}

	async releaseForSubject(
		subjectType: IdentitySubjectType,
		subjectId: string,
		providers: string[],
	): Promise<AuthIdentity[]> {
		if (providers.length === 0) return [];
		const session = sessionFrom();
		const filter = { subjectType, subjectId, provider: { $in: providers } };
		const docs = await AuthIdentityModel.find(filter)
			.session(session ?? null)
			.lean<AuthIdentityDoc[]>()
			.exec();
		if (docs.length === 0) return [];
		// By id, not by the filter again: only the rows that were read are reported as removed.
		await AuthIdentityModel.deleteMany({ _id: { $in: docs.map((doc) => doc._id) } }, { session }).exec();
		return docs.map(toDomain);
	}

	async touch(id: string, usedAt: string): Promise<void> {
		await AuthIdentityModel.updateOne({ _id: id }, { $set: { lastUsedAt: new Date(usedAt) } }).exec();
	}
}

function toDomain(doc: AuthIdentityDoc): AuthIdentity {
	return {
		id: doc._id,
		subjectType: doc.subjectType,
		subjectId: doc.subjectId,
		provider: doc.provider,
		providerSubject: doc.providerSubject,
		email: doc.email,
		linkedAt: doc.linkedAt.toISOString(),
		lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
	};
}
