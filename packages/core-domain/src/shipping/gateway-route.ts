/**
 * Which gateway takes a payment (owner, 2026-11-17 OD20 and 2026-11-19): the currency decides.
 * Rupees go to the one INR gateway the admin has made active; every other currency goes to the
 * foreign-currency gateway (PayPal). Shoppers never choose or see a gateway name.
 */

export interface GatewayRouting {
	/** The INR gateway taking new payments (`ccavenue`, `razorpay`, …); null when none is switched on. */
	activeInrGateway: string | null;
	/** The gateway for every other currency. */
	foreignGateway: string | null;
	/** The shop's own currency. */
	homeCurrency: string;
}

export type GatewayRoute = { gateway: string } | { problem: 'noInrGateway' | 'noForeignGateway' };

export function routePaymentGateway(currency: string, routing: GatewayRouting): GatewayRoute {
	const home = currency.trim().toUpperCase() === routing.homeCurrency.trim().toUpperCase();
	if (home) return routing.activeInrGateway ? { gateway: routing.activeInrGateway } : { problem: 'noInrGateway' };
	return routing.foreignGateway ? { gateway: routing.foreignGateway } : { problem: 'noForeignGateway' };
}

/**
 * A foreign-currency amount from rupees: converted at the active rate, plus the PayPal markup
 * (`DEC-PAYPAL-FX`: one flat percentage on the whole payment, shipping included; the fixed fee is
 * absorbed). Rounded to the cent here; the final rounding rule (FX3) is still the owner's.
 */
export function foreignAmountFromINR(amountINR: number, rateFromINR: number, markupPercent: number): number {
	if (!(rateFromINR > 0)) throw new RangeError('rateFromINR must be positive');
	if (!(markupPercent >= 0) || markupPercent >= 100) throw new RangeError('markupPercent must be in [0, 100)');
	if (amountINR < 0) throw new RangeError('amountINR must be non-negative');
	return Math.round((amountINR * rateFromINR * (1 + markupPercent / 100) + Number.EPSILON) * 100) / 100;
}
