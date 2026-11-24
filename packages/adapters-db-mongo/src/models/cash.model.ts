import { type Model, Schema, model, models } from 'mongoose';

import { COLLECTION_NAMES } from '../collection-names';
import type { AggregateDoc } from './purchasing.model';

const loose = { strict: false, strictQuery: false, versionKey: false, timestamps: false } as const;
const reuse = (name: string, schema: Schema<AggregateDoc>): Model<AggregateDoc> =>
	(models[name] as Model<AggregateDoc>) ?? model<AggregateDoc>(name, schema);

/** Settings › Cash boxes: one document (`_id: 'cash'`) with the notes and coins and the rules (accounts brief O1). */
const CashSettingSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.CashSetting },
);
export const CashSettingModel = reuse('CashSetting', CashSettingSchema);

/** Cash boxes: each has its own ledger, used by no other box. */
const CashBoxSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, ledgerId: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.CashBox },
);
CashBoxSchema.index({ ledgerId: 1 }, { unique: true });
CashBoxSchema.index({ locationId: 1 });
export const CashBoxModel = reuse('CashBox', CashBoxSchema);

/** One sheet per box and day; at most one open per box. */
const CashSheetSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, boxId: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.CashSheet },
);
CashSheetSchema.index({ boxId: 1, date: 1 }, { unique: true });
CashSheetSchema.index(
	{ boxId: 1 },
	{ unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_sheet' },
);
CashSheetSchema.index({ date: -1, status: 1 });
export const CashSheetModel = reuse('CashSheet', CashSheetSchema);

/** A sheet's lines: one per voucher and box, written in the voucher's transaction. */
const CashSheetLineSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, boxId: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.CashSheetLine },
);
CashSheetLineSchema.index({ voucherId: 1, boxId: 1 }, { unique: true });
CashSheetLineSchema.index({ sheetId: 1, at: 1 });
CashSheetLineSchema.index({ boxId: 1, sheetId: 1 });
export const CashSheetLineModel = reuse('CashSheetLine', CashSheetLineSchema);

/** Petty expenses: PC numbers unique; looked up by box until refilled, and by day and payee for the cash limit. */
const PettyExpenseSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, number: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.PettyExpense },
);
PettyExpenseSchema.index({ number: 1 }, { unique: true });
PettyExpenseSchema.index({ boxId: 1, refillId: 1 });
PettyExpenseSchema.index({ date: 1, paidToKey: 1 });
export const PettyExpenseModel = reuse('PettyExpense', PettyExpenseSchema);

/** Staff expense claims: EC numbers unique. */
const ExpenseClaimSchema = new Schema<AggregateDoc>(
	{ _id: { type: String, required: true }, number: { type: String, required: true } },
	{ ...loose, collection: COLLECTION_NAMES.ExpenseClaim },
);
ExpenseClaimSchema.index({ number: 1 }, { unique: true });
ExpenseClaimSchema.index({ status: 1, spentOn: -1 });
export const ExpenseClaimModel = reuse('ExpenseClaim', ExpenseClaimSchema);
