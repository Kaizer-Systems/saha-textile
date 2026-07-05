import type { ShippingQuote } from '@saha-textile/contracts';

export interface ShippingQuoteRequest {
	destinationCountry: string;
	destinationPincode?: string;
	weightGrams: number;
	declaredValueINR: number;
}

/** Shipping rate provider port (implemented by the Shiprocket adapter). */
export interface ShippingPort {
	getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuote[]>;
}
