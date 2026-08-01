import { type Model, Schema, model, models } from 'mongoose';

/**
 * Reusable media asset (`mediaAssets`).
 *
 * Assets are referenced by owners, never embedded, so deleting an owner must not delete an
 * asset another owner still points at. `deletedAt` is a SOFT delete: orphans are collected
 * only after a grace period (`DEC-DELETE-RETENTION`), which gives an accidental
 * detachment a window to be undone.
 */
export interface MediaAssetDoc {
	_id: string;
	kind: string;
	originalStorageKey: string | null;
	originalFormat: string;
	originalByteSize: number;
	width: number | null;
	height: number | null;
	fullWebpStorageKey: string | null;
	derivatives: unknown[];
	renditions: unknown[];
	hlsPlaylistKey: string | null;
	durationSeconds: number | null;
	text: { alt: Record<string, string>; title: Record<string, string>; caption: Record<string, string> };
	status: string;
	deletedAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const MediaAssetSchema = new Schema<MediaAssetDoc>(
	{
		_id: { type: String, required: true },
		kind: { type: String, enum: ['image', 'video'], required: true },
		originalStorageKey: { type: String, default: null },
		originalFormat: { type: String, required: true },
		originalByteSize: { type: Number, required: true },
		width: { type: Number, default: null },
		height: { type: Number, default: null },
		fullWebpStorageKey: { type: String, default: null },
		derivatives: { type: [Schema.Types.Mixed], default: [] },
		renditions: { type: [Schema.Types.Mixed], default: [] },
		hlsPlaylistKey: { type: String, default: null },
		durationSeconds: { type: Number, default: null },
		text: { type: Schema.Types.Mixed, default: { alt: {}, title: {}, caption: {} } },
		status: { type: String, enum: ['draft', 'live', 'disabled', 'discontinued'], default: 'draft' },
		deletedAt: { type: Date, default: null },
	},
	{ timestamps: true },
);

/** Admin media library browsing. */
MediaAssetSchema.index({ kind: 1, status: 1, createdAt: -1 });
/** The orphan-collection sweep: soft-deleted before a cutoff. */
MediaAssetSchema.index({ deletedAt: 1 });
/** Storage keys must not be claimed twice; partial because a purged master is null. */
MediaAssetSchema.index(
	{ originalStorageKey: 1 },
	{ unique: true, partialFilterExpression: { originalStorageKey: { $type: 'string' } } },
);

export const MediaAssetModel: Model<MediaAssetDoc> =
	(models.MediaAsset as Model<MediaAssetDoc>) ?? model<MediaAssetDoc>('MediaAsset', MediaAssetSchema);
