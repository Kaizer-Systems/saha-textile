import { type Model, Schema, model, models } from 'mongoose';

/**
 * User account (`users`).
 *
 * Everything credential-shaped (`passwordHash`, `pinHash`) is `select: false`, so it can
 * only be read by a query that asks for it explicitly — a stray `find()` in a controller
 * cannot leak it, and the mapper to the public `User` contract never sees it.
 *
 * The version counters are the fast-invalidation mechanism the auth lock requires:
 * bumping `tokenVersion` (password change, reuse detection, disable) or
 * `permissionsVersion` (role/permission change) makes every existing access token stale
 * without waiting for it to expire or scanning the session collection.
 */
export interface UserDoc {
	_id: string;
	email: string | null;
	emailVerified: boolean;
	phone: string | null;
	phoneVerified: boolean;
	/** Admin-only alternative login identifier. */
	username: string | null;
	displayName?: string;
	role: string;
	status: string;
	/** Secret — never mapped into the public User contract. */
	passwordHash: string | null;
	/** Secret — six-digit admin PIN, password-grade hashed (argon2id). */
	pinHash: string | null;
	preferredLoginMethod: string;
	permissions: string[];
	tokenVersion: number;
	permissionsVersion: number;
	failedLoginAttempts: number;
	failedPinAttempts: number;
	/** Set when PIN use is locked after repeated failures; password login still works. */
	pinLockedUntil: Date | null;
	lastLoginAt: Date | null;
	identities: unknown[];
	addresses: unknown[];
	guestCartId: string | null;
	consent?: Record<string, unknown>;
	adminProfile?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

const UserSchema = new Schema<UserDoc>(
	{
		_id: { type: String, required: true },
		email: { type: String, default: null },
		emailVerified: { type: Boolean, default: false },
		phone: { type: String, default: null },
		phoneVerified: { type: Boolean, default: false },
		username: { type: String, default: null },
		displayName: { type: String },
		role: { type: String, enum: ['customer', 'staff', 'admin'], default: 'customer' },
		status: { type: String, enum: ['active', 'pending', 'disabled', 'locked', 'deleted'], default: 'active' },
		passwordHash: { type: String, default: null, select: false },
		pinHash: { type: String, default: null, select: false },
		preferredLoginMethod: { type: String, enum: ['password', 'pin'], default: 'password' },
		permissions: { type: [String], default: [] },
		tokenVersion: { type: Number, default: 0 },
		permissionsVersion: { type: Number, default: 0 },
		failedLoginAttempts: { type: Number, default: 0 },
		failedPinAttempts: { type: Number, default: 0 },
		pinLockedUntil: { type: Date, default: null },
		lastLoginAt: { type: Date, default: null },
		identities: { type: [Schema.Types.Mixed], default: [] },
		addresses: { type: [Schema.Types.Mixed], default: [] },
		guestCartId: { type: String, default: null },
		consent: { type: Schema.Types.Mixed },
		adminProfile: { type: Schema.Types.Mixed },
	},
	{ timestamps: true },
);

UserSchema.index({ email: 1 }, { unique: true, sparse: true });
/** Admin username login; sparse because storefront customers have none. */
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
/** Phone is collected at checkout, so it is optional and only unique when present. */
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });
/** Admin user lists filter by role and status. */
UserSchema.index({ role: 1, status: 1 });

export const UserModel: Model<UserDoc> = (models.User as Model<UserDoc>) ?? model<UserDoc>('User', UserSchema);
