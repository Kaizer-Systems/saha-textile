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

const loose = { strict: false, strictQuery: false, versionKey: false, timestamps: false } as const;
const reuse = (name: string, schema: Schema<AggregateDoc>): Model<AggregateDoc> =>
	(models[name] as Model<AggregateDoc>) ?? model<AggregateDoc>(name, schema);

/** BA5: a bank's statement layout, matched once. */
export const BankLayoutModel = reuse(
	'BankLayout',
	new Schema<AggregateDoc>(
		{ _id: { type: String, required: true } },
		{ ...loose, collection: COLLECTION_NAMES.BankLayout },
	),
);

/** BA6: a statement's lines, each once per account. */
const BankLineSchema = new Schema<AggregateDoc>(
	{
		_id: { type: String, required: true },
		bankAccountId: { type: String, required: true },
		key: { type: String, required: true },
	},
	{ ...loose, collection: COLLECTION_NAMES.BankLine },
);
BankLineSchema.index({ bankAccountId: 1, key: 1 }, { unique: true });
BankLineSchema.index({ bankAccountId: 1, date: -1, status: 1 });
export const BankLineModel = reuse('BankLine', BankLineSchema);

/** Each statement import. */
export const BankImportModel = reuse(
	'BankImport',
	new Schema<AggregateDoc>(
		{ _id: { type: String, required: true } },
		{ ...loose, collection: COLLECTION_NAMES.BankImport },
	),
);
