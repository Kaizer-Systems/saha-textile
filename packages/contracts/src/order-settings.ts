import { z } from 'zod';

import { IsoDateTime } from './common';

/**
 * Named order settings (brief § "Named settings, so other businesses aren't disturbed"). A shop
 * with export, PayPal or business accounts switched off sees none of those steps, blocks or
 * columns. Saha Textile's choices are the defaults where the owner decided them.
 */
export const OrderSettings = z.object({
	/** Payment methods offered on the admin checkout; each on or off. */
	adminPaymentMethods: z
		.object({
			paymentLink: z.boolean(),
			upi: z.boolean(),
			bankTransfer: z.boolean(),
			cashOnDelivery: z.boolean(),
			onAccount: z.boolean(),
		})
		.default({ paymentLink: true, upi: true, bankTransfer: true, cashOnDelivery: true, onAccount: true }),
	/** Payments typed by staff: in the home currency only (K3), or in the order's currency. */
	manualPaymentCurrency: z.enum(['homeCurrencyOnly', 'orderCurrency']).default('homeCurrencyOnly'),
	/** Business accounts (credit, on account) on or off. */
	businessAccounts: z.boolean().default(true),
	/** How long a payment request and its link work. */
	paymentLinkDays: z.number().int().min(1).max(30).default(7),
	/** Pieces on admin orders: held from save until removed or cancelled (K7), or only while a request is open. */
	holdAdminOrderPieces: z.enum(['fromSave', 'whileRequestOpen']).default('fromSave'),
	/**
	 * Whether the INR gateway takes cards issued abroad (S5/S7, brief shop09). Off until HDFC confirms it
	 * for the account: a buyer billed abroad who picks ₹ is shown the currency picker with their own
	 * currency first.
	 */
	inrGatewayForeignCards: z.boolean().default(false),
	/** Warn before a foreign-currency request to a buyer billed in India (K2). */
	warnIndiaBillingForeignCurrency: z.boolean().default(true),
	/** Open orders built up over weeks; an optional reminder after N days. */
	openOrders: z
		.object({ enabled: z.boolean(), remindAfterDays: z.number().int().min(1).max(365).nullable() })
		.default({ enabled: true, remindAfterDays: null }),
	/** Import duty notice at checkout (OD10): off for Saha Textile (export off). */
	importDutyNotice: z.enum(['off', 'buyerPaysOnDelivery', 'wePay']).default('off'),
	/**
	 * E-invoice and e-way bill before Shipped (`DEC-EDOCS-GATE`, owner 2026-11-20: "Block when required").
	 * Shipped stays off, with the reason, until the IRN is in while `eInvoiceRequired` is on (business
	 * orders; the CA confirms the turnover test), and, for goods of `eWayBillThresholdINR` or more, the
	 * e-way bill number (shop orders included).
	 */
	eInvoiceRequired: z.boolean().default(true),
	eWayBillThresholdINR: z.number().int().nonnegative().default(50_000),
	/** "Out for delivery" shows only when a connected courier reports it. */
	outForDeliveryOnlyFromCourier: z.boolean().default(true),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: z.string().nullable().default(null),
});
export type OrderSettings = z.infer<typeof OrderSettings>;

export const OrderSettingsWrite = OrderSettings.omit({ updatedAt: true, updatedBy: true });
export type OrderSettingsWrite = z.infer<typeof OrderSettingsWrite>;
