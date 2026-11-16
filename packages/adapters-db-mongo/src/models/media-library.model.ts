import { type Model, Schema, model, models } from 'mongoose';

/**
 * The Media page's own records (media build step 1): folders, stars, share links and the storage
 * reservations of running work. Files keep their Spaces address whatever happens to these.
 */
export interface MediaFolderDoc {
	_id: string;
	parentId: string | null;
	name: string;
	ancestors: string[];
	files: number;
	bytes: number;
	trashedAt: Date | null;
	trashedFrom: string | null;
	createdBy: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

const MediaFolderSchema = new Schema<MediaFolderDoc>(
	{
		_id: { type: String, required: true },
		parentId: { type: String, default: null },
		name: { type: String, required: true },
		ancestors: { type: [String], default: [] },
		files: { type: Number, default: 0 },
		bytes: { type: Number, default: 0 },
		trashedAt: { type: Date, default: null },
		trashedFrom: { type: String, default: null },
		createdBy: { type: String, default: null },
	},
	{ collection: 'mediaFolders', timestamps: true },
);
MediaFolderSchema.index({ parentId: 1, trashedAt: 1, name: 1 });
MediaFolderSchema.index({ ancestors: 1 });

export const MediaFolderModel: Model<MediaFolderDoc> =
	(models.MediaFolder as Model<MediaFolderDoc>) ?? model<MediaFolderDoc>('MediaFolder', MediaFolderSchema);

/** One admin's star on a folder or a file; `_id` is `<user>:<type>:<target>`. */
export interface MediaFavouriteDoc {
	_id: string;
	userId: string;
	targetType: string;
	targetId: string;
	createdAt?: Date;
}

const MediaFavouriteSchema = new Schema<MediaFavouriteDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, required: true },
		targetType: { type: String, enum: ['folder', 'file'], required: true },
		targetId: { type: String, required: true },
	},
	{ collection: 'mediaFavourites', timestamps: { createdAt: true, updatedAt: false } },
);
MediaFavouriteSchema.index({ userId: 1, createdAt: -1 });
MediaFavouriteSchema.index({ targetType: 1, targetId: 1 });

export const MediaFavouriteModel: Model<MediaFavouriteDoc> =
	(models.MediaFavourite as Model<MediaFavouriteDoc>) ??
	model<MediaFavouriteDoc>('MediaFavourite', MediaFavouriteSchema);

/** A share link (R4-5). Only the code's hash is stored. */
export interface MediaShareLinkDoc {
	_id: string;
	assetId: string;
	codeHash: string;
	codeEnd: string;
	who: string;
	expiresAt: Date | null;
	passwordHash: string | null;
	stoppedAt: Date | null;
	stoppedBecause: string | null;
	opens: number;
	lastOpenedAt: Date | null;
	createdBy: string;
	createdAt?: Date;
}

const MediaShareLinkSchema = new Schema<MediaShareLinkDoc>(
	{
		_id: { type: String, required: true },
		assetId: { type: String, required: true },
		codeHash: { type: String, required: true },
		codeEnd: { type: String, required: true },
		who: { type: String, enum: ['anyone', 'admins'], required: true },
		expiresAt: { type: Date, default: null },
		passwordHash: { type: String, default: null, select: false },
		stoppedAt: { type: Date, default: null },
		stoppedBecause: { type: String, enum: ['stopped', 'trash', null], default: null },
		opens: { type: Number, default: 0 },
		lastOpenedAt: { type: Date, default: null },
		createdBy: { type: String, required: true },
	},
	{ collection: 'mediaShareLinks', timestamps: { createdAt: true, updatedAt: false } },
);
MediaShareLinkSchema.index({ codeHash: 1 }, { unique: true });
MediaShareLinkSchema.index({ assetId: 1, createdAt: -1 });

export const MediaShareLinkModel: Model<MediaShareLinkDoc> =
	(models.MediaShareLink as Model<MediaShareLinkDoc>) ??
	model<MediaShareLinkDoc>('MediaShareLink', MediaShareLinkSchema);

/** Bytes held for running work, so two uploads at once cannot both pass the plan (R4-7). */
export interface StorageReservationDoc {
	_id: string;
	userId: string;
	bytes: number;
	expiresAt: Date;
}

const StorageReservationSchema = new Schema<StorageReservationDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, required: true },
		bytes: { type: Number, required: true },
		expiresAt: { type: Date, required: true },
	},
	{ collection: 'storageReservations', timestamps: false },
);
/** Mongo removes a reservation by itself once it expires. */
StorageReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const StorageReservationModel: Model<StorageReservationDoc> =
	(models.StorageReservation as Model<StorageReservationDoc>) ??
	model<StorageReservationDoc>('StorageReservation', StorageReservationSchema);

/**
 * Email pictures that left their photo (deleted for good or replaced), kept for good so order emails already sent
 * keep their pictures (Media brief R4-3, R6-1). Clean up › Email pictures lists them; only an admin deletes them.
 */
export interface EmailPictureDoc {
	_id: string;
	assetId: string;
	photoName: string;
	width: number;
	bytes: number;
	why: 'deleted' | 'replaced';
	goneAt: Date;
	goneBy: string | null;
	sentCount: number;
	lastSentAt: Date | null;
}

const EmailPictureSchema = new Schema<EmailPictureDoc>(
	{
		_id: { type: String, required: true },
		assetId: { type: String, required: true },
		photoName: { type: String, required: true },
		width: { type: Number, required: true },
		bytes: { type: Number, required: true },
		why: { type: String, enum: ['deleted', 'replaced'], required: true },
		goneAt: { type: Date, required: true },
		goneBy: { type: String, default: null },
		sentCount: { type: Number, default: 0 },
		lastSentAt: { type: Date, default: null },
	},
	{ collection: 'emailPictures', timestamps: false },
);
EmailPictureSchema.index({ lastSentAt: 1 });

export const EmailPictureModel: Model<EmailPictureDoc> =
	(models.EmailPicture as Model<EmailPictureDoc>) ?? model<EmailPictureDoc>('EmailPicture', EmailPictureSchema);
