import { z } from 'zod';

import { IsoDateTime } from './common';

/**
 * Exchange rates, the PayPal markup and gateway routing (shipping rules brief fx01–fx03, pay01;
 * owner decisions 2026-11-17 FX6 and 2026-11-19 DEC-PAYPAL-FX).
 *
 * - Prices are always rupees. A shopper paying in another currency sees the price converted at the
 *   active rate with one PayPal markup (6%) on the whole payment, shipping included.
 * - One rate source at a time: PayPal's own rates (FXaaS, once PayPal approves the account; any
 *   failure falls back to the stored rates at once) or the stored rates. Stored rates are typed by
 *   staff and, when the switch is on, refreshed by a daily fetch. Rates never learn from payments.
 * - The currency decides the gateway: ₹ goes to the one active INR gateway; every other currency
 *   goes to PayPal. Shoppers never see a gateway name. Keys live in server settings only.
 */

/** FX6 (owner, 2026-11-17): the currencies offered at launch besides rupees. */
export const LAUNCH_CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'SGD', 'NZD'] as const;
/** How the admin and shop write each launch currency (US$, not a bare $). */
export const LAUNCH_CURRENCY_SYMBOLS: Readonly<Record<(typeof LAUNCH_CURRENCIES)[number], string>> = {
	USD: 'US$',
	GBP: '£',
	EUR: '€',
	CAD: 'C$',
	AUD: 'A$',
	SGD: 'S$',
	NZD: 'NZ$',
};

export const FxRateSource = z.enum(['stored', 'paypalFxaas']);
export type FxRateSource = z.infer<typeof FxRateSource>;

/** `HH:MM`, 24-hour, India time. */
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const FxSettings = z.object({
	source: FxRateSource.default('stored'),
	paypalFxaas: z
		.object({
			/** PayPal approves FXaaS per account; until then its rates can't be chosen. */
			approved: z.boolean().default(false),
			/** Set while PayPal's rates are failing; the stored rates are used meanwhile (brief fx03). */
			unavailableSince: IsoDateTime.nullable().default(null),
			lastQuoteAt: IsoDateTime.nullable().default(null),
		})
		.default({ approved: false, unavailableSince: null, lastQuoteAt: null }),
	/** One markup for every currency, on the whole PayPal payment; only a super admin changes it. */
	paypalMarkupPercent: z.number().finite().min(0).max(30).default(6),
	dailyFetch: z
		.object({
			enabled: z.boolean().default(true),
			/** India time the stored rates are refreshed. */
			time: ClockTime.default('12:30'),
			lastRunAt: IsoDateTime.nullable().default(null),
			/** The last fetch's problem in plain words; null when it worked. */
			lastError: z.string().max(300).nullable().default(null),
		})
		.default({ enabled: true, time: '12:30', lastRunAt: null, lastError: null }),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.optional(),
	updatedBy: z.string().nullable().default(null),
});
export type FxSettings = z.infer<typeof FxSettings>;

export const FxSettingsWrite = z.object({
	source: FxRateSource,
	paypalMarkupPercent: z.number().finite().min(0).max(30),
	dailyFetch: z.object({ enabled: z.boolean(), time: ClockTime }),
	revision: z.number().int().nonnegative(),
});
export type FxSettingsWrite = z.infer<typeof FxSettingsWrite>;

/** One row of Admin › Currencies (brief fx01). */
export const AdminCurrencyRow = z.object({
	code: z.string().length(3),
	symbol: z.string().min(1),
	/** False for a launch currency with no stored row yet (no rate ever set). */
	stored: z.boolean(),
	enabled: z.boolean(),
	/** Rupees per one unit of the currency, as staff type it; null when there is no rate. */
	inrPerUnit: z.number().positive().nullable(),
	setBy: z.enum(['fetch', 'staff']).nullable(),
	/** The name of whoever typed it; null for the daily fetch. */
	setByName: z.string().nullable(),
	setAt: IsoDateTime.nullable(),
	/** What a ₹10,000 piece costs in this currency with the markup; null without a rate. */
	examplePrice: z.number().nonnegative().nullable(),
});
export type AdminCurrencyRow = z.infer<typeof AdminCurrencyRow>;

export const AdminFxOverview = z.object({
	settings: FxSettings,
	currencies: z.array(AdminCurrencyRow),
	/** Only a super admin may change the markup (brief fx02). */
	canEditMarkup: z.boolean(),
	/** The rupee amount the example column prices (₹10,000). */
	exampleINR: z.number().positive(),
	/** Whether an ExchangeRate-API key is set on the server; the free open tier needs none. */
	fetchUsesKey: z.boolean(),
});
export type AdminFxOverview = z.infer<typeof AdminFxOverview>;

/** Typing a rate (₹ per unit) or switching a currency on or off. */
export const CurrencyRateWrite = z.object({
	inrPerUnit: z.number().finite().positive().max(1_000_000).optional(),
	enabled: z.boolean().optional(),
});
export type CurrencyRateWrite = z.infer<typeof CurrencyRateWrite>;

export const FxFetchResult = z.object({
	ok: z.boolean(),
	updated: z.array(z.string()),
	/** The problem in plain words when the fetch failed; the stored rates stay in use. */
	problem: z.string().nullable(),
	at: IsoDateTime,
});
export type FxFetchResult = z.infer<typeof FxFetchResult>;

/* ---------------------------------------------------------------------------------------------- */
/* Gateway routing (brief pay01)                                                                  */
/* ---------------------------------------------------------------------------------------------- */

export const InrGatewayId = z.enum(['ccavenue', 'razorpay']);
export type InrGatewayId = z.infer<typeof InrGatewayId>;
export const PaymentGatewayId = z.enum(['ccavenue', 'razorpay', 'paypal']);
export type PaymentGatewayId = z.infer<typeof PaymentGatewayId>;

export const PaymentRoutingSettings = z.object({
	/** The one INR gateway taking new payments; null when none is switched on. */
	activeInrGateway: InrGatewayId.nullable().default('ccavenue'),
	/** Whether PayPal takes new payments in every currency other than rupees. */
	paypalTakesNewPayments: z.boolean().default(true),
	testMode: z
		.object({ ccavenue: z.boolean(), razorpay: z.boolean(), paypal: z.boolean() })
		.default({ ccavenue: false, razorpay: false, paypal: false }),
	popups: z
		.object({
			/** "Choose your currency" when a PayPal payment fails or comes back unpaid. */
			paypalChooseCurrency: z.boolean(),
			/** "Switch to your region's currency" when the INR gateway refuses a card from abroad. */
			inrCardRefused: z.boolean(),
		})
		.default({ paypalChooseCurrency: true, inrCardRefused: true }),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.optional(),
	updatedBy: z.string().nullable().default(null),
});
export type PaymentRoutingSettings = z.infer<typeof PaymentRoutingSettings>;

export const PaymentRoutingWrite = PaymentRoutingSettings.omit({ updatedAt: true, updatedBy: true });
export type PaymentRoutingWrite = z.infer<typeof PaymentRoutingWrite>;

export const AdminPaymentRouting = z.object({
	settings: PaymentRoutingSettings,
	/** Whether each gateway's keys are set on the server; the values are never sent. */
	keysOnServer: z.object({ ccavenue: z.boolean(), razorpay: z.boolean(), paypal: z.boolean() }),
	/** Whether each gateway's adapter is built (Razorpay is ready but waits for HDFC's kit). */
	built: z.object({ ccavenue: z.boolean(), razorpay: z.boolean(), paypal: z.boolean() }),
});
export type AdminPaymentRouting = z.infer<typeof AdminPaymentRouting>;
