import { IDENTITY_SUBJECT_TYPES } from '@saha-textile/core-domain';
import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import { sessionFrom } from '../transaction-manager';

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
		subjectType: { type: String, enum: IDENTITY_SUBJECT_TYPES, required: true },
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
		subjectType: { type: String, enum: IDENTITY_SUBJECT_TYPES, required: true },
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

/**
 * Public identity projection used on `Customer.identities`.
 *
 * READ ONLY. `CustomerRepository.save` no longer accepts identities to write — `authIdentities`
 * has one writer, `AuthIdentityRepository` — so this exists purely to fill the field on the way
 * out of a customer read.
 */
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

export function passwordCredentialId(subjectType: CredentialSubjectType, subjectId: string): string {
	return `pcred_${subjectType}_${subjectId}`;
}

export function pinCredentialId(adminUserId: string): string {
	return `pincred_${adminUserId}`;
}

export async function upsertPasswordCredential(
	subjectType: CredentialSubjectType,
	subjectId: string,
	passwordHash: string,
): Promise<void> {
	const id = passwordCredentialId(subjectType, subjectId);
	// Joins an open transaction through the async context, so that creating an account and giving
	// it its first credential is one commit rather than two hopeful steps.
	await PasswordCredentialModel.updateOne(
		{ _id: id },
		{
			$set: { subjectType, subjectId, passwordHash },
			$setOnInsert: { _id: id },
		},
		{ upsert: true, session: sessionFrom() },
	).exec();
}

export async function loadPasswordHash(subjectType: CredentialSubjectType, subjectId: string): Promise<string | null> {
	const doc = await PasswordCredentialModel.findById(passwordCredentialId(subjectType, subjectId))
		.select('+passwordHash')
		.lean<{ passwordHash: string }>()
		.exec();
	return doc?.passwordHash ?? null;
}
