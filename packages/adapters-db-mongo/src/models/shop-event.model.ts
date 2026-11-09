import { PopupImageSide, ShopEventStatus, ShopEventType } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Launch and sale events (owner log § launch and sale events, 2026-11-09).
 *
 * The setup blocks (`launch`, `sale`) and the after-the-fact records (`launchReport`,
 * `saleRecord`) are stored whole: they are read and written with the event, never queried
 * on their own. `popupAssetIds` lists the popup pictures; `popupAssetId` is the single picture
 * events had before 2026-11-10, read as the first of the list until the event is saved again.
 */
export interface ShopEventDoc {
	_id: string;
	type: string;
	name: string;
	title: Record<string, string>;
	message: Record<string, string>;
	startsAt: Date | null;
	endsAt: Date | null;
	linkHref: string | null;
	showCountdown: boolean;
	showPopup: boolean;
	popupAssetIds?: string[];
	/** Before 2026-11-10 an event had one picture. */
	popupAssetId?: string | null;
	popupImageSide?: string;
	nowLiveDays: number;
	launch: unknown;
	sale: unknown;
	status: string;
	publishedAt: Date | null;
	startedAt: Date | null;
	endedAt: Date | null;
	cancelledAt: Date | null;
	messageSentAt: Date | null;
	launchReport: unknown;
	saleRecord: unknown;
	/** SHA-256 of the admin's popup preview link, and when it stops working. Never sent out. */
	previewTokenHash?: string | null;
	previewExpiresAt?: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const ShopEventSchema = new Schema<ShopEventDoc>(
	{
		_id: { type: String, required: true },
		type: { type: String, enum: ShopEventType.options, required: true },
		name: { type: String, required: true },
		title: { type: Schema.Types.Mixed, default: {} },
		message: { type: Schema.Types.Mixed, default: {} },
		startsAt: { type: Date, default: null },
		endsAt: { type: Date, default: null },
		linkHref: { type: String, default: null },
		showCountdown: { type: Boolean, default: true },
		showPopup: { type: Boolean, default: true },
		popupAssetIds: { type: [String], default: [] },
		popupAssetId: { type: String, default: undefined },
		popupImageSide: { type: String, enum: PopupImageSide.options, default: 'right' },
		nowLiveDays: { type: Number, default: 3 },
		launch: { type: Schema.Types.Mixed, default: {} },
		sale: { type: Schema.Types.Mixed, default: {} },
		status: { type: String, enum: ShopEventStatus.options, default: 'draft' },
		publishedAt: { type: Date, default: null },
		startedAt: { type: Date, default: null },
		endedAt: { type: Date, default: null },
		cancelledAt: { type: Date, default: null },
		messageSentAt: { type: Date, default: null },
		launchReport: { type: Schema.Types.Mixed, default: null },
		saleRecord: { type: Schema.Types.Mixed, default: null },
		previewTokenHash: { type: String, default: null },
		previewExpiresAt: { type: Date, default: null },
	},
	{ collection: 'shopEvents', timestamps: true, minimize: false },
);

/** The clock, the shop and the sale prices read published events by state. */
ShopEventSchema.index({ status: 1, startsAt: 1 });
/** The shop reads a preview by its link's hash. */
ShopEventSchema.index({ previewTokenHash: 1 }, { sparse: true });
/** Media reference counting. */
ShopEventSchema.index({ popupAssetIds: 1 });

export const ShopEventModel: Model<ShopEventDoc> =
	(models.ShopEvent as Model<ShopEventDoc>) ?? model<ShopEventDoc>('ShopEvent', ShopEventSchema);
