import { ConsentSource } from '@saha-textile/contracts';
import { type Model, Schema, model, models } from 'mongoose';

/**
 * Consent history (`consentEvents`) — append-only; the latest event per subject is the
 * effective consent. A guest is identified by a HASHED guest-cookie id, so consent can be
 * recorded before an account exists and attributed once the guest signs up.
 */
export interface ConsentEventDoc {
	_id: string;
	userId: string | null;
	guestId: string | null;
	categories: Record<string, boolean>;
	policyVersion: string;
	source: string;
	ipHash: string | null;
	userAgentHash: string | null;
	createdAt: Date;
}

const ConsentEventSchema = new Schema<ConsentEventDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, default: null },
		guestId: { type: String, default: null },
		categories: { type: Schema.Types.Mixed, required: true },
		policyVersion: { type: String, required: true },
		source: { type: String, enum: ConsentSource.options, required: true },
		ipHash: { type: String, default: null },
		userAgentHash: { type: String, default: null },
	},
	{ collection: 'consentEvents', timestamps: { createdAt: true, updatedAt: false } },
);

/** "Latest event for this subject" is the only hot query. */
ConsentEventSchema.index({ userId: 1, createdAt: -1 });
ConsentEventSchema.index({ guestId: 1, createdAt: -1 });
/** No TTL: consent history is the evidence of what was agreed and when. */

export const ConsentEventModel: Model<ConsentEventDoc> =
	(models.ConsentEvent as Model<ConsentEventDoc>) ?? model<ConsentEventDoc>('ConsentEvent', ConsentEventSchema);
