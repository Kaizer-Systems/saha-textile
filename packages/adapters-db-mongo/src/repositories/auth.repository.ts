import type {
	AdminInvite,
	AdminUserAuthState,
	AuthSession,
	CustomerAuthState,
	EmailVerificationToken,
	OAuthState,
	OtpChallenge,
	OtpPurpose,
	PasswordResetToken,
	SessionAudience,
	SessionRevokeReason,
	AdminUserStatus,
	CustomerStatus,
} from '@saha-textile/contracts';
import type {
	AdminInviteRepository,
	AdminUserAuthRepository,
	AuthRateLimitRepository,
	AuthSessionRepository,
	CustomerAuthRepository,
	EmailVerificationTokenRepository,
	OAuthStateRepository,
	OtpChallengeRepository,
	PasswordResetTokenRepository,
} from '@saha-textile/core-domain';

import {
	AdminInviteModel,
	AdminUserModel,
	AuthRateLimitModel,
	AuthSessionModel,
	type AuthSessionDoc,
	CustomerModel,
	EmailVerificationTokenModel,
	loadPasswordHash,
	OAuthStateModel,
	type OAuthStateDoc,
	OtpChallengeModel,
	type OtpChallengeDoc,
	PasswordResetTokenModel,
	PinCredentialModel,
	pinCredentialId,
	upsertPasswordCredential,
} from '../models/index';

const iso = (value?: Date | null): string | null => (value ? new Date(value).toISOString() : null);
const isoRequired = (value: Date): string => new Date(value).toISOString();

/**
 * Fields that are `select: false` on the schema must be requested explicitly. Sessions
 * are only ever loaded WITH their hashes by the rotation/reuse paths that need them.
 */
const SESSION_SECRETS = '+refreshTokenHash +previousRefreshTokenHash +csrfSecretHash';

function toSession(doc: AuthSessionDoc): AuthSession {
	const roleAtLogin = doc.roleAtLogin === 'customer' || doc.roleAtLogin == null ? null : doc.roleAtLogin;
	return {
		id: doc._id,
		userId: doc.userId,
		audience: doc.audience,
		roleAtLogin,
		refreshTokenHash: doc.refreshTokenHash,
		refreshFamilyId: doc.refreshFamilyId,
		rotationCounter: doc.rotationCounter ?? 0,
		previousRefreshTokenHash: doc.previousRefreshTokenHash ?? null,
		replacedBySessionId: doc.replacedBySessionId ?? null,
		csrfSecretHash: doc.csrfSecretHash,
		device: doc.device ?? { userAgentHash: null, ipHash: null, country: null, label: null },
		// Rows predating "remember me" were all persistent; absent must not read as false.
		persistent: doc.persistent ?? true,
		createdAt: isoRequired(doc.createdAt),
		lastSeenAt: isoRequired(doc.lastSeenAt),
		expiresAt: isoRequired(doc.expiresAt),
		absoluteExpiresAt: isoRequired(doc.absoluteExpiresAt),
		revokedAt: iso(doc.revokedAt),
		revokeReason: (doc.revokeReason as AuthSession['revokeReason']) ?? null,
	};
}

export class MongoAuthSessionRepository implements AuthSessionRepository {
	async findById(sessionId: string): Promise<AuthSession | null> {
		const doc = await AuthSessionModel.findById(sessionId).select(SESSION_SECRETS).lean<AuthSessionDoc>().exec();
		return doc ? toSession(doc) : null;
	}

	async findByRefreshTokenHash(hash: string): Promise<AuthSession | null> {
		const doc = await AuthSessionModel.findOne({ refreshTokenHash: hash })
			.select(SESSION_SECRETS)
			.lean<AuthSessionDoc>()
			.exec();
		return doc ? toSession(doc) : null;
	}

	/**
	 * A hit here means a token that was ALREADY rotated away is being presented — the
	 * signature of a stolen refresh token. The caller revokes the whole family.
	 */
	async findByPreviousRefreshTokenHash(hash: string): Promise<AuthSession | null> {
		const doc = await AuthSessionModel.findOne({ previousRefreshTokenHash: hash })
			.select(SESSION_SECRETS)
			.lean<AuthSessionDoc>()
			.exec();
		return doc ? toSession(doc) : null;
	}

