import {
	MongoCategoryRepository,
	MongoCurrencyRepository,
	MongoProductRepository,
	MongoPromotionRepository,
} from '../repositories/index';
import { seedCategories, seedCurrencies, seedProducts, seedPromotions } from './data';

export interface SeedResult {
	categories: number;
	products: number;
	currencies: number;
	promotions: number;
}

/**
 * Idempotently upsert all seed data. Assumes a Mongo connection is already
 * established (see connectMongo). Safe to run repeatedly.
 */
export async function seedDatabase(): Promise<SeedResult> {
	const categories = new MongoCategoryRepository();
	const products = new MongoProductRepository();
	const currencies = new MongoCurrencyRepository();
	const promotions = new MongoPromotionRepository();

	for (const category of seedCategories) await categories.save(category);
	for (const product of seedProducts) await products.save(product);
	for (const currency of seedCurrencies) await currencies.upsert(currency);
	for (const promotion of seedPromotions) await promotions.save(promotion);

	return {
		categories: seedCategories.length,
		products: seedProducts.length,
		currencies: seedCurrencies.length,
		promotions: seedPromotions.length,
	};
}
