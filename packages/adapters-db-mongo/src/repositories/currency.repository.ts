import type { Currency } from '@saha-textile/contracts';
import type { CurrencyRepository } from '@saha-textile/core-domain';

import { toCurrency } from '../mappers';
import { type CurrencyDoc, CurrencyModel } from '../models/index';

export class MongoCurrencyRepository implements CurrencyRepository {
	async findByCode(code: string): Promise<Currency | null> {
		const doc = await CurrencyModel.findById(code).lean<CurrencyDoc>().exec();
		return doc ? toCurrency(doc) : null;
	}

	async listEnabled(): Promise<Currency[]> {
		const docs = await CurrencyModel.find({ enabled: true }).lean<CurrencyDoc[]>().exec();
		return docs.map(toCurrency);
	}

	async listAll(): Promise<Currency[]> {
		const docs = await CurrencyModel.find().lean<CurrencyDoc[]>().exec();
		return docs.map(toCurrency);
	}

	async upsert(currency: Currency): Promise<Currency> {
		const { code, ...rest } = currency;
		const doc = await CurrencyModel.findByIdAndUpdate(
			code,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<CurrencyDoc>()
			.exec();
		return toCurrency(doc as CurrencyDoc);
	}
}
