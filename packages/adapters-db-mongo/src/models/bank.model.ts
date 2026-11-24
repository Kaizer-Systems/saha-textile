import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

/** Bank accounts (accounts brief BA): one per bank ledger; an IFSC and number only once. */
const BankAccountSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, ledgerId: { type: String, required: true } },
	{
		strict: false,
		strictQuery: false,
		versionKey: false,
		timestamps: false,
		collection: COLLECTION_NAMES.BankAccount,
	},
);
BankAccountSchema.index({ ledgerId: 1 }, { unique: true });
BankAccountSchema.index({ ifsc: 1, number: 1 }, { unique: true });
export const BankAccountModel: Model<AggregateDoc> =
	(models['BankAccount'] as Model<AggregateDoc>) ?? model<AggregateDoc>('BankAccount', BankAccountSchema);
