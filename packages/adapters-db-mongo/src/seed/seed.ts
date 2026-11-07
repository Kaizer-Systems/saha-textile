import {
	MongoCategoryRepository,
	MongoCurrencyRepository,
	MongoCustomerRepository,
	MongoPromotionRepository,
} from '../repositories/index';
import { seedCategories, seedCurrencies, seedCustomers, seedPromotions } from './data';

export interface SeedResult {
	categories: number;
	currencies: number;
	promotions: number;
	customers: number;
}

/**
 * Idempotently upsert all seed data. Assumes a Mongo connection is already
 * established (see connectMongo). Safe to run repeatedly.
 */
export async function seedDatabase(): Promise<SeedResult> {
	const categories = new MongoCategoryRepository();
	const currencies = new MongoCurrencyRepository();
	const promotions = new MongoPromotionRepository();
	const customers = new MongoCustomerRepository();

	for (const category of seedCategories) await categories.save(category);
	for (const currency of seedCurrencies) await currencies.upsert(currency);
	for (const promotion of seedPromotions) await promotions.save(promotion);
	for (const customer of seedCustomers) await customers.save(customer);

	return {
		categories: seedCategories.length,
		currencies: seedCurrencies.length,
		promotions: seedPromotions.length,
		customers: seedCustomers.length,
	};
}
