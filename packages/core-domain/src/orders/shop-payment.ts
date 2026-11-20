import { firstCurrencyFor } from './payment-policies';

/**
 * Rules for paying at the shop checkout (OD1 `DEC-STOCK-RESERVE`, owner 2026-11-17; shipping brief
 * shop04/shop05, approved 2026-11-19). Pure: the API applies them.
 */

/** OD1: the pieces are held from Pay for 15 minutes. */
export const SHOP_HOLD_MINUTES = 15;

export function holdUntilFrom(now: Date, minutes = SHOP_HOLD_MINUTES): string {
	return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** True while the hold set at Pay still runs. */
export function holdIsLive(holdUntil: string | null | undefined, now: Date): boolean {
	return !!holdUntil && new Date(holdUntil).getTime() > now.getTime();
}

/**
 * The attempt's id, sent to the gateway as its order id: the order number's text form and the
 * attempt's count (`ST2611482190-2`). CCAvenue takes up to 30 letters, digits and hyphens.
 */
export function attemptIdFor(orderNumber: string, count: number): string {
	const key = orderNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
	const suffix = `-${count}`;
	return `${key.slice(0, 30 - suffix.length)}${suffix}`;
}

/** Minutes after the attempt started when the status enquiry runs while it stays pending. */
const CHECK_AT_MINUTES = [2, 5, 10, 15, 30, 60];
/** After the last step, hourly until two days have passed; then the attempt is left to staff. */
const HOURLY_UNTIL_MINUTES = 48 * 60;

/**
 * When to ask the gateway again about a pending attempt (`checks` enquiries done so far). HDFC says a
 * return can reach us 5–10 minutes late, and a late UPI approval can arrive after the tab is closed, so
 * the enquiry keeps going for two days, spaced out to stay inside the gateways' rate limits. Null: stop.
 */
export function nextAttemptCheck(createdAt: Date, checks: number): Date | null {
	const start = createdAt.getTime();
	const step = CHECK_AT_MINUTES[checks];
	if (step !== undefined) return new Date(start + step * 60_000);
	const last = CHECK_AT_MINUTES[CHECK_AT_MINUTES.length - 1] ?? 60;
	const minutes = last + (checks - CHECK_AT_MINUTES.length + 1) * 60;
	return minutes > HOURLY_UNTIL_MINUTES ? null : new Date(start + minutes * 60_000);
}

/**
 * Whether the INR gateway's reason says the card can't pay in rupees here (a card issued abroad while
 * the account doesn't take them). Matched loosely on the wording gateways use; refined against the
 * first UAT refusals. Anything else is an ordinary failure with the normal retry message.
 */
export function refusedAsForeignCard(reason: string | null | undefined): boolean {
	if (!reason) return false;
	return (
		/\b(international|foreign|overseas)\b.{0,40}\b(card|transaction|payment)s?\b/i.test(reason) ||
		/\bcards?\b.{0,40}\b(issued )?outside india\b/i.test(reason) ||
		/\b(card|bin)\b.{0,30}\bnot (allowed|enabled|permitted|supported)\b.{0,30}\b(country|region|merchant)\b/i.test(
			reason,
		)
	);
}

export interface PaymentPopupInput {
	gateway: 'ccavenue' | 'paypal';
	state: 'failed' | 'cancelled';
	failureReason: string | null;
	billingCountry: string;
	homeCountry: string;
	/** Currencies on sale in the shop. */
	enabled: readonly string[];
}

export interface PaymentPopup {
	popup: 'chooseCurrency' | 'switchToRegionCurrency' | null;
	firstCurrency: string | null;
}

/**
 * Which popup the shopper sees after an unfinished payment (shipping brief, approved 19 Nov):
 * - PayPal returned without a completed payment, for any reason (PayPal doesn't always say why):
 *   "Please choose your currency", with ₹ first for payers billed in India (shop04);
 * - the INR gateway refused a card and its reason says the card can't pay in rupees, for a buyer
 *   billed abroad: "Switch to your region's currency", their country's currency first (shop05);
 * - anything else: no popup, the normal retry message.
 */
export function paymentPopup(input: PaymentPopupInput): PaymentPopup {
	const billedHome = input.billingCountry.toUpperCase() === input.homeCountry.toUpperCase();
	if (input.gateway === 'paypal') {
		const first =
			billedHome && input.enabled.includes('INR') ? 'INR' : firstCurrencyFor(input.billingCountry, input.enabled);
		return { popup: 'chooseCurrency', firstCurrency: first };
	}
	if (input.state === 'failed' && !billedHome && refusedAsForeignCard(input.failureReason)) {
		return { popup: 'switchToRegionCurrency', firstCurrency: firstCurrencyFor(input.billingCountry, input.enabled) };
	}
	return { popup: null, firstCurrency: null };
}
