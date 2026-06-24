import type { User } from '@saha/contracts';
import type { UserCredential, UserRepository } from '@saha/core-domain';

import { toUser } from '../mappers';
import { type UserDoc, UserModel } from '../models/index';

export class MongoUserRepository implements UserRepository {
	async findById(id: string): Promise<User | null> {
		const doc = await UserModel.findById(id).lean<UserDoc>().exec();
		return doc ? toUser(doc) : null;
	}

	async findByEmail(email: string): Promise<User | null> {
		const doc = await UserModel.findOne({ email }).lean<UserDoc>().exec();
		return doc ? toUser(doc) : null;
	}

	async findCredentialByEmail(email: string): Promise<UserCredential | null> {
		const doc = await UserModel.findOne({ email }).select('+passwordHash').lean<UserDoc>().exec();
		if (!doc) return null;
		return { user: toUser(doc), passwordHash: doc.passwordHash ?? null };
	}

	async save(user: User): Promise<User> {
		const { id, ...rest } = user;
		// Note: `rest` never contains passwordHash (not part of the public contract),
		// so $set leaves the stored hash untouched.
		const doc = await UserModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<UserDoc>()
			.exec();
		return toUser(doc as UserDoc);
	}

	async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
		await UserModel.updateOne({ _id: userId }, { $set: { passwordHash } }).exec();
	}
}
