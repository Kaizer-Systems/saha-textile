/** Foreign-exchange rate provider port (implemented by the ExchangeRate adapter). */
export interface FxRatePort {
	getRateFromINR(currencyCode: string): Promise<number>;
	getAllRatesFromINR(): Promise<Record<string, number>>;
}