	async listActiveForUser(userId: string, audience?: SessionAudience): Promise<AuthSession[]> {
		const docs = await AuthSessionModel.find({
			userId,
			revokedAt: null,
			...(audience ? { audience } : {}),
		})
			.select(SESSION_SECRETS)
			.sort({ lastSeenAt: -1 })
			.lean<AuthSessionDoc[]>()
			.exec();
		return docs.map(toSession);
	}

	async create(session: AuthSession): Promise<AuthSession> {
		const { id, createdAt, lastSeenAt, expiresAt, absoluteExpiresAt, revokedAt, ...rest } = session;
		await AuthSessionModel.create([
			{
				_id: id,
				...rest,
				createdAt: new Date(createdAt),
				lastSeenAt: new Date(lastSeenAt),
				expiresAt: new Date(expiresAt),
				absoluteExpiresAt: new Date(absoluteExpiresAt),
				revokedAt: revokedAt ? new Date(revokedAt) : null,
			},
		]);
		return session;
	}

	/**
	 * Rotation is a single conditional update: it only matches a session that is still
	 * live and still holding the token being replaced. Two concurrent refreshes with the
	 * same token therefore cannot both succeed — the loser gets `null` and is treated as
	 * a reuse attempt.
	 */
	async rotate(input: {
		sessionId: string;
		nextRefreshTokenHash: string;
		previousRefreshTokenHash: string;
		nextCsrfSecretHash: string;
		expiresAt: string;
		lastSeenAt: string;
	}): Promise<AuthSession | null> {
		const doc = await AuthSessionModel.findOneAndUpdate(
			{
				_id: input.sessionId,
				refreshTokenHash: input.previousRefreshTokenHash,
				revokedAt: null,
			},
			{
				$set: {
					refreshTokenHash: input.nextRefreshTokenHash,
					previousRefreshTokenHash: input.previousRefreshTokenHash,
					csrfSecretHash: input.nextCsrfSecretHash,
					expiresAt: new Date(input.expiresAt),
					lastSeenAt: new Date(input.lastSeenAt),
				},
				$inc: { rotationCounter: 1 },
			},
			{ returnDocument: 'after' },
		)
			.select(SESSION_SECRETS)
			.lean<AuthSessionDoc>()
			.exec();

		return doc ? toSession(doc) : null;
	}

	async revoke(sessionId: string, reason: SessionRevokeReason, at: string): Promise<void> {
		await AuthSessionModel.updateOne(
			{ _id: sessionId, revokedAt: null },
			{ $set: { revokedAt: new Date(at), revokeReason: reason } },
		).exec();
	}

	async revokeFamily(refreshFamilyId: string, reason: SessionRevokeReason, at: string): Promise<number> {
		const result = await AuthSessionModel.updateMany(
			{ refreshFamilyId, revokedAt: null },
			{ $set: { revokedAt: new Date(at), revokeReason: reason } },
		).exec();
		return result.modifiedCount;
	}

	async revokeAllForUser(userId: string, reason: SessionRevokeReason, at: string): Promise<number> {
		const result = await AuthSessionModel.updateMany(
			{ userId, revokedAt: null },
			{ $set: { revokedAt: new Date(at), revokeReason: reason } },
		).exec();
		return result.modifiedCount;
	}

	async touch(sessionId: string, lastSeenAt: string): Promise<void> {
		await AuthSessionModel.updateOne({ _id: sessionId }, { $set: { lastSeenAt: new Date(lastSeenAt) } }).exec();
	}

	async updateDeviceLabel(sessionId: string, label: string): Promise<void> {
		await AuthSessionModel.updateOne({ _id: sessionId }, { $set: { 'device.label': label } }).exec();
	}

	async updateCsrfSecretHash(sessionId: string, nextCsrfSecretHash: string): Promise<AuthSession | null> {
		const doc = await AuthSessionModel.findOneAndUpdate(
			{ _id: sessionId, revokedAt: null },
			{ $set: { csrfSecretHash: nextCsrfSecretHash } },
			{ returnDocument: 'after' },
		)
			.select(SESSION_SECRETS)
			.lean<AuthSessionDoc>()
			.exec();
		return doc ? toSession(doc) : null;
	}
}

