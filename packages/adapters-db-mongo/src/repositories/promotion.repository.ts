import type { Promotion } from '@saha-textile/contracts';
import type { PromotionRepository } from '@saha-textile/core-domain';

import { toPromotion } from '../mappers';
import { type PromotionDoc, PromotionModel } from '../models/index';

export class MongoPromotionRepository implements PromotionRepository {
	async findById(id: string): Promise<Promotion | null> {
		const doc = await PromotionModel.findById(id).lean<PromotionDoc>().exec();
		return doc ? toPromotion(doc) : null;
	}

	async findByCouponCode(code: string): Promise<Promotion | null> {
		const doc = await PromotionModel.findOne({ couponCode: code }).lean<PromotionDoc>().exec();
		return doc ? toPromotion(doc) : null;
	}

	async listActive(at?: string): Promise<Promotion[]> {
		const now = at ? new Date(at) : new Date();
		const docs = await PromotionModel.find({
			$and: [
				{ $or: [{ startsAt: { $lte: now } }, { startsAt: { $exists: false } }, { startsAt: null }] },
				{ $or: [{ endsAt: { $gte: now } }, { endsAt: { $exists: false } }, { endsAt: null }] },
			],
		})
			.sort({ priority: -1 })
			.lean<PromotionDoc[]>()
			.exec();
		return docs.map(toPromotion);
	}

	async save(promotion: Promotion): Promise<Promotion> {
		const { id, startsAt, endsAt, ...rest } = promotion;
		const doc = await PromotionModel.findByIdAndUpdate(
			id,
			{
				$set: {
					...rest,
					startsAt: startsAt ? new Date(startsAt) : undefined,
					endsAt: endsAt ? new Date(endsAt) : undefined,
				},
			},
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<PromotionDoc>()
			.exec();
		return toPromotion(doc as PromotionDoc);
	}
}
