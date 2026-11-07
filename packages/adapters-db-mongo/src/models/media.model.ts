import {
	CatalogStatus,
	DerivativeFit,
	DerivativeFormat,
	MediaKind,
	MediaProcessingState,
	MediaPurpose,
	MediaVisibility,
} from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Reusable media asset (`mediaAssets`).
 *
 * Assets are referenced by owners, never embedded, so deleting an owner must not delete an
 * asset another owner still points at. `deletedAt` is a SOFT delete: orphans are collected
 * only after a 30-day grace (`DEC-DELETE-RETENTION`), which gives an accidental detachment a
 * window to be undone.
 */
export interface MediaAssetDoc {
	_id: string;
	kind: string;
	purpose: string;
	originalStorageKey: string | null;
	originalFormat: string;
	originalByteSize: number;
	width: number | null;
	height: number | null;
	slug: string;
	derivatives: unknown[];
	dominantColor: string | null;
	thumbHash: string | null;
	visibility: string;
	processing: { state: string; attempts: number; error: string | null; processedAt: Date | null };
	warnings: string[];
	servesAsPrimary: boolean;
	maxDisplayWidth: number | null;
	renditions: unknown[];
	hlsPlaylistKey: string | null;
	durationSeconds: number | null;
	text: { alt: Record<string, string>; title: Record<string, string>; caption: Record<string, string> };
	status: string;
	uploadedBy: { type: string; id: string } | null;
	deletedAt: Date | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const MediaAssetSchema = new Schema<MediaAssetDoc>(
	{
		_id: { type: String, required: true },
		kind: { type: String, enum: MediaKind.options, required: true },
		purpose: { type: String, enum: MediaPurpose.options, required: true, default: 'product' },
		originalStorageKey: { type: String, default: null },
		originalFormat: { type: String, required: true },
		originalByteSize: { type: Number, required: true },
		width: { type: Number, default: null },
		height: { type: Number, default: null },
		slug: { type: String, required: true },
		derivatives: { type: [Schema.Types.Mixed], default: [] },
		dominantColor: { type: String, default: null },
		thumbHash: { type: String, default: null },
		visibility: { type: String, enum: MediaVisibility.options, default: 'public' },
		processing: {
			state: { type: String, enum: MediaProcessingState.options, default: 'awaiting_upload' },
			attempts: { type: Number, default: 0 },
			error: { type: String, default: null },
			processedAt: { type: Date, default: null },
		},
		warnings: { type: [String], default: [] },
		servesAsPrimary: { type: Boolean, default: false },
		maxDisplayWidth: { type: Number, default: null },
		renditions: { type: [Schema.Types.Mixed], default: [] },
		hlsPlaylistKey: { type: String, default: null },
		durationSeconds: { type: Number, default: null },
		text: { type: Schema.Types.Mixed, default: { alt: {}, title: {}, caption: {} } },
		status: { type: String, enum: CatalogStatus.options, default: 'draft' },
		uploadedBy: { type: Schema.Types.Mixed, default: null },
		deletedAt: { type: Date, default: null },
	},
	{ collection: 'mediaAssets', timestamps: true },
);

/** Admin media library browsing. */
MediaAssetSchema.index({ kind: 1, purpose: 1, status: 1, createdAt: -1 });
/** The orphan-collection sweep: soft-deleted before a cutoff. */
MediaAssetSchema.index({ deletedAt: 1 });
/** GC pass 1 pages live assets by id under a creation cutoff. */
MediaAssetSchema.index({ deletedAt: 1, createdAt: 1, _id: 1 });
/** Reprocess after a ladder edit: assets holding a stale derivative of a role. */
MediaAssetSchema.index({ 'derivatives.role': 1, 'derivatives.roleVersion': 1 });
/** Library search over the SEO slug. */
MediaAssetSchema.index({ slug: 1 });
/** Storage keys must not be claimed twice; partial because a purged master is null. */
MediaAssetSchema.index(
	{ originalStorageKey: 1 },
	{ unique: true, partialFilterExpression: { originalStorageKey: { $type: 'string' } } },
);

export const MediaAssetModel: Model<MediaAssetDoc> =
	(models.MediaAsset as Model<MediaAssetDoc>) ?? model<MediaAssetDoc>('MediaAsset', MediaAssetSchema);

/** The editable size ladder (`mediaRoles`). Keyed by the role key itself. */
export interface MediaRoleDoc {
	_id: string;
	label: string;
	seeded: boolean;
	purposes: string[];
	widths: number[];
	aspect: { width: number; height: number } | null;
	fit: string;
	format: string;
	quality: number;
	primaryOnly: boolean;
	respectSlotMaxWidth: boolean;
	version: number;
	updatedAt?: Date;
}

const MediaRoleSchema = new Schema<MediaRoleDoc>(
	{
		_id: { type: String, required: true },
		label: { type: String, required: true },
		seeded: { type: Boolean, default: false },
		purposes: { type: [String], enum: MediaPurpose.options, required: true },
		widths: { type: [Number], required: true },
		aspect: { type: Schema.Types.Mixed, default: null },
		fit: { type: String, enum: DerivativeFit.options, required: true },
		format: { type: String, enum: DerivativeFormat.options, default: 'image/webp' },
		quality: { type: Number, default: 82 },
		primaryOnly: { type: Boolean, default: false },
		respectSlotMaxWidth: { type: Boolean, default: false },
		version: { type: Number, default: 1 },
	},
	{ collection: 'mediaRoles', timestamps: { createdAt: false, updatedAt: true } },
);

export const MediaRoleModel: Model<MediaRoleDoc> =
	(models.MediaRole as Model<MediaRoleDoc>) ?? model<MediaRoleDoc>('MediaRole', MediaRoleSchema);
