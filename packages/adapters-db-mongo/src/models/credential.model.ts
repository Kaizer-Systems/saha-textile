import { randomUUID } from 'node:crypto';

import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/** Population that owns a credential row (`DEC-ACCOUNT-SEPARATION` + auth §7.3). */
export type CredentialSubjectType = 'customer' | 'admin_user';

/**
 * Password hash row — never returned through public contracts (auth §7.3).
 *
 * Deterministic `_id` (`pcred_<subjectType>_<subjectId>`) keeps upserts idempotent.
 */
export interface PasswordCredentialDoc {
	_id: string;
	subjectType: CredentialSubjectType;
	subjectId: string;
	passwordHash: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const PasswordCredentialSchema = new Schema<PasswordCredentialDoc>(
	{
		_id: { type: String, required: true },
		subjectType: { type: String, enum: ['customer', 'admin_user'], required: true },
		subjectId: { type: String, required: true },
		passwordHash: { type: String, required: true, select: false },
	},
	{ collection: COLLECTION_NAMES.PasswordCredential, timestamps: true },
);

PasswordCredentialSchema.index({ subjectType: 1, subjectId: 1 }, { unique: true });

export const PasswordCredentialModel: Model<PasswordCredentialDoc> =
	(models.PasswordCredential as Model<PasswordCredentialDoc>) ??
	model<PasswordCredentialDoc>('PasswordCredential', PasswordCredentialSchema);

/**
 * Admin PIN hash + lockout/revalidation state (auth §7.3A).
 *
 * Preferred login method stays on `adminUsers` (non-secret preference).
 */
export interface PinCredentialDoc {
	_id: string;
	adminUserId: string;
	pinHash: string;
	failedPinAttempts: number;
	pinLockedUntil: Date | null;
	pinRevalidationRequiredAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const PinCredentialSchema = new Schema<PinCredentialDoc>(
	{
		_id: { type: String, required: true },
		adminUserId: { type: String, required: true },
		pinHash: { type: String, required: true, select: false },
		failedPinAttempts: { type: Number, default: 0 },
		pinLockedUntil: { type: Date, default: null },
		pinRevalidationRequiredAt: { type: Date, default: null },
	},
	{ collection: COLLECTION_NAMES.PinCredential, timestamps: true },
);

PinCredentialSchema.index({ adminUserId: 1 }, { unique: true });

export const PinCredentialModel: Model<PinCredentialDoc> =
	(models.PinCredential as Model<PinCredentialDoc>) ?? model<PinCredentialDoc>('PinCredential', PinCredentialSchema);

/**
 * Login identity links (password / OTP / OAuth) — auth §7.2.
 *
 * Public `Customer.identities` is a projection of these rows; hashes never live here.
 */
export interface AuthIdentityDoc {
	_id: string;
	subjectType: CredentialSubjectType;
	subjectId: string;
	provider: string;
	/** Stable provider subject (OAuth `sub`, normalized email for password, …). */
	providerSubject: string;
	email: string | null;
	linkedAt: Date;
	lastUsedAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const AuthIdentitySchema = new Schema<AuthIdentityDoc>(
	{
		_id: { type: String, required: true },
		subjectType: { type: String, enum: ['customer', 'admin_user'], required: true },
		subjectId: { type: String, required: true },
		provider: { type: String, required: true },
		providerSubject: { type: String, required: true },
		email: { type: String, default: null },
		linkedAt: { type: Date, required: true },
		lastUsedAt: { type: Date, default: null },
	},
	{ collection: COLLECTION_NAMES.AuthIdentity, timestamps: true },
);

AuthIdentitySchema.index({ provider: 1, providerSubject: 1 }, { unique: true });
AuthIdentitySchema.index({ subjectType: 1, subjectId: 1 });

export const AuthIdentityModel: Model<AuthIdentityDoc> =
	(models.AuthIdentity as Model<AuthIdentityDoc>) ?? model<AuthIdentityDoc>('AuthIdentity', AuthIdentitySchema);

export function passwordCredentialId(subjectType: CredentialSubjectType, subjectId: string): string {
	return `pcred_${subjectType}_${subjectId}`;
}

export function pinCredentialId(adminUserId: string): string {
	return `pincred_${adminUserId}`;
}

/** Public identity projection used on `Customer.identities`. */
export type PublicAuthIdentity = {
	provider: string;
	providerId?: string;
	email?: string;
};

export async function loadPublicIdentities(
	subjectType: CredentialSubjectType,
	subjectId: string,
): Promise<PublicAuthIdentity[]> {
	const rows = await AuthIdentityModel.find({ subjectType, subjectId }).lean<AuthIdentityDoc[]>().exec();
	return rows.map((row) => ({
		provider: row.provider,
		providerId: row.providerSubject,
		...(row.email ? { email: row.email } : {}),
	}));
}

export async function replacePublicIdentities(
	subjectType: CredentialSubjectType,
	subjectId: string,
	identities: PublicAuthIdentity[],
): Promise<void> {
	await AuthIdentityModel.deleteMany({ subjectType, subjectId }).exec();
	if (identities.length === 0) return;
	const now = new Date();
	await AuthIdentityModel.insertMany(
		identities.map((identity, index) => {
			const providerSubject = identity.providerId ?? identity.email ?? `${subjectId}:${index}`;
			return {
				_id: `aid_${randomUUID()}`,
				subjectType,
				subjectId,
				provider: identity.provider,
				providerSubject,
				email: identity.email ?? null,
				linkedAt: now,
				lastUsedAt: null,
			};
		}),
	);
}

export async function upsertPasswordCredential(
	subjectType: CredentialSubjectType,
	subjectId: string,
	passwordHash: string,
): Promise<void> {
	const id = passwordCredentialId(subjectType, subjectId);
	await PasswordCredentialModel.updateOne(
		{ _id: id },
		{
			$set: { subjectType, subjectId, passwordHash },
			$setOnInsert: { _id: id },
		},
		{ upsert: true },
	).exec();
}

export async function loadPasswordHash(subjectType: CredentialSubjectType, subjectId: string): Promise<string | null> {
	const doc = await PasswordCredentialModel.findById(passwordCredentialId(subjectType, subjectId))
		.select('+passwordHash')
		.lean<{ passwordHash: string }>()
		.exec();
	return doc?.passwordHash ?? null;
}
