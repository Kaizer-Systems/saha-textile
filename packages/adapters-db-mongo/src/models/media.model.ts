import {
	CatalogStatus,
	DerivativeFit,
	DerivativeFormat,
	MediaCategory,
	MediaFill,
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
	/** Absent on assets stored before image profiles (media step 2); the release migration names them. */
	versions?: unknown[];
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
	/** The Media page (step 1): folder, name, content hash, Trash, and the category it is listed under. */
	folderId?: string | null;
	displayName?: string | null;
	sha256?: string | null;
	trashedAt?: Date | null;
	trashedFrom?: string | null;
	category?: string;
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
		versions: { type: [Schema.Types.Mixed], default: [] },
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
		folderId: { type: String, default: null },
		displayName: { type: String, default: null },
		sha256: { type: String, default: null },
		trashedAt: { type: Date, default: null },
		trashedFrom: { type: String, default: null },
		category: { type: String, enum: MediaCategory.options, default: 'images' },
	},
	{ collection: 'mediaAssets', timestamps: true },
);

/** The Media page: a folder's files, in or out of Trash, by name or date. */
MediaAssetSchema.index({ folderId: 1, trashedAt: 1, displayName: 1 });
MediaAssetSchema.index({ trashedAt: 1, category: 1, createdAt: -1 });
/** The duplicate check (S6): the same bytes already in Media. */
MediaAssetSchema.index({ sha256: 1 }, { partialFilterExpression: { sha256: { $type: 'string' } } });

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
/** Pickers list photos holding a version of the profile a slot needs (R4-2); F01 counts them. */
MediaAssetSchema.index({ 'versions.profileKey': 1, 'versions.state': 1 });
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
	/** Absent on roles stored before the link-preview logo strip; reads as false. */
	brandStrip?: boolean;
	/** Absent on roles stored before the padded-card margin; reads as 0. */
	inset?: number;
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
		brandStrip: { type: Boolean, default: false },
		inset: { type: Number, default: 0 },
		version: { type: Number, default: 1 },
	},
	{ collection: 'mediaRoles', timestamps: { createdAt: false, updatedAt: true } },
);

export const MediaRoleModel: Model<MediaRoleDoc> =
	(models.MediaRole as Model<MediaRoleDoc>) ?? model<MediaRoleDoc>('MediaRole', MediaRoleSchema);

/** Image profiles (`mediaProfiles`, Settings › Image profiles). Keyed by the profile key itself. */
export interface MediaProfileDoc {
	_id: string;
	name: string;
	builtIn: boolean;
	shape: { width: number; height: number } | null;
	roles: string[];
	/** Absent on profiles stored before Settings › Image profiles (release migration 0002 adds them). */
	widths?: Record<string, number[]>;
	quality?: number | null;
	fills: string[];
	minSize: { edge: string; px: number; mode: string } | null;
	maxBytes: number;
	accepts: string[];
	mainPhotoOnly: boolean;
	enabled: boolean;
	version: number;
	updatedAt?: Date;
}

const MediaProfileSchema = new Schema<MediaProfileDoc>(
	{
		_id: { type: String, required: true },
		name: { type: String, required: true },
		builtIn: { type: Boolean, default: false },
		shape: { type: Schema.Types.Mixed, default: null },
		roles: { type: [String], required: true },
		widths: { type: Schema.Types.Mixed, default: {} },
		quality: { type: Number, default: null },
		fills: { type: [String], enum: MediaFill.options, default: [] },
		minSize: { type: Schema.Types.Mixed, default: null },
		maxBytes: { type: Number, required: true },
		accepts: { type: [String], required: true },
		mainPhotoOnly: { type: Boolean, default: false },
		enabled: { type: Boolean, default: true },
		version: { type: Number, default: 1 },
	},
	{ collection: 'mediaProfiles', timestamps: { createdAt: false, updatedAt: true } },
);

export const MediaProfileModel: Model<MediaProfileDoc> =
	(models.MediaProfile as Model<MediaProfileDoc>) ?? model<MediaProfileDoc>('MediaProfile', MediaProfileSchema);
