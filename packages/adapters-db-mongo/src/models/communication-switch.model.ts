import { type Model, Schema, model, models } from 'mongoose';

/**
 * Settings › Communications (owner decision round 2026-11-13). One row per message × channel an
 * operator changed; `_id` is `<use>.<channel>`, so a cell can never hold two rows.
 */
export interface CommunicationSwitchDoc {
	_id: string;
	use: string;
	channel: string;
	on: boolean;
	updatedBy: string | null;
	updatedAt?: Date;
	createdAt?: Date;
}

const CommunicationSwitchSchema = new Schema<CommunicationSwitchDoc>(
	{
		_id: { type: String, required: true },
		use: { type: String, required: true },
		channel: { type: String, required: true, enum: ['email', 'sms', 'whatsapp'] },
		on: { type: Boolean, required: true },
		updatedBy: { type: String, default: null },
	},
	{ collection: 'communicationSwitches', timestamps: true },
);

export const CommunicationSwitchModel: Model<CommunicationSwitchDoc> =
	(models.CommunicationSwitch as Model<CommunicationSwitchDoc>) ??
	model<CommunicationSwitchDoc>('CommunicationSwitch', CommunicationSwitchSchema);
