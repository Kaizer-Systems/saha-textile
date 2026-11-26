import { LanguageShopState } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Settings › Languages (step 0d, owner decision round 2026-11-15). One row per language ever
 * added; `_id` is its code, so a language can never hold two rows. A deleted language keeps its
 * row (`deletedAt`), which is how its old addresses still answer 301 and how adding it again finds
 * its stored text.
 */
export interface LanguageDoc {
	_id: string;
	admin: boolean;
	shop: string;
	everOn: boolean;
	addedAt: Date | null;
	addedBy: string | null;
	changedAt: Date | null;
	changedBy: string | null;
	deletedAt: Date | null;
	deletedBy: string | null;
	remindedAt: Date | null;
	erasedAt: Date | null;
}

const LanguageSchema = new Schema<LanguageDoc>(
	{
		_id: { type: String, required: true },
		admin: { type: Boolean, required: true },
		shop: { type: String, required: true, enum: LanguageShopState.options },
		everOn: { type: Boolean, default: false },
		addedAt: { type: Date, default: null },
		addedBy: { type: String, default: null },
		changedAt: { type: Date, default: null },
		changedBy: { type: String, default: null },
		deletedAt: { type: Date, default: null },
		deletedBy: { type: String, default: null },
		remindedAt: { type: Date, default: null },
		erasedAt: { type: Date, default: null },
	},
	{ collection: 'languages', timestamps: false },
);

export const LanguageModel: Model<LanguageDoc> =
	(models.Language as Model<LanguageDoc>) ?? model<LanguageDoc>('Language', LanguageSchema);
