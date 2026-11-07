import { AuthRateLimitAction, AuthRateLimitScope } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Auth rate-limit counter (`authRateLimits`).
 *
 * Mongo-backed atomic `$inc` counters until a hot store takes over. The key is a HASHED
 * identifier or IP — never a raw address — so the collection cannot become a directory of
 * who tried to log in.
 *
 * A counter that can be raced is not a rate limit, so the repository increments with a
 * single `findOneAndUpdate` upsert rather than read-then-write.
 */
export interface AuthRateLimitDoc {
	_id: string;
	key: string;
	scope: string;
	action: string;
	count: number;
	firstSeenAt: Date;
	lastSeenAt: Date;
	expiresAt: Date;
	blockedUntil: Date | null;
}

const AuthRateLimitSchema = new Schema<AuthRateLimitDoc>(
	{
		_id: { type: String, required: true },
		key: { type: String, required: true },
		scope: { type: String, enum: AuthRateLimitScope.options, required: true },
		action: {
			type: String,
			enum: AuthRateLimitAction.options,
			required: true,
		},
		count: { type: Number, default: 0 },
		firstSeenAt: { type: Date, required: true },
		lastSeenAt: { type: Date, required: true },
		expiresAt: { type: Date, required: true },
		blockedUntil: { type: Date, default: null },
	},
	{ collection: 'authRateLimits', timestamps: false },
);

/** The counter is looked up by its composite key; one row per key per window. */
AuthRateLimitSchema.index({ key: 1 }, { unique: true });
/** Window rollover is TTL-driven — an expired window simply disappears. */
AuthRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthRateLimitModel: Model<AuthRateLimitDoc> =
	(models.AuthRateLimit as Model<AuthRateLimitDoc>) ?? model<AuthRateLimitDoc>('AuthRateLimit', AuthRateLimitSchema);
