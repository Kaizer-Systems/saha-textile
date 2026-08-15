import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Storefront customer (`customers`).
 *
 * Password hashes live in `passwordCredentials`; login links in `authIdentities`
 * (auth §7.2 / §7.3). Operator-only fields live on `AdminUserModel`.
 * Reserved arrays (`contacts`, `savedSizes`, `measurementProfiles`) exist so the
 * collection is not reshaped again shortly (`DEC-ACCOUNT-SEPARATION` D9).
 */
export interface CustomerDoc {
	_id: string;
	email: string | null;
	emailVerified: boolean;
	phone: string | null;
	phoneVerified: boolean;
	displayName?: string;
	status: string;
	tokenVersion: number;
	failedLoginAttempts: number;
	lastLoginAt: Date | null;
	addresses: unknown[];
	contacts: unknown[];
	savedSizes: unknown[];
	measurementProfiles: unknown[];
	guestCartId: string | null;
	consent?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

const CustomerSchema = new Schema<CustomerDoc>(
	{
		_id: { type: String, required: true },
		email: { type: String, default: null },
		emailVerified: { type: Boolean, default: false },
		phone: { type: String, default: null },
		phoneVerified: { type: Boolean, default: false },
		displayName: { type: String },
		status: { type: String, enum: ['active', 'pending', 'disabled', 'locked', 'deleted'], default: 'active' },
		tokenVersion: { type: Number, default: 0 },
		failedLoginAttempts: { type: Number, default: 0 },
		lastLoginAt: { type: Date, default: null },
		addresses: { type: [Schema.Types.Mixed], default: [] },
		contacts: { type: [Schema.Types.Mixed], default: [] },
		savedSizes: { type: [Schema.Types.Mixed], default: [] },
		measurementProfiles: { type: [Schema.Types.Mixed], default: [] },
		guestCartId: { type: String, default: null },
		consent: { type: Schema.Types.Mixed },
	},
	{ collection: COLLECTION_NAMES.Customer, timestamps: true },
);

// Soft-deleted rows release email/phone uniqueness so a reclaimed address can be re-created.
CustomerSchema.index(
	{ email: 1 },
	{ unique: true, partialFilterExpression: { email: { $type: 'string' }, status: { $ne: 'deleted' } } },
);
CustomerSchema.index(
	{ phone: 1 },
	{ unique: true, partialFilterExpression: { phone: { $type: 'string' }, status: { $ne: 'deleted' } } },
);
CustomerSchema.index({ guestCartId: 1 }, { partialFilterExpression: { guestCartId: { $type: 'string' } } });
CustomerSchema.index({ status: 1 });
CustomerSchema.index({ createdAt: -1 });
CustomerSchema.index({ status: 1, createdAt: -1 });

export const CustomerModel: Model<CustomerDoc> =
	(models.Customer as Model<CustomerDoc>) ?? model<CustomerDoc>('Customer', CustomerSchema);
