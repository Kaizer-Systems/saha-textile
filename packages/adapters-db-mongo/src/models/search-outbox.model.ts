import { type Model, Schema, model, models } from 'mongoose';

/**
 * Search change queue (`searchOutbox`): one row per product whose search entry must be
 * refreshed. A save writes it; the API or the worker sends it to search and marks it done.
 * Done rows stay 14 days so a newly built index can replay recent changes. Machinery, not
 * shop data.
 */
export interface SearchOutboxDoc {
	_id: string;
	changedAt: Date;
	attempts: number;
	nextAttemptAt: Date;
	lastError: string | null;
	doneAt: Date | null;
}

const SearchOutboxSchema = new Schema<SearchOutboxDoc>(
	{
		_id: { type: String, required: true },
		changedAt: { type: Date, required: true },
		attempts: { type: Number, default: 0 },
		nextAttemptAt: { type: Date, required: true },
		lastError: { type: String, default: null },
		doneAt: { type: Date, default: null },
	},
	{ collection: 'searchOutbox', timestamps: false },
);

/** The worker's question: waiting rows that are due. */
SearchOutboxSchema.index({ doneAt: 1, nextAttemptAt: 1 });
/** A new index replays every change since its build started. */
SearchOutboxSchema.index({ changedAt: 1 });
/** Done rows leave after 14 days; waiting rows (doneAt null) never expire. */
SearchOutboxSchema.index({ doneAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60, name: 'doneAt_ttl' });

export const SearchOutboxModel: Model<SearchOutboxDoc> =
	(models.SearchOutbox as Model<SearchOutboxDoc>) ?? model<SearchOutboxDoc>('SearchOutbox', SearchOutboxSchema);

/** One run of the nightly search check (`searchChecks`), kept 90 days for the health report. */
export interface SearchCheckDoc {
	_id: string;
	checkedAt: Date;
	live: number;
	indexed: number;
	missing: number;
	extra: number;
	recent: number;
	requested: number;
}

const SearchCheckSchema = new Schema<SearchCheckDoc>(
	{
		_id: { type: String, required: true },
		checkedAt: { type: Date, required: true },
		live: { type: Number, required: true },
		indexed: { type: Number, required: true },
		missing: { type: Number, required: true },
		extra: { type: Number, required: true },
		recent: { type: Number, required: true },
		requested: { type: Number, required: true },
	},
	{ collection: 'searchChecks', timestamps: false },
);

SearchCheckSchema.index({ checkedAt: -1 });
SearchCheckSchema.index({ checkedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'checkedAt_ttl' });

export const SearchCheckModel: Model<SearchCheckDoc> =
	(models.SearchCheck as Model<SearchCheckDoc>) ?? model<SearchCheckDoc>('SearchCheck', SearchCheckSchema);
