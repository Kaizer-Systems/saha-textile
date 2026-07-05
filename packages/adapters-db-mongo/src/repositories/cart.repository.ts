import type { Cart } from '@saha-textile/contracts';
import type { CartRepository } from '@saha-textile/core-domain';

import { toCart } from '../mappers';
import { type CartDoc, CartModel } from '../models/index';

export class MongoCartRepository implements CartRepository {
	async findById(id: string): Promise<Cart | null> {
		const doc = await CartModel.findById(id).lean<CartDoc>().exec();
		return doc ? toCart(doc) : null;
	}

	async findByUserId(userId: string): Promise<Cart | null> {
		const doc = await CartModel.findOne({ userId }).lean<CartDoc>().exec();
		return doc ? toCart(doc) : null;
	}

	async findByGuestToken(guestToken: string): Promise<Cart | null> {
		const doc = await CartModel.findOne({ guestToken }).lean<CartDoc>().exec();
		return doc ? toCart(doc) : null;
	}

	async save(cart: Cart): Promise<Cart> {
		const { id, ...rest } = cart;
		const doc = await CartModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<CartDoc>()
			.exec();
		return toCart(doc as CartDoc);
	}

	async deleteById(id: string): Promise<void> {
		await CartModel.deleteOne({ _id: id }).exec();
	}
}
