import { type Model, Schema, model, models } from 'mongoose';

/**
 * The shop's physical stores (owner log § stores, 2026-11-08), every text per language.
 * `photoAssetIds` doubles as the media reference list the media garbage collector reads.
 */
export interface StoreLocationDoc {
	_id: string;
	name: Record<string, string>;
	address: Record<string, string>;
	landmark: Record<string, string>;
	pinCode: string;
	mapUrl: string;
	geo: { lat: number; lng: number } | null;
	phone: string;
	hours: { day: string; open: boolean; opens: string | null; closes: string | null }[];
	photoAssetIds: string[];
	displayOrder: number;
	active: boolean;
	createdAt?: Date;
	updatedAt?: Date;
}

const DayHoursSchema = new Schema(
	{
		day: { type: String, required: true },
		open: { type: Boolean, default: false },
		opens: { type: String, default: null },
		closes: { type: String, default: null },
	},
	{ _id: false },
);

const StoreLocationSchema = new Schema<StoreLocationDoc>(
	{
		_id: { type: String, required: true },
		name: { type: Schema.Types.Mixed, default: {} },
		address: { type: Schema.Types.Mixed, default: {} },
		landmark: { type: Schema.Types.Mixed, default: {} },
		pinCode: { type: String, required: true },
		mapUrl: { type: String, required: true },
		geo: { type: Schema.Types.Mixed, default: null },
		phone: { type: String, required: true },
		hours: { type: [DayHoursSchema], default: [] },
		photoAssetIds: { type: [String], default: [] },
		displayOrder: { type: Number, default: 0 },
		active: { type: Boolean, default: false },
	},
	{ collection: 'storeLocations', timestamps: true, minimize: false },
);

/** The shop's list: active stores in display order. */
StoreLocationSchema.index({ active: 1, displayOrder: 1 });
/** Media reference counting. */
StoreLocationSchema.index({ photoAssetIds: 1 });

export const StoreLocationModel: Model<StoreLocationDoc> =
	(models.StoreLocation as Model<StoreLocationDoc>) ?? model<StoreLocationDoc>('StoreLocation', StoreLocationSchema);