function toChallenge(doc: OtpChallengeDoc): OtpChallenge {
	return {
		id: doc._id,
		identifier: doc.identifier,
		purpose: doc.purpose as OtpChallenge['purpose'],
		channel: doc.channel as OtpChallenge['channel'],
		codeHash: doc.codeHash,
		userId: doc.userId ?? null,
		attempts: doc.attempts ?? 0,
		maxAttempts: doc.maxAttempts ?? 5,
		resendCount: doc.resendCount ?? 0,
		lastSentAt: iso(doc.lastSentAt),
		ipHash: doc.ipHash ?? null,
		userAgentHash: doc.userAgentHash ?? null,
		createdAt: isoRequired(doc.createdAt),
		expiresAt: isoRequired(doc.expiresAt),
		consumedAt: iso(doc.consumedAt),
		blockedAt: iso(doc.blockedAt),
	};
}

export class MongoOtpChallengeRepository implements OtpChallengeRepository {
	async findActive(identifierHash: string, purpose: OtpPurpose): Promise<OtpChallenge | null> {
		const doc = await OtpChallengeModel.findOne({
			identifier: identifierHash,
			purpose,
			consumedAt: null,
			expiresAt: { $gt: new Date() },
		})
			.select('+codeHash')
			.lean<OtpChallengeDoc>()
			.exec();
		return doc ? toChallenge(doc) : null;
	}

	/**
	 * Replaces any existing ACTIVE challenge for the same (identifier × purpose): the
	 * partial unique index makes two live challenges impossible, so a resend must clear
	 * the old one rather than race it.
	 */
	async upsertActive(challenge: OtpChallenge): Promise<OtpChallenge> {
		await OtpChallengeModel.deleteMany({
			identifier: challenge.identifier,
			purpose: challenge.purpose,
			consumedAt: null,
		}).exec();

		const { id, createdAt, expiresAt, lastSentAt, consumedAt, blockedAt, ...rest } = challenge;
		await OtpChallengeModel.create([
			{
				_id: id,
				...rest,
				createdAt: new Date(createdAt),
				expiresAt: new Date(expiresAt),
				lastSentAt: lastSentAt ? new Date(lastSentAt) : null,
				consumedAt: consumedAt ? new Date(consumedAt) : null,
				blockedAt: blockedAt ? new Date(blockedAt) : null,
			},
		]);
		return challenge;
	}

	async incrementAttempts(challengeId: string): Promise<number> {
		const doc = await OtpChallengeModel.findOneAndUpdate(
			{ _id: challengeId },
			{ $inc: { attempts: 1 } },
			{ returnDocument: 'after' },
		)
			.lean<OtpChallengeDoc>()
			.exec();
		return doc?.attempts ?? 0;
	}

	/**
	 * Atomic single-use consumption. The `consumedAt: null` condition is what makes two
	 * concurrent verifications of the same code impossible — the second matches nothing
	 * and gets `false`.
	 */
	async consume(challengeId: string, at: string): Promise<boolean> {
		const result = await OtpChallengeModel.updateOne(
			{ _id: challengeId, consumedAt: null },
			{ $set: { consumedAt: new Date(at) } },
		).exec();
		return result.modifiedCount === 1;
	}

	async deleteExpired(now: string): Promise<number> {
		const result = await OtpChallengeModel.deleteMany({ expiresAt: { $lte: new Date(now) } }).exec();
		return result.deletedCount ?? 0;
	}
}

function toOAuthState(doc: OAuthStateDoc): OAuthState {
	return {
		id: doc._id,
		provider: doc.provider as OAuthState['provider'],
		audience: doc.audience as OAuthState['audience'],
		stateHash: doc.stateHash,
		nonceHash: doc.nonceHash ?? null,
		codeVerifierHash: doc.codeVerifierHash ?? null,
		redirectAfterLogin: doc.redirectAfterLogin ?? null,
		guestCartId: doc.guestCartId ?? null,
		ipHash: doc.ipHash ?? null,
		userAgentHash: doc.userAgentHash ?? null,
		createdAt: isoRequired(doc.createdAt),
		expiresAt: isoRequired(doc.expiresAt),
		consumedAt: iso(doc.consumedAt),
	};
}

