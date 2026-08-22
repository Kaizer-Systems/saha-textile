import { AdminRole, SessionAudience } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Single-use, hash-only, TTL-expiring token documents: password reset, email
 * verification, and admin invites. All three follow the same rule — the plaintext token
 * goes out exactly once in a message and is never recoverable from the database.
 */

export interface PasswordResetTokenDoc {
	_id: string;
	userId: string;
	tokenHash: string;
	audience: string;
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
}

const PasswordResetTokenSchema = new Schema<PasswordResetTokenDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, required: true },
		tokenHash: { type: String, required: true, select: false },
		audience: { type: String, enum: SessionAudience.options, required: true },
		ipHash: { type: String, default: null },
		userAgentHash: { type: String, default: null },
		expiresAt: { type: Date, required: true },
		consumedAt: { type: Date, default: null },
	},
	{ collection: 'passwordResetTokens', timestamps: { createdAt: true, updatedAt: false } },
);

PasswordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
PasswordResetTokenSchema.index({ userId: 1 });
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetTokenModel: Model<PasswordResetTokenDoc> =
	(models.PasswordResetToken as Model<PasswordResetTokenDoc>) ??
	model<PasswordResetTokenDoc>('PasswordResetToken', PasswordResetTokenSchema);

export interface EmailVerificationTokenDoc {
	_id: string;
	userId: string;
	emailNormalized: string;
	tokenHash: string;
	createdAt: Date;
	expiresAt: Date;
	consumedAt: Date | null;
}

const EmailVerificationTokenSchema = new Schema<EmailVerificationTokenDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, required: true },
		emailNormalized: { type: String, required: true },
		tokenHash: { type: String, required: true, select: false },
		expiresAt: { type: Date, required: true },
		consumedAt: { type: Date, default: null },
	},
	{ collection: 'emailVerificationTokens', timestamps: { createdAt: true, updatedAt: false } },
);

EmailVerificationTokenSchema.index({ tokenHash: 1 }, { unique: true });
EmailVerificationTokenSchema.index({ userId: 1 });
EmailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailVerificationTokenModel: Model<EmailVerificationTokenDoc> =
	(models.EmailVerificationToken as Model<EmailVerificationTokenDoc>) ??
	model<EmailVerificationTokenDoc>('EmailVerificationToken', EmailVerificationTokenSchema);

/**
 * Admin invite (`adminInvites`) — the ONLY way a staff/admin account comes into
 * existence (owner lock: no admin self-registration).
 */
export interface AdminInviteDoc {
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
}

const AdminInviteSchema = new Schema<AdminInviteDoc>(
	{
		_id: { type: String, required: true },
		emailNormalized: { type: String, required: true },
		role: { type: String, enum: AdminRole.options, required: true },
		permissions: { type: [String], default: [] },
		invitedByUserId: { type: String, required: true },
		tokenHash: { type: String, required: true, select: false },
		expiresAt: { type: Date, required: true },
		acceptedAt: { type: Date, default: null },
		revokedAt: { type: Date, default: null },
	},
	{ collection: 'adminInvites', timestamps: { createdAt: true, updatedAt: false } },
);

AdminInviteSchema.index({ tokenHash: 1 }, { unique: true });
/** One outstanding invite per address; partial so a re-invite after acceptance is fine. */
AdminInviteSchema.index(
	{ emailNormalized: 1 },
	{ unique: true, partialFilterExpression: { acceptedAt: null, revokedAt: null } },
);
/**
 * NO TTL index here on purpose: an accepted invite is part of the admin-account audit
 * trail (who invited whom, with which role) and is governed by the 7-year
 * financial/security retention tier, not by expiry.
 */

export const AdminInviteModel: Model<AdminInviteDoc> =
	(models.AdminInvite as Model<AdminInviteDoc>) ?? model<AdminInviteDoc>('AdminInvite', AdminInviteSchema);
