import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Back-office operator (`adminUsers`).
 *
 * Password/PIN hashes live in `passwordCredentials` / `pinCredentials` (auth §7.3 / §7.3A).
 * Customer fields do not live here (`DEC-ACCOUNT-SEPARATION`).
 */
export interface AdminUserDoc {
	_id: string;
	email: string | null;
	emailVerified: boolean;
	username: string | null;
	displayName?: string;
	phone?: string | null;
	role: 'staff' | 'admin';
	status: string;
	preferredLoginMethod: string;
	permissions: string[];
	tokenVersion: number;
	permissionsVersion: number;
	failedLoginAttempts: number;
	lastLoginAt: Date | null;
	adminProfile?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

const AdminUserSchema = new Schema<AdminUserDoc>(
	{
		_id: { type: String, required: true },
		email: { type: String, default: null },
		emailVerified: { type: Boolean, default: false },
		username: { type: String, default: null },
		displayName: { type: String },
		phone: { type: String, default: null },
		role: { type: String, enum: ['staff', 'admin'], required: true },
		status: { type: String, enum: ['active', 'pending', 'disabled', 'locked', 'deleted'], default: 'active' },
		preferredLoginMethod: { type: String, enum: ['password', 'pin'], default: 'password' },
		permissions: { type: [String], default: [] },
		tokenVersion: { type: Number, default: 0 },
		permissionsVersion: { type: Number, default: 0 },
		failedLoginAttempts: { type: Number, default: 0 },
		lastLoginAt: { type: Date, default: null },
		adminProfile: { type: Schema.Types.Mixed },
	},
	{ collection: COLLECTION_NAMES.AdminUser, timestamps: true },
);

AdminUserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
AdminUserSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });
AdminUserSchema.index({ role: 1, status: 1 });

export const AdminUserModel: Model<AdminUserDoc> =
	(models.AdminUser as Model<AdminUserDoc>) ?? model<AdminUserDoc>('AdminUser', AdminUserSchema);