export class MongoOAuthStateRepository implements OAuthStateRepository {
	async create(state: OAuthState): Promise<OAuthState> {
		const { id, createdAt, expiresAt, consumedAt, ...rest } = state;
		await OAuthStateModel.create([
			{
				_id: id,
				...rest,
				createdAt: new Date(createdAt),
				expiresAt: new Date(expiresAt),
				consumedAt: consumedAt ? new Date(consumedAt) : null,
			},
		]);
		return state;
	}

	/** Single-use: the state is returned and marked consumed in one atomic step. */
	async consume(stateValue: string): Promise<OAuthState | null> {
		const doc = await OAuthStateModel.findOneAndUpdate(
			{ stateHash: stateValue, consumedAt: null, expiresAt: { $gt: new Date() } },
			{ $set: { consumedAt: new Date() } },
			{ returnDocument: 'after' },
		)
			.select('+stateHash +nonceHash +codeVerifierHash')
			.lean<OAuthStateDoc>()
			.exec();
		return doc ? toOAuthState(doc) : null;
	}

	async deleteExpired(now: string): Promise<number> {
		const result = await OAuthStateModel.deleteMany({ expiresAt: { $lte: new Date(now) } }).exec();
		return result.deletedCount ?? 0;
	}
}

export class MongoPasswordResetTokenRepository implements PasswordResetTokenRepository {
	async create(token: PasswordResetToken): Promise<PasswordResetToken> {
		const { id, createdAt, expiresAt, consumedAt, ...rest } = token;
		await PasswordResetTokenModel.create([
			{
				_id: id,
				...rest,
				createdAt: new Date(createdAt),
				expiresAt: new Date(expiresAt),
				consumedAt: consumedAt ? new Date(consumedAt) : null,
			},
		]);
		return token;
	}

	async consume(tokenHash: string, at: string): Promise<PasswordResetToken | null> {
		const doc = await PasswordResetTokenModel.findOneAndUpdate(
			{ tokenHash, consumedAt: null, expiresAt: { $gt: new Date(at) } },
			{ $set: { consumedAt: new Date(at) } },
			{ returnDocument: 'after' },
		)
			.select('+tokenHash')
			.lean<{
				_id: string;
				userId: string;
				tokenHash: string;
				audience: string;
				ipHash: string | null;
				userAgentHash: string | null;
				createdAt: Date;
				expiresAt: Date;
				consumedAt: Date | null;
			}>()
			.exec();

		if (!doc) return null;
		return {
			id: doc._id,
			userId: doc.userId,
			tokenHash: doc.tokenHash,
			audience: doc.audience as PasswordResetToken['audience'],
			ipHash: doc.ipHash ?? null,
			userAgentHash: doc.userAgentHash ?? null,
			createdAt: isoRequired(doc.createdAt),
			expiresAt: isoRequired(doc.expiresAt),
			consumedAt: iso(doc.consumedAt),
		};
	}

	async deleteExpired(now: string): Promise<number> {
		const result = await PasswordResetTokenModel.deleteMany({ expiresAt: { $lte: new Date(now) } }).exec();
		return result.deletedCount ?? 0;
	}
}

export class MongoEmailVerificationTokenRepository implements EmailVerificationTokenRepository {
	async create(token: EmailVerificationToken): Promise<EmailVerificationToken> {
		const { id, createdAt, expiresAt, consumedAt, ...rest } = token;
		await EmailVerificationTokenModel.create([
			{
				_id: id,
				...rest,
				createdAt: new Date(createdAt),
				expiresAt: new Date(expiresAt),
				consumedAt: consumedAt ? new Date(consumedAt) : null,
			},
		]);
		return token;
	}

	async consume(tokenHash: string, at: string): Promise<EmailVerificationToken | null> {
		const doc = await EmailVerificationTokenModel.findOneAndUpdate(
			{ tokenHash, consumedAt: null, expiresAt: { $gt: new Date(at) } },
			{ $set: { consumedAt: new Date(at) } },
			{ returnDocument: 'after' },
		)
			.select('+tokenHash')
			.lean<{
				_id: string;
				userId: string;
				emailNormalized: string;
				tokenHash: string;
				createdAt: Date;
				expiresAt: Date;
				consumedAt: Date | null;
			}>()
			.exec();

		if (!doc) return null;
		return {
			id: doc._id,
			userId: doc.userId,
			emailNormalized: doc.emailNormalized,
			tokenHash: doc.tokenHash,
			createdAt: isoRequired(doc.createdAt),
			expiresAt: isoRequired(doc.expiresAt),
			consumedAt: iso(doc.consumedAt),
		};
	}

