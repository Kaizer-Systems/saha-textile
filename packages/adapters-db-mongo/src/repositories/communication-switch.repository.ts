import { CommunicationChannel, CommunicationSwitch } from '@saha-textile/contracts';
import type { CommunicationSwitchRepository } from '@saha-textile/core-domain';

import { CommunicationSwitchModel, type CommunicationSwitchDoc } from '../models/index';

const cellId = (use: string, channel: string): string => `${use}.${channel}`;

const toSwitch = (doc: CommunicationSwitchDoc): CommunicationSwitch => ({
	use: doc.use,
	channel: CommunicationChannel.parse(doc.channel),
	on: !!doc.on,
	updatedBy: doc.updatedBy ?? null,
	updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
});

export class MongoCommunicationSwitchRepository implements CommunicationSwitchRepository {
	async list(): Promise<CommunicationSwitch[]> {
		const docs = await CommunicationSwitchModel.find().lean<CommunicationSwitchDoc[]>().exec();
		return docs.map(toSwitch);
	}

	async find(use: string, channel: CommunicationChannel): Promise<CommunicationSwitch | null> {
		const doc = await CommunicationSwitchModel.findById(cellId(use, channel)).lean<CommunicationSwitchDoc>().exec();
		return doc ? toSwitch(doc) : null;
	}

	async save(entry: CommunicationSwitch): Promise<CommunicationSwitch> {
		const { use, channel, on, updatedBy } = CommunicationSwitch.parse(entry);
		await CommunicationSwitchModel.updateOne(
			{ _id: cellId(use, channel) },
			{ $set: { use, channel, on, updatedBy } },
			{ upsert: true },
		).exec();
		return (await this.find(use, channel)) as CommunicationSwitch;
	}
}
