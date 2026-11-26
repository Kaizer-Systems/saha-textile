import { type Model, Schema, model, models } from 'mongoose';

/**
 * Data-migration ledger (`releaseMigrations`): one row per migration that has run on this
 * database, written by the release-steps runner. The id is the migration's own id, so a
 * migration can never be recorded twice. Machinery, not shop data.
 */
export interface ReleaseMigrationDoc {
	_id: string;
	description: string;
	half: 'expand' | 'contract';
	result: string;
	ranAt: Date;
	ms: number;
}

const ReleaseMigrationSchema = new Schema<ReleaseMigrationDoc>(
	{
		_id: { type: String, required: true },
		description: { type: String, required: true },
		half: { type: String, enum: ['expand', 'contract'], required: true },
		result: { type: String, default: '' },
		ranAt: { type: Date, required: true },
		ms: { type: Number, required: true },
	},
	{ collection: 'releaseMigrations', timestamps: false },
);

export const ReleaseMigrationModel: Model<ReleaseMigrationDoc> =
	(models.ReleaseMigration as Model<ReleaseMigrationDoc>) ??
	model<ReleaseMigrationDoc>('ReleaseMigration', ReleaseMigrationSchema);

/**
 * Small facts a release needs to remember in the database (`releaseMarkers`), such as the last
 * search version that was fully built. A release reads them when the search engine itself is
 * unreachable. Machinery, not shop data.
 */
export interface ReleaseMarkerDoc {
	_id: string;
	value: number;
	at: Date;
}

const ReleaseMarkerSchema = new Schema<ReleaseMarkerDoc>(
	{
		_id: { type: String, required: true },
		value: { type: Number, required: true },
		at: { type: Date, required: true },
	},
	{ collection: 'releaseMarkers', timestamps: false },
);

export const ReleaseMarkerModel: Model<ReleaseMarkerDoc> =
	(models.ReleaseMarker as Model<ReleaseMarkerDoc>) ?? model<ReleaseMarkerDoc>('ReleaseMarker', ReleaseMarkerSchema);
