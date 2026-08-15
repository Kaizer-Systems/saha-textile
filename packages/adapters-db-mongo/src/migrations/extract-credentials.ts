import { randomUUID } from 'node:crypto';

import type { Connection } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import { passwordCredentialId, pinCredentialId } from '../models/credential.model';

export type ExtractCredentialsReport = {
	passwordCredentialsUpserted: number;
	pinCredentialsUpserted: number;
	authIdentitiesUpserted: number;
	customersUnset: number;
	adminUsersUnset: number;
};

type LeanDoc = Record<string, unknown> & { _id: string };

/** Untyped string-id collection surface (same pattern as split-admin-users). */
interface StringIdCollection {
	find(filter: Record<string, unknown>): { toArray(): Promise<LeanDoc[]> };
	updateOne(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: { upsert?: boolean },
	): Promise<unknown>;
}

/**
 * Copy embedded password/PIN/identity material into credential collections, then `$unset`
 * the embeds on account docs. Idempotent.
 */
export async function extractCredentials(
	connection: Connection,
	options: { dryRun?: boolean } = {},
): Promise<ExtractCredentialsReport> {
	const dryRun = options.dryRun === true;
	const report: ExtractCredentialsReport = {
		passwordCredentialsUpserted: 0,
		pinCredentialsUpserted: 0,
		authIdentitiesUpserted: 0,
		customersUnset: 0,
		adminUsersUnset: 0,
	};

	const customers = connection.collection(COLLECTION_NAMES.Customer) as unknown as StringIdCollection;
	const adminUsers = connection.collection(COLLECTION_NAMES.AdminUser) as unknown as StringIdCollection;
	const passwords = connection.collection(COLLECTION_NAMES.PasswordCredential) as unknown as StringIdCollection;
	const pins = connection.collection(COLLECTION_NAMES.PinCredential) as unknown as StringIdCollection;
	const identities = connection.collection(COLLECTION_NAMES.AuthIdentity) as unknown as StringIdCollection;

	for (const doc of await customers
		.find({
			$or: [{ passwordHash: { $type: 'string' } }, { identities: { $exists: true, $ne: [] } }],
		})
		.toArray()) {
		const subjectId = String(doc._id);
		if (typeof doc.passwordHash === 'string' && doc.passwordHash.length > 0) {
			report.passwordCredentialsUpserted += 1;
			if (!dryRun) {
				const id = passwordCredentialId('customer', subjectId);
				await passwords.updateOne(
					{ _id: id },
					{
						$set: {
							subjectType: 'customer',
							subjectId,
							passwordHash: doc.passwordHash,
							updatedAt: new Date(),
						},
						$setOnInsert: { _id: id, createdAt: new Date() },
					},
					{ upsert: true },
				);
			}
		}

		if (Array.isArray(doc.identities) && doc.identities.length > 0) {
			for (const [index, raw] of doc.identities.entries()) {
				const identity = raw as { provider?: string; providerId?: string; email?: string };
				const provider = identity.provider ?? 'password';
				const providerSubject = identity.providerId ?? identity.email ?? `${subjectId}:${index}`;
				report.authIdentitiesUpserted += 1;
				if (!dryRun) {
					await identities.updateOne(
						{ provider, providerSubject },
						{
							$set: {
								subjectType: 'customer',
								subjectId,
								provider,
								providerSubject,
								email: identity.email ?? null,
								lastUsedAt: null,
								updatedAt: new Date(),
							},
							$setOnInsert: {
								_id: `aid_${randomUUID()}`,
								linkedAt: new Date(),
								createdAt: new Date(),
							},
						},
						{ upsert: true },
					);
				}
			}
		}

		report.customersUnset += 1;
		if (!dryRun) {
			await customers.updateOne({ _id: doc._id }, { $unset: { passwordHash: '', identities: '' } });
		}
	}

	for (const doc of await adminUsers
		.find({
			$or: [
				{ passwordHash: { $type: 'string' } },
				{ pinHash: { $type: 'string' } },
				{ failedPinAttempts: { $gt: 0 } },
				{ pinLockedUntil: { $ne: null } },
				{ pinRevalidationRequiredAt: { $ne: null } },
			],
		})
		.toArray()) {
		const subjectId = String(doc._id);
		if (typeof doc.passwordHash === 'string' && doc.passwordHash.length > 0) {
			report.passwordCredentialsUpserted += 1;
			if (!dryRun) {
				const id = passwordCredentialId('admin_user', subjectId);
				await passwords.updateOne(
					{ _id: id },
					{
						$set: {
							subjectType: 'admin_user',
							subjectId,
							passwordHash: doc.passwordHash,
							updatedAt: new Date(),
						},
						$setOnInsert: { _id: id, createdAt: new Date() },
					},
					{ upsert: true },
				);
			}
		}

		if (typeof doc.pinHash === 'string' && doc.pinHash.length > 0) {
			report.pinCredentialsUpserted += 1;
			if (!dryRun) {
				const id = pinCredentialId(subjectId);
				await pins.updateOne(
					{ _id: id },
					{
						$set: {
							adminUserId: subjectId,
							pinHash: doc.pinHash,
							failedPinAttempts: typeof doc.failedPinAttempts === 'number' ? doc.failedPinAttempts : 0,
							pinLockedUntil: doc.pinLockedUntil ?? null,
							pinRevalidationRequiredAt: doc.pinRevalidationRequiredAt ?? null,
							updatedAt: new Date(),
						},
						$setOnInsert: { _id: id, createdAt: new Date() },
					},
					{ upsert: true },
				);
			}
		}

		report.adminUsersUnset += 1;
		if (!dryRun) {
			await adminUsers.updateOne(
				{ _id: doc._id },
				{
					$unset: {
						passwordHash: '',
						pinHash: '',
						failedPinAttempts: '',
						pinLockedUntil: '',
						pinRevalidationRequiredAt: '',
					},
				},
			);
		}
	}

	return report;
}
