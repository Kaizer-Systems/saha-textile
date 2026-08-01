import type { Cart } from '@saha-textile/contracts';
import type { CartRepository, TransactionContext } from '@saha-textile/core-domain';

import { toCart } from '../mappers';
import { type CartDoc, CartModel } from '../models/index';
import { sessionFrom } from '../transaction-manager';

export class MongoCartRepository implements CartRepository {
	async findById(id: string): Promise<Cart | null> {
		const doc = await CartModel.findById(id).lean<CartDoc>().exec();
		return doc ? toCart(doc) : null;
	}

	async findByUserId(userId: string): Promise<Cart | null> {
		const doc = await CartModel.findOne({ userId }).lean<CartDoc>().exec();
		return doc ? toCart(doc) : null;
	}

	async findByGuestToken(guestTokenHash: string): Promise<Cart | null> {
		const doc = await CartModel.findOne({ guestToken: guestTokenHash }).lean<CartDoc>().exec();
		return doc ? toCart(doc) : null;
	}

	async save(cart: Cart, context?: TransactionContext): Promise<Cart> {
		const { id, ...rest } = cart;
		const doc = await CartModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session: sessionFrom(context) },
		)
			.lean<CartDoc>()
			.exec();
		return toCart(doc as CartDoc);
	}

	async deleteById(id: string, context?: TransactionContext): Promise<void> {
		await CartModel.deleteOne({ _id: id }, { session: sessionFrom(context) }).exec();
	}
}