	async deleteExpired(now: string): Promise<number> {
		const result = await EmailVerificationTokenModel.deleteMany({ expiresAt: { $lte: new Date(now) } }).exec();
		return result.deletedCount ?? 0;
	}
}

type AdminInviteLean = {
	_id: string;
	emailNormalized: string;
	role: string;
	permissions: string[];
	invitedByUserId: string;
	tokenHash: string;
	createdAt: Date;
	expiresAt: Date;
	acceptedAt: Date | null;
	revokedAt: Date | null;
};

const toInvite = (doc: AdminInviteLean): AdminInvite => ({
	id: doc._id,
	emailNormalized: doc.emailNormalized,
	role: doc.role as AdminInvite['role'],
	permissions: doc.permissions ?? [],
	invitedByUserId: doc.invitedByUserId,
	tokenHash: doc.tokenHash,
	createdAt: isoRequired(doc.createdAt),
	expiresAt: isoRequired(doc.expiresAt),
	acceptedAt: iso(doc.acceptedAt),
	revokedAt: iso(doc.revokedAt),
});

export class MongoAdminInviteRepository implements AdminInviteRepository {
	async findByTokenHash(tokenHash: string): Promise<AdminInvite | null> {
		const doc = await AdminInviteModel.findOne({ tokenHash }).select('+tokenHash').lean<AdminInviteLean>().exec();
		return doc ? toInvite(doc) : null;
	}

	async listPending(): Promise<AdminInvite[]> {
		const docs = await AdminInviteModel.find({ acceptedAt: null, revokedAt: null })
			.select('+tokenHash')
			.lean<AdminInviteLean[]>()
			.exec();
		return docs.map(toInvite);
	}

	async create(invite: AdminInvite): Promise<AdminInvite> {
		const { id, createdAt, expiresAt, acceptedAt, revokedAt, ...rest } = invite;
		await AdminInviteModel.create([
			{
				_id: id,
				...rest,
				createdAt: new Date(createdAt),
				expiresAt: new Date(expiresAt),
				acceptedAt: acceptedAt ? new Date(acceptedAt) : null,
				revokedAt: revokedAt ? new Date(revokedAt) : null,
			},
		]);
		return invite;
	}

	async consume(tokenHash: string, at: string): Promise<AdminInvite | null> {
		const doc = await AdminInviteModel.findOneAndUpdate(
			{ tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date(at) } },
			{ $set: { acceptedAt: new Date(at) } },
			{ returnDocument: 'after' },
		)
			.select('+tokenHash')
			.lean<AdminInviteLean>()
			.exec();
		return doc ? toInvite(doc) : null;
	}

	async revoke(inviteId: string, at: string): Promise<void> {
		await AdminInviteModel.updateOne(
			{ _id: inviteId, acceptedAt: null },
			{ $set: { revokedAt: new Date(at) } },
		).exec();
	}
}

