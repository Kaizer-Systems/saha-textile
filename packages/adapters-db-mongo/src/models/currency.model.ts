import { type Model, Schema, model, models } from 'mongoose';

export interface CurrencyDoc {
	_id: string; // ISO 4217 code
	symbol: string;
	enabled: boolean;
	rateFromINR: number;
	paypalActive: boolean;
	paypalPct: number;
	paypalFixed: number;
	updatedAt?: Date;
	createdAt?: Date;
}

const CurrencySchema = new Schema<CurrencyDoc>(
	{
		_id: { type: String, required: true },
		symbol: { type: String, required: true },
		enabled: { type: Boolean, default: true },
		rateFromINR: { type: Number, required: true },
		paypalActive: { type: Boolean, default: false },
		paypalPct: { type: Number, default: 0 },
		paypalFixed: { type: Number, default: 0 },
	},
	{ collection: 'currencies', timestamps: true },
);

CurrencySchema.index({ enabled: 1 });

export const CurrencyModel: Model<CurrencyDoc> =
	(models.Currency as Model<CurrencyDoc>) ?? model<CurrencyDoc>('Currency', CurrencySchema);
