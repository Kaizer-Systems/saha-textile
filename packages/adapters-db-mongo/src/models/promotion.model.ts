import { PromotionKind, PromotionScope, PromotionType } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

export interface PromotionDoc {
	_id: string;
	name: string;
	type: 'percentage' | 'fixed';
	value: number;
	scope: string;
	targetIds: string[];
	couponCode: string | null;
	kind: string;
	stackable: boolean;
	priority: number;
	startsAt?: Date;
	endsAt?: Date;
	conditions: { minCartINR: number; firstOrderOnly: boolean };
	createdAt?: Date;
	updatedAt?: Date;
}

const PromotionSchema = new Schema<PromotionDoc>(
	{
		_id: { type: String, required: true },
		name: { type: String, required: true },
		type: { type: String, enum: PromotionType.options, required: true },
		value: { type: Number, required: true },
		scope: {
			type: String,
			enum: PromotionScope.options,
			required: true,
		},
		targetIds: { type: [String], default: [] },
		couponCode: { type: String, default: null },
		kind: {
			type: String,
			enum: PromotionKind.options,
			required: true,
		},
		stackable: { type: Boolean, default: false },
		priority: { type: Number, default: 0 },
		startsAt: { type: Date },
		endsAt: { type: Date },
		conditions: { type: Schema.Types.Mixed, default: { minCartINR: 0, firstOrderOnly: false } },
	},
	{ collection: 'promotions', timestamps: true },
);

PromotionSchema.index({ couponCode: 1 });
PromotionSchema.index({ scope: 1 });
PromotionSchema.index({ startsAt: 1, endsAt: 1 });

export const PromotionModel: Model<PromotionDoc> =
	(models.Promotion as Model<PromotionDoc>) ?? model<PromotionDoc>('Promotion', PromotionSchema);
