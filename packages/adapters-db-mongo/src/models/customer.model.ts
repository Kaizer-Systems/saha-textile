import { CustomerStatus } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';

/**
 * Every status that still HOLDS an email/phone, derived from the contract enum.
 *
 * Spelled as `$in` over the live statuses rather than the obvious `$ne: 'deleted'`, because
 * MongoDB does not accept `$ne` in a partial index filter — it refuses the whole specification
 * with "Expression not supported in partial index: $not". That refusal is silent under
 * mongoose's `autoIndex`, so the index simply stayed at its older definition while the source
 * read as though soft delete released the address. It did not.
 *
 * Derived from the enum, so a status added later is covered without anybody remembering to
 * come back here.
 */
const UNIQUENESS_HOLDING_STATUSES = CustomerStatus.options.filter((status) => status !== 'deleted');

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
		status: { type: String, enum: CustomerStatus.options, default: 'active' },
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
	{
		unique: true,
		partialFilterExpression: { email: { $type: 'string' }, status: { $in: UNIQUENESS_HOLDING_STATUSES } },
	},
);
CustomerSchema.index(
	{ phone: 1 },
	{
		unique: true,
		partialFilterExpression: { phone: { $type: 'string' }, status: { $in: UNIQUENESS_HOLDING_STATUSES } },
	},
);
CustomerSchema.index({ guestCartId: 1 }, { partialFilterExpression: { guestCartId: { $type: 'string' } } });
CustomerSchema.index({ status: 1 });
CustomerSchema.index({ createdAt: -1 });
CustomerSchema.index({ status: 1, createdAt: -1 });

export const CustomerModel: Model<CustomerDoc> =
	(models.Customer as Model<CustomerDoc>) ?? model<CustomerDoc>('Customer', CustomerSchema);
