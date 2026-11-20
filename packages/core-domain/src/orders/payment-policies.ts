import type { OrderBalance, PaymentRequestStatus } from '@saha-textile/contracts';

/**
 * Payment policies for admin orders (brief K1–K3, K7, K9, K10; ck01–ck08, oo03–oo07, pl01–pl05).
 */

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

/* ---------------------------------------------------------------------------------------------- */
/* Manual payments (K3)                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/** The amount Record payment opens with: what is due now, in rupees, without the PayPal markup. */
export function manualPaymentPrefill(balance: OrderBalance): number {
	return balance.dueINR;
}

/** What a typed amount does to the order: pays it up, leaves the rest due, or pays ahead. */
export function manualPaymentEffect(
	balance: OrderBalance,
	amountINR: number,
): { kind: 'paysUp' } | { kind: 'leavesDue'; dueINR: number } | { kind: 'paysAhead'; aheadINR: number } {
	const due = balance.dueINR;
	if (Math.abs(amountINR - due) < 0.005) return { kind: 'paysUp' };
	if (amountINR < due) return { kind: 'leavesDue', dueINR: round2(due - amountINR) };
	return { kind: 'paysAhead', aheadINR: round2(amountINR - due + balance.paidAheadINR) };
}

/* ---------------------------------------------------------------------------------------------- */
/* Payment requests (K1, K2, K10)                                                                  */
/* ---------------------------------------------------------------------------------------------- */

export type RequestRefusal = 'nothingDue' | 'moreThanDue' | 'noGateway' | 'noContact';

/** An online request is never for more than is due (oo07). */
export function checkRequestAmount(balance: OrderBalance, amountINR: number): RequestRefusal | null {
	if (balance.dueINR <= 0) return 'nothingDue';
	if (amountINR > balance.dueINR + 0.005) return 'moreThanDue';
	return null;
}

/** The request's expiry: now plus the link validity (Saha Textile: 7 days). */
export function requestExpiry(now: Date, validDays: number): string {
	return new Date(now.getTime() + validDays * 86_400_000).toISOString();
}

/** A request that is still usable now. */
export function isRequestActive(request: { status: PaymentRequestStatus; expiresAt: string }, now: Date): boolean {
	return request.status === 'active' && Date.parse(request.expiresAt) > now.getTime();
}

/**
 * The request our forwarding link leads to: the newest active request of the order. A replaced
 * request forwards to its replacement, so a link sent earlier still works after a part payment
 * changed the amount (K1).
 */
export function currentRequest<
	T extends {
		id: string;
		status: PaymentRequestStatus;
		expiresAt: string;
		createdAt: string;
		replacedBy: string | null;
	},
>(requests: readonly T[], linked: T, now: Date): T | null {
	let at: T | undefined = linked;
	const seen = new Set<string>();
	while (at && at.status === 'replaced' && at.replacedBy && !seen.has(at.id)) {
		seen.add(at.id);
		at = requests.find((request) => request.id === at?.replacedBy);
	}
	return at && isRequestActive(at, now) ? at : null;
}

/** Our SMS goes only to Indian mobile numbers (DLT); other numbers get the email only (pr01). */
export function canSendSms(mobile: { countryCallingCode: string; number: string } | null): boolean {
	return !!mobile && mobile.countryCallingCode === '91' && /^[6-9]\d{9}$/.test(mobile.number);
}

/** K2: a foreign-currency request to a buyer billed in India (PayPal India takes payers outside India only). */
export function warnIndiaBillingForeignCurrency(
	billingCountry: string,
	currency: string,
	homeCountry = 'IN',
	homeCurrency = 'INR',
): boolean {
	return billingCountry === homeCountry && currency !== homeCurrency;
}

/* ---------------------------------------------------------------------------------------------- */
/* Credit and standing (K9)                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export type CreditRefusal = 'creditOnHold' | 'blocked' | 'overLimit' | 'accountsOff';

export interface CreditCheckInput {
	standing: 'active' | 'creditOnHold' | 'blocked';
	limitINR: number;
	/** What the business owes us on account now. */
	outstandingINR: number;
	orderINR: number;
	businessAccounts: boolean;
}

export interface CreditCheck {
	availableINR: number;
	refusal: CreditRefusal | null;
	/** By how much the order goes over the limit, when it does. */
	overByINR: number;
}

/** Whether an order may go on account: enforced on the server; over the limit only with the override. */
export function checkCredit(input: CreditCheckInput): CreditCheck {
	const availableINR = round2(input.limitINR - input.outstandingINR);
	const overByINR = round2(Math.max(0, input.orderINR - availableINR));
	if (!input.businessAccounts) return { availableINR, refusal: 'accountsOff', overByINR };
	if (input.standing === 'blocked') return { availableINR, refusal: 'blocked', overByINR };
	if (input.standing === 'creditOnHold') return { availableINR, refusal: 'creditOnHold', overByINR };
	if (overByINR > 0) return { availableINR, refusal: 'overLimit', overByINR };
	return { availableINR, refusal: null, overByINR: 0 };
}

/** A blocked business can't order at all; credit on hold still orders when paid (bz05). */
export function canOrderAtAll(standing: 'active' | 'creditOnHold' | 'blocked'): boolean {
	return standing !== 'blocked';
}

/** The due date of an order on account: the order day plus the business's credit days. */
export function onAccountDueDate(orderDay: string, creditDays: number): string {
	const date = new Date(`${orderDay}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + creditDays);
	return date.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------------------------------- */
/* Set-off between a business's two accounts (K5, so01–so04)                                       */
/* ---------------------------------------------------------------------------------------------- */

export type SetOffRefusal =
	'notAllowed' | 'agreementExpired' | 'agreementNotYetSigned' | 'moreThanSmallerBalance' | 'nothingToSetOff';

export interface SetOffCheckInput {
	setting: { mode: 'never' } | { mode: 'agreement'; signedOn: string; validUntil: string | null };
	basis: 'standingAgreement' | 'oneOff';
	receivableINR: number;
	payableINR: number;
	amountINR: number;
	today: string;
}

/** At most the smaller of the two balances, only under a written agreement (standing or one-off). */
export function checkSetOff(input: SetOffCheckInput): SetOffRefusal | null {
	const limit = Math.min(input.receivableINR, input.payableINR);
	if (limit <= 0) return 'nothingToSetOff';
	if (input.basis === 'standingAgreement') {
		if (input.setting.mode !== 'agreement') return 'notAllowed';
		if (input.setting.signedOn > input.today) return 'agreementNotYetSigned';
		if (input.setting.validUntil && input.setting.validUntil < input.today) return 'agreementExpired';
	}
	if (input.amountINR > limit + 0.005) return 'moreThanSmallerBalance';
	return null;
}

/**
 * How a receipt on account settles orders: the oldest open orders first unless staff split it by
 * hand (bz06). Returns each order's share and anything left over (kept on the account).
 */
export function allocateReceipt(
	openOrders: ReadonlyArray<{ orderId: string; dueINR: number; placedAt: string }>,
	amountINR: number,
): { allocations: Array<{ orderId: string; amountINR: number }>; unallocatedINR: number } {
	let left = amountINR;
	const allocations: Array<{ orderId: string; amountINR: number }> = [];
	for (const order of [...openOrders].sort((a, b) => a.placedAt.localeCompare(b.placedAt))) {
		if (left <= 0) break;
		const share = round2(Math.min(left, order.dueINR));
		if (share > 0) {
			allocations.push({ orderId: order.orderId, amountINR: share });
			left = round2(left - share);
		}
	}
	return { allocations, unallocatedINR: round2(Math.max(0, left)) };
}