/** MongoDB duplicate-key error. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export class MongoAuthRateLimitRepository implements AuthRateLimitRepository {
	/**
	 * One atomic upsert: increment the counter and, only on insert, stamp the window.
	 * Read-then-write here would let two parallel attempts each see the old count and
	 * both slip under the limit.
	 *
	 * The retry is NOT optional. Concurrent upserts that all miss the document race to
	 * insert it, and MongoDB raises E11000 for the losers rather than converting them to
	 * updates — documented driver behaviour that the application must handle. Without
	 * this, five simultaneous login attempts would surface as 500s instead of being rate
	 * limited, which is precisely the moment the limiter is supposed to work. The retry
	 * always succeeds because the row now exists, so the second call takes the update path.
	 */
	async hit(key: string, windowSeconds: number, now: string): Promise<number> {
		const at = new Date(now);
		const [scope = 'ip', action = 'login'] = key.split(':');

		const increment = (allowUpsert: boolean) =>
			AuthRateLimitModel.findOneAndUpdate(
				{ _id: key },
				{
					$inc: { count: 1 },
					$set: { lastSeenAt: at },
					...(allowUpsert
						? {
								$setOnInsert: {
									key,
									firstSeenAt: at,
									expiresAt: new Date(at.getTime() + windowSeconds * 1000),
									// Key layout is `<scope>:<action>:<hash>`; parsed back for reporting.
									scope,
									action,
									blockedUntil: null,
								},
							}
						: {}),
				},
				{ upsert: allowUpsert, returnDocument: 'after' },
			)
				.lean<{ count: number }>()
				.exec();

		try {
			const doc = await increment(true);
			return doc?.count ?? 1;
		} catch (error) {
			if (!isDuplicateKeyError(error)) throw error;
			const doc = await increment(false);
			return doc?.count ?? 1;
		}
	}

	/**
	 * Reads the window counter without advancing it.
	 *
	 * The expiry is checked in application code as well as by the TTL index, because TTL
	 * deletion is asynchronous — Mongo sweeps roughly once a minute — and a counter that
	 * lingers past its window would keep refusing a caller whose budget has already reset.
	 */
	async peek(key: string, now: string): Promise<number> {
		const doc = await AuthRateLimitModel.findById(key).lean<{ count: number; expiresAt: Date | null }>().exec();
		if (!doc) return 0;
		if (doc.expiresAt && doc.expiresAt.getTime() <= new Date(now).getTime()) return 0;
		return doc.count;
	}

	async reset(key: string): Promise<void> {
		await AuthRateLimitModel.deleteOne({ key }).exec();
	}
}

type CustomerAuthLean = {
	_id: string;
	email: string | null;
	emailVerified: boolean;
	status: string;
	tokenVersion: number;
	failedLoginAttempts: number;
};

type AdminUserAuthLean = {
	_id: string;
	email: string | null;
	emailVerified: boolean;
	username: string | null;
	role: string;
	status: string;
	preferredLoginMethod: string;
	permissions: string[];
	tokenVersion: number;
	permissionsVersion: number;
	failedLoginAttempts: number;
};

type PinCredentialLean = {
	pinHash: string | null;
	failedPinAttempts: number;
	pinLockedUntil: Date | null;
	pinRevalidationRequiredAt: Date | null;
};

const toCustomerAuthState = (doc: CustomerAuthLean, passwordHash: string | null): CustomerAuthState => ({
	id: doc._id,
	email: doc.email ?? null,
	emailVerified: doc.emailVerified ?? false,
	status: doc.status as CustomerAuthState['status'],
	passwordHash,
	tokenVersion: doc.tokenVersion ?? 0,
	failedLoginAttempts: doc.failedLoginAttempts ?? 0,
});

const toAdminUserAuthState = (
	doc: AdminUserAuthLean,
	passwordHash: string | null,
	pin: PinCredentialLean | null,
): AdminUserAuthState => ({
	id: doc._id,
	email: doc.email ?? null,
	emailVerified: doc.emailVerified ?? false,
	username: doc.username ?? null,
	role: doc.role as AdminUserAuthState['role'],
	status: doc.status as AdminUserAuthState['status'],
	passwordHash,
	pinHash: pin?.pinHash ?? null,
	preferredLoginMethod: (doc.preferredLoginMethod as AdminUserAuthState['preferredLoginMethod']) ?? 'password',
	permissions: doc.permissions ?? [],
	tokenVersion: doc.tokenVersion ?? 0,
	permissionsVersion: doc.permissionsVersion ?? 0,
	failedLoginAttempts: doc.failedLoginAttempts ?? 0,
	failedPinAttempts: pin?.failedPinAttempts ?? 0,
	pinLockedUntil: pin?.pinLockedUntil ? new Date(pin.pinLockedUntil).toISOString() : null,
	pinRevalidationRequiredAt: pin?.pinRevalidationRequiredAt
		? new Date(pin.pinRevalidationRequiredAt).toISOString()
		: null,
});

async function loadPinCredential(adminUserId: string): Promise<PinCredentialLean | null> {
	const doc = await PinCredentialModel.findById(pinCredentialId(adminUserId))
		.select('+pinHash')
		.lean<PinCredentialLean>()
		.exec();
	return doc ?? null;
}

