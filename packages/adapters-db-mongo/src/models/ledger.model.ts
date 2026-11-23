import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

// strictQuery off: filters name fields these loose schemas don't declare (reverseOn, holderId…), which Mongoose
// would otherwise drop from the query and match every row.
const loose = { strict: false, strictQuery: false, versionKey: false, timestamps: false } as const;

/** The chart's groups (accounts brief Q1); `_id` is the group id. */
const AccountGroupSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, systemKey: { type: String, default: null } },
	{ ...loose, collection: COLLECTION_NAMES.AccountGroup },
);
AccountGroupSchema.index(
	{ systemKey: 1 },
	{ unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } },
);
export const AccountGroupModel: Model<AggregateDoc> =
	(models.AccountGroup as Model<AggregateDoc>) ?? model<AggregateDoc>('AccountGroup', AccountGroupSchema);

/** Ledgers; posting rules find system ledgers by `systemKey`. */
const LedgerSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		systemKey: { type: String, default: null },
		groupId: { type: String, required: true },
		updatedAt: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.Ledger },
);
LedgerSchema.index({ systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } });
export const LedgerModel: Model<AggregateDoc> =
	(models.Ledger as Model<AggregateDoc>) ?? model<AggregateDoc>('Ledger', LedgerSchema);

/** Posted vouchers (Q3, Q4 and every document's posting); a repeated idempotency key is refused by the index. */
const JournalVoucherSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		number: { type: String, required: true },
		date: { type: String, required: true },
		kind: { type: String, required: true },
		idempotencyKey: { type: String, default: null },
	},
	{ ...loose, collection: COLLECTION_NAMES.JournalVoucher },
);
JournalVoucherSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
JournalVoucherSchema.index({ date: -1, number: -1 });
JournalVoucherSchema.index({ reverseOn: 1, reversedById: 1 });
JournalVoucherSchema.index({ 'source.type': 1, 'source.id': 1 });
export const JournalVoucherModel: Model<AggregateDoc> =
	(models.JournalVoucher as Model<AggregateDoc>) ?? model<AggregateDoc>('JournalVoucher', JournalVoucherSchema);

/** One row per voucher line, so ledgers, locations and GSTINs read fast on a large set of books. */
const JournalLineSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		voucherId: { type: String, required: true },
		ledgerId: { type: String, required: true },
		locationId: { type: String, required: true },
		date: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.JournalLine },
);
JournalLineSchema.index({ ledgerId: 1, date: 1 });
JournalLineSchema.index({ gstRegistrationId: 1, date: 1 });
JournalLineSchema.index({ locationId: 1, date: 1 });
JournalLineSchema.index({ voucherId: 1 });
export const JournalLineModel: Model<AggregateDoc> =
	(models.JournalLine as Model<AggregateDoc>) ?? model<AggregateDoc>('JournalLine', JournalLineSchema);

/** One row per month and part of the books (T1); `_id` is `<month>:<part>`. */
const PeriodLockSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.PeriodLock },
);
export const PeriodLockModel: Model<AggregateDoc> =
	(models.PeriodLock as Model<AggregateDoc>) ?? model<AggregateDoc>('PeriodLock', PeriodLockSchema);

/** Who is editing which document (D10); `_id` is `<type>:<id>`. */
const DocumentLockSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, lastActiveAt: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.DocumentLock },
);
export const DocumentLockModel: Model<AggregateDoc> =
	(models.DocumentLock as Model<AggregateDoc>) ?? model<AggregateDoc>('DocumentLock', DocumentLockSchema);
