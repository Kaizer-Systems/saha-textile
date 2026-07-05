import type { Currency } from '@saha-textile/contracts';

export interface CurrencyRepository {
	findByCode(code: string): Promise<Currency | null>;
	listEnabled(): Promise<Currency[]>;
	listAll(): Promise<Currency[]>;
	upsert(currency: Currency): Promise<Currency>;
}