export class MongoCustomerAuthRepository implements CustomerAuthRepository {
	async findAuthStateById(customerId: string): Promise<CustomerAuthState | null> {
		const doc = await CustomerModel.findById(customerId).lean<CustomerAuthLean>().exec();
		if (!doc) return null;
		return toCustomerAuthState(doc, await loadPasswordHash('customer', customerId));
	}

	/**
	 * One query against whichever column the identifier is shaped like.
	 *
	 * An `@` decides it. Querying BOTH columns for every attempt would let somebody discover
	 * that a string is a registered phone by typing it into the email box — a small leak, and
	 * an entirely avoidable one.
	 */
	async findAuthStateByIdentifier(identifier: string): Promise<CustomerAuthState | null> {
		const trimmed = identifier.trim();
		const filter = trimmed.includes('@')
			? { email: trimmed.toLowerCase(), status: { $ne: 'deleted' } }
			: { phone: trimmed, status: { $ne: 'deleted' } };

		const doc = await CustomerModel.findOne(filter).lean<CustomerAuthLean>().exec();
		if (!doc) return null;
		return toCustomerAuthState(doc, await loadPasswordHash('customer', doc._id));
	}

	async findAuthStateByEmail(emailNormalized: string): Promise<CustomerAuthState | null> {
		const doc = await CustomerModel.findOne({ email: emailNormalized, status: { $ne: 'deleted' } })
			.lean<CustomerAuthLean>()
			.exec();
		if (!doc) return null;
		return toCustomerAuthState(doc, await loadPasswordHash('customer', doc._id));
	}

	async setPasswordHash(customerId: string, passwordHash: string): Promise<void> {
		await upsertPasswordCredential('customer', customerId, passwordHash);
		await CustomerModel.updateOne(
			{ _id: customerId },
			{ $set: { failedLoginAttempts: 0 }, $inc: { tokenVersion: 1 } },
		).exec();
	}

	async markEmailVerified(customerId: string, emailNormalized: string): Promise<void> {
		await CustomerModel.updateOne(
			{ _id: customerId },
			{ $set: { emailVerified: true, email: emailNormalized } },
		).exec();
	}

	async setStatus(customerId: string, status: CustomerStatus): Promise<void> {
		await CustomerModel.updateOne({ _id: customerId }, { $set: { status } }).exec();
	}

	async bumpTokenVersion(customerId: string): Promise<number> {
		const doc = await CustomerModel.findOneAndUpdate(
			{ _id: customerId },
			{ $inc: { tokenVersion: 1 } },
			{ returnDocument: 'after' },
		)
			.lean<{ tokenVersion: number }>()
			.exec();
		return doc?.tokenVersion ?? 0;
	}

	async recordSuccessfulLogin(customerId: string, at: string): Promise<void> {
		await CustomerModel.updateOne(
			{ _id: customerId },
			{ $set: { lastLoginAt: new Date(at), failedLoginAttempts: 0 } },
		).exec();
	}
}

export class MongoAdminUserAuthRepository implements AdminUserAuthRepository {
	async findAuthStateById(adminUserId: string): Promise<AdminUserAuthState | null> {
		const doc = await AdminUserModel.findById(adminUserId).lean<AdminUserAuthLean>().exec();
		if (!doc) return null;
		const [passwordHash, pin] = await Promise.all([
			loadPasswordHash('admin_user', adminUserId),
			loadPinCredential(adminUserId),
		]);
		return toAdminUserAuthState(doc, passwordHash, pin);
	}

	/** Admin login sends one field that may be either an email or a username. */
	async findAuthStateByIdentifier(identifier: string): Promise<AdminUserAuthState | null> {
		const doc = await AdminUserModel.findOne({ $or: [{ email: identifier }, { username: identifier }] })
			.lean<AdminUserAuthLean>()
			.exec();
		if (!doc) return null;
		const [passwordHash, pin] = await Promise.all([
			loadPasswordHash('admin_user', doc._id),
			loadPinCredential(doc._id),
		]);
		return toAdminUserAuthState(doc, passwordHash, pin);
	}

