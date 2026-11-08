import type { WishlistRepository } from '@saha-textile/core-domain';

import { WishlistItemModel } from '../models/index';

const rowId = (customerId: string, productId: string): string => `${customerId}:${productId}`;

/** `wishlistItems`: one row per customer and product. */
export class MongoWishlistRepository implements WishlistRepository {
	async listProductIds(customerId: string): Promise<string[]> {
		const rows = await WishlistItemModel.find({ customerId })
			.sort({ addedAt: -1, _id: 1 })
			.select('productId')
			.lean<Array<{ productId: string }>>()
			.exec();
		return rows.map((row) => row.productId);
	}

	async add(input: { customerId: string; productId: string; at: string }): Promise<void> {
		await WishlistItemModel.updateOne(
			{ _id: rowId(input.customerId, input.productId) },
			{ $setOnInsert: { customerId: input.customerId, productId: input.productId, addedAt: new Date(input.at) } },
			{ upsert: true },
		).exec();
	}

	async addMany(input: { customerId: string; productIds: readonly string[]; at: string }): Promise<void> {
		if (!input.productIds.length) return;
		// Older guest items first, a millisecond apart, so the list keeps the guest's order.
		const base = new Date(input.at).getTime() - input.productIds.length;
		await WishlistItemModel.bulkWrite(
			input.productIds.map((productId, index) => ({
				updateOne: {
					filter: { _id: rowId(input.customerId, productId) },
					update: {
						$setOnInsert: {
							customerId: input.customerId,
							productId,
							addedAt: new Date(base + (input.productIds.length - index)),
						},
					},
					upsert: true,
				},
			})),
			{ ordered: false },
		);
	}

	async remove(input: { customerId: string; productId: string }): Promise<void> {
		await WishlistItemModel.deleteOne({ _id: rowId(input.customerId, input.productId) }).exec();
	}

	async removeAllForCustomer(customerId: string): Promise<void> {
		await WishlistItemModel.deleteMany({ customerId }).exec();
	}
}
