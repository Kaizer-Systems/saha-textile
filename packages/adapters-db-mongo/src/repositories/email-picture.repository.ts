import type { EmailPicture, EmailPictureSent } from '@saha-textile/contracts';
import { type EmailPictureRepository, emailPictureCutoff } from '@saha-textile/core-domain';

import { EmailPictureModel, type EmailPictureDoc } from '../models/index';

const toPicture = (doc: EmailPictureDoc): EmailPicture => ({
	key: doc._id,
	assetId: doc.assetId,
	photoName: doc.photoName,
	width: doc.width,
	bytes: doc.bytes,
	why: doc.why,
	goneAt: new Date(doc.goneAt).toISOString(),
	goneBy: doc.goneBy ?? null,
	sentCount: doc.sentCount ?? 0,
	lastSentAt: doc.lastSentAt ? new Date(doc.lastSentAt).toISOString() : null,
});

/** Which pictures a filter matches: never sent, or last sent before a cut-off. */
const sentFilter = (sent: EmailPictureSent, now: Date) => {
	if (sent === 'all') return {};
	if (sent === 'never') return { lastSentAt: null };
	return { lastSentAt: { $ne: null, $lt: new Date(emailPictureCutoff(sent, now)) } };
};

/** Email pictures kept for Clean up (Media brief R6-1, A50, A51). */
export class MongoEmailPictureRepository implements EmailPictureRepository {
	async keep(rows: readonly EmailPicture[]): Promise<void> {
		if (!rows.length) return;
		await EmailPictureModel.bulkWrite(
			rows.map((row) => ({
				updateOne: {
					filter: { _id: row.key },
					update: {
						$setOnInsert: {
							assetId: row.assetId,
							photoName: row.photoName,
							width: row.width,
							bytes: row.bytes,
							why: row.why,
							goneAt: new Date(row.goneAt),
							goneBy: row.goneBy,
							sentCount: row.sentCount,
							lastSentAt: row.lastSentAt ? new Date(row.lastSentAt) : null,
						},
					},
					upsert: true,
				},
			})),
			{ ordered: false },
		);
	}

	async list(input: {
		sent: EmailPictureSent;
		now: Date;
		after: string | null;
		limit: number;
	}): Promise<EmailPicture[]> {
		const docs = await EmailPictureModel.find({
			...sentFilter(input.sent, input.now),
			...(input.after ? { _id: { $gt: input.after } } : {}),
		})
			.sort({ _id: 1 })
			.limit(input.limit)
			.lean<EmailPictureDoc[]>()
			.exec();
		return docs.map(toPicture);
	}

	count(input: { sent: EmailPictureSent; now: Date }): Promise<number> {
		return EmailPictureModel.countDocuments(sentFilter(input.sent, input.now)).exec();
	}

	async totals(): Promise<{ count: number; bytes: number }> {
		const [row] = await EmailPictureModel.aggregate<{ count: number; bytes: number }>([
			{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$bytes' } } },
		]).exec();
		return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
	}

	async findByKeys(keys: readonly string[]): Promise<EmailPicture[]> {
		const docs = await EmailPictureModel.find({ _id: { $in: [...keys] } })
			.lean<EmailPictureDoc[]>()
			.exec();
		return docs.map(toPicture);
	}

	async remove(keys: readonly string[]): Promise<void> {
		await EmailPictureModel.deleteMany({ _id: { $in: [...keys] } }).exec();
	}
}