	/**
	 * Changing a password invalidates every existing access token in the same write —
	 * a stolen token must not outlive the credential it was minted from.
	 */
	async setPasswordHash(adminUserId: string, passwordHash: string): Promise<void> {
		await upsertPasswordCredential('admin_user', adminUserId, passwordHash);
		await AdminUserModel.updateOne(
			{ _id: adminUserId },
			{ $set: { failedLoginAttempts: 0 }, $inc: { tokenVersion: 1 } },
		).exec();
	}

	async setPinHash(adminUserId: string, pinHash: string | null): Promise<void> {
		const id = pinCredentialId(adminUserId);
		if (pinHash === null) {
			await PinCredentialModel.deleteOne({ _id: id }).exec();
			return;
		}
		await PinCredentialModel.updateOne(
			{ _id: id },
			{
				$set: {
					adminUserId,
					pinHash,
					failedPinAttempts: 0,
					pinLockedUntil: null,
				},
				$setOnInsert: { _id: id, pinRevalidationRequiredAt: null },
			},
			{ upsert: true },
		).exec();
	}

	async setPreferredLoginMethod(adminUserId: string, method: 'password' | 'pin'): Promise<void> {
		await AdminUserModel.updateOne({ _id: adminUserId }, { $set: { preferredLoginMethod: method } }).exec();
	}

	async markEmailVerified(adminUserId: string, emailNormalized: string): Promise<void> {
		await AdminUserModel.updateOne(
			{ _id: adminUserId },
			{ $set: { emailVerified: true, email: emailNormalized } },
		).exec();
	}

	async setStatus(adminUserId: string, status: AdminUserStatus): Promise<void> {
		await AdminUserModel.updateOne({ _id: adminUserId }, { $set: { status } }).exec();
	}

	async bumpTokenVersion(adminUserId: string): Promise<number> {
		const doc = await AdminUserModel.findOneAndUpdate(
			{ _id: adminUserId },
			{ $inc: { tokenVersion: 1 } },
			{ returnDocument: 'after' },
		)
			.lean<{ tokenVersion: number }>()
			.exec();
		return doc?.tokenVersion ?? 0;
	}

	async bumpPermissionsVersion(adminUserId: string): Promise<number> {
		const doc = await AdminUserModel.findOneAndUpdate(
			{ _id: adminUserId },
			{ $inc: { permissionsVersion: 1 } },
			{ returnDocument: 'after' },
		)
			.lean<{ permissionsVersion: number }>()
			.exec();
		return doc?.permissionsVersion ?? 0;
	}

	async recordSuccessfulLogin(adminUserId: string, at: string): Promise<void> {
		await AdminUserModel.updateOne(
			{ _id: adminUserId },
			{ $set: { lastLoginAt: new Date(at), failedLoginAttempts: 0 } },
		).exec();
		// A successful password login is exactly the proof a post-reset PIN suspension waits for.
		await PinCredentialModel.updateOne(
			{ _id: pinCredentialId(adminUserId) },
			{ $set: { failedPinAttempts: 0, pinLockedUntil: null, pinRevalidationRequiredAt: null } },
		).exec();
	}

	async recordFailedPinAttempt(adminUserId: string): Promise<number> {
		const doc = await PinCredentialModel.findOneAndUpdate(
			{ _id: pinCredentialId(adminUserId) },
			{ $inc: { failedPinAttempts: 1 } },
			{ returnDocument: 'after' },
		)
			.lean<{ failedPinAttempts: number }>()
			.exec();
		return doc?.failedPinAttempts ?? 0;
	}

	async lockPinUntil(adminUserId: string, until: string): Promise<void> {
		await PinCredentialModel.updateOne(
			{ _id: pinCredentialId(adminUserId) },
			{ $set: { pinLockedUntil: new Date(until) } },
		).exec();
	}

	async clearPinLock(adminUserId: string): Promise<void> {
		await PinCredentialModel.updateOne(
			{ _id: pinCredentialId(adminUserId) },
			{ $set: { pinLockedUntil: null, failedPinAttempts: 0 } },
		).exec();
	}

	async setPinRevalidationRequired(adminUserId: string, at: string | null): Promise<void> {
		await PinCredentialModel.updateOne(
			{ _id: pinCredentialId(adminUserId) },
			{ $set: { pinRevalidationRequiredAt: at ? new Date(at) : null } },
		).exec();
	}
}
