import { escapeHtml, pill, rupees, shortDate, shortDateTime } from '@core/purchasing/purchasing-format';

import type {
	AdminCheckoutQuote,
	AppliedCoupon,
	OrderListRow,
	OrderPaymentStatus,
	OrderStatus,
	ShippingTraceEntry,
} from '@saha-textile/contracts';

/**
 * How orders look in the admin (brief ol02–ol04, oo01): each status wears one of the theme's
 * existing `status-*` pills, the money in the order's currency with its rupee figure under it, and
 * the payment line worded in the page's language.
 */
export const ORDER_STATUS_PILL: Readonly<Record<OrderStatus, string>> = {
	open: 'processing',
	awaiting_payment: 'pending',
	placed: 'approved',
	processing: 'processing',
	packed: 'processing',
	shipped: 'completed',
	out_for_delivery: 'completed',
	delivered: 'delivered',
	cancelled: 'cancelled',
};

export const PAYMENT_STATUS_PILL: Readonly<Record<OrderPaymentStatus, string>> = {
	unpaid: 'pending',
	request_sent: 'pending',
	pending_at_bank: 'pending',
	paid: 'success',
	part_paid: 'processing',
	paid_ahead: 'success',
	due_on_delivery: 'awaiting_for_approval',
	on_account: 'credit',
	refunded: 'refund',
	part_refunded: 'refund',
};

export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** An amount in any currency, in the page's number style (₹ uses the shop's own rupee format). */
export function money(amount: number, currency: string, locale = 'en-IN'): string {
	if (currency === 'INR') return rupees(amount);
	try {
		return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
	} catch {
		return `${currency} ${amount.toFixed(2)}`;
	}
}

/** A country code as the page's language names it ("GB" → "United Kingdom"). */
export function countryName(code: string | null, locale: string): string {
	if (!code) return '—';
	try {
		return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code;
	} catch {
		return code;
	}
}

/**
 * The line under the payment chip as ol02 draws it: "PayPal · until 27 Nov", "UPI · ref 432198765012",
 * "PayPal" (paid through a gateway), "Cash on delivery", "Due 20 Dec" (on account).
 */
export function paymentLine(detail: OrderListRow['paymentDetail'], t: Translate): string {
	if (!detail) return '';
	if (detail.kind === 'request') {
		return t('ord_link_sent_until', { gateway: t(`ord_gateway_${detail.gateway}`), date: shortDate(detail.until) });
	}
	if (detail.kind === 'cashOnDelivery') return t('ord_method_cashOnDelivery');
	if (detail.kind === 'onAccount') {
		return detail.dueOn ? t('ord_pay_line_due', { date: shortDate(detail.dueOn) }) : t('ord_method_onAccount');
	}
	if (detail.method === 'gateway' && detail.gateway) return t(`ord_gateway_${detail.gateway}`);
	const method = t(`ord_method_${detail.method}`);
	if (detail.reference) return t('ord_pay_line_ref', { method, reference: detail.reference });
	return detail.referenceStart ? `${method} · ${detail.referenceStart}…` : method;
}

/** "18:44" today, "19 Nov, 18:44" on another day (ol03's reason sentences). */
function whenShort(at: string, now: Date): string {
	const day = (value: Date) => new Date(value.getTime() + 330 * 60_000).toISOString().slice(0, 10);
	const time = new Date(at).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Asia/Kolkata',
	});
	return day(new Date(at)) === day(now) ? time : shortDateTime(at);
}

/** One reason under Needs attention (ol03): a bold lead and the sentence, dated when the server knows when. */
export function attentionWhy(
	row: Pick<OrderListRow, 'attention' | 'attentionAt'>,
	t: Translate,
	now = new Date(),
): string {
	return row.attention
		.map((reason) => {
			const at = row.attentionAt?.[reason];
			let text = t(`ord_why_${reason}`);
			if (at && reason === 'requestExpiredUnpaid')
				text = t('ord_why_requestExpiredUnpaid_on', { date: shortDate(at) });
			if (at && reason === 'pendingAtBank') text = t('ord_why_pendingAtBank_at', { time: whenShort(at, now) });
			if (at && reason === 'paymentReview') text = t('ord_why_paymentReview_at', { time: whenShort(at, now) });
			if (at && reason === 'openTooLong') text = t('ord_why_openTooLong_since', { date: shortDate(at) });
			return `<div><b${reason === 'invoiceAddressNeeded' ? ' class="text-danger"' : ''}>${escapeHtml(t(`ord_why_lead_${reason}`))}</b> ${escapeHtml(text)}</div>`;
		})
		.join('');
}

/** The Needs attention tile's line (ol02): "1 invoice address · 1 link expired · 1 payment to check". */
export function attentionTileLine(by: Partial<Record<string, number>> | undefined, t: Translate): string | null {
	const parts = Object.entries(by ?? {})
		.filter(([, count]) => (count ?? 0) > 0)
		.map(([reason, count]) => t(`ord_tile_part_${reason}_${count === 1 ? 'one' : 'other'}`, { count }));
	return parts.length ? parts.join(' · ') : null;
}

export interface OrderTableRow {
	id: string;
	rowTone?: 'danger';
	number: string;
	date: string;
	buyer: string;
	deliversTo: string;
	total: string;
	payment: string;
	status: string;
	/* open orders (oo01) */
	openSince: string;
	pieces: string;
	goods: string;
	paid: string;
	balance: string;
	/* Needs attention (ol03): why the order waits on staff */
	why: string;
}

/** One row of the orders list as ol02 draws it; open orders fill their own columns (oo01). */
export function toOrderTableRow(row: OrderListRow, t: Translate, locale: string, now = new Date()): OrderTableRow {
	const invoiceNeeded = row.attention.includes('invoiceAddressNeeded');
	const businessChip =
		row.buyerKind === 'business'
			? ` <span class="badge badge-theme ms-1">${escapeHtml(t('ord_business_chip'))}</span>`
			: '';
	const foreign = row.currency !== 'INR';
	const detail = paymentLine(row.paymentDetail, t);
	const flag = invoiceNeeded
		? `<span class="badge bg-danger mt-1 d-inline-flex align-items-center gap-1"><i class="ri-file-warning-line"></i>${escapeHtml(t('ord_attention_invoiceAddressNeeded'))}</span>`
		: '';
	const open = row.open;
	const days = open ? Math.max(0, Math.floor((now.getTime() - new Date(open.openedAt).getTime()) / 86_400_000)) : 0;
	const balance = !open
		? ''
		: row.paymentStatus === 'on_account'
			? pill('credit', t('ord_balance_on_account'))
			: open.dueINR > 0
				? pill('pending', t('ord_due_amount', { amount: rupees(open.dueINR) }))
				: open.paidAheadINR > 0
					? pill('success', t('ord_paid_ahead_amount', { amount: rupees(open.paidAheadINR) }))
					: pill('success', t('ord_paid_up'));
	return {
		why: attentionWhy(row, t, now),
		id: row.id,
		...(invoiceNeeded ? { rowTone: 'danger' as const } : {}),
		// oo01: "Admin · open" under the number of an open order.
		number: `<b>${escapeHtml(row.orderNumber)}</b><div class="small text-muted">${escapeHtml(t(`ord_channel_${row.channel}`))}${row.open ? ` · ${escapeHtml(t('ord_channel_open'))}` : ''}</div>`,
		date: escapeHtml(shortDateTime(row.createdAt)),
		buyer: `${escapeHtml(row.buyerName)}${businessChip}`,
		deliversTo: escapeHtml(countryName(row.deliveryCountry, locale)),
		total: foreign
			? `${escapeHtml(money(row.total, row.currency, locale))}<div class="small text-muted">${escapeHtml(rupees(row.totalINR))}</div>`
			: escapeHtml(rupees(row.totalINR)),
		payment: `${pill(PAYMENT_STATUS_PILL[row.paymentStatus], t(`ord_pay_${row.paymentStatus}`))}${detail ? `<div class="small text-muted mt-1">${escapeHtml(detail)}</div>` : ''}`,
		status: `${pill(ORDER_STATUS_PILL[row.status], t(`ord_status_${row.status}`))}${flag}`,
		openSince: open ? escapeHtml(`${shortDate(open.openedAt)} · ${t('ord_days', { days })}`) : '',
		pieces: open ? String(open.piecesHeld) : '',
		goods: open ? escapeHtml(rupees(open.goodsINR)) : '',
		paid: open ? escapeHtml(rupees(open.paidINR)) : '',
		balance,
	};
}

/**
 * The reason under the shipping charge (brief ck01–ck06): what was charged and what ships free, read
 * from the rule engine's trace. `reason` goes under the Delivery step, `short` under Shipping in the
 * summary ("1 discounted piece × ₹100", "Sent abroad: first piece, then 2 more").
 */
export function shippingReason(
	shipping: Pick<AdminCheckoutQuote['shipping'], 'trace' | 'pieces'>,
	t: Translate,
): { reason: string; short: string } {
	const pieces = new Map(shipping.pieces.map((piece) => [piece.lineId, piece]));
	const entries: ShippingTraceEntry[] = [];
	for (const text of shipping.trace) {
		try {
			entries.push(JSON.parse(text) as ShippingTraceEntry);
		} catch {
			// A trace line that isn't an entry adds nothing to the reason.
		}
	}
	const unitsOf = (entry: ShippingTraceEntry): number =>
		entry.units ?? entry.lineIds.reduce((sum, id) => sum + (pieces.get(id)?.units ?? 0), 0);
	const all = (list: ShippingTraceEntry[], discounted: boolean): boolean =>
		list.length > 0 &&
		list.every(
			(entry) =>
				entry.lineIds.length > 0 && entry.lineIds.every((id) => pieces.get(id)?.discounted === discounted),
		);
	const parts: string[] = [];
	let short = '';

	const firstAndFurther = entries.find((entry) => entry.result === 'firstAndFurther');
	if (firstAndFurther) {
		const more = firstAndFurther.furtherUnits ?? 0;
		parts.push(
			more > 0
				? t('ord_ship_first_further', {
						first: rupees(firstAndFurther.firstINR ?? 0),
						count: more,
						further: rupees(firstAndFurther.furtherINR ?? 0),
					})
				: t('ord_ship_first_only', { first: rupees(firstAndFurther.firstINR ?? 0) }),
		);
		short = t('ord_ship_sent_abroad', { count: more });
	}

	const charged = entries.filter((entry) => entry.result === 'productCharge' && entry.amountINR > 0);
	const byUnit = new Map<number, ShippingTraceEntry[]>();
	for (const entry of charged) {
		const unit = entry.unitAmountINR ?? entry.amountINR;
		byUnit.set(unit, [...(byUnit.get(unit) ?? []), entry]);
	}
	for (const [unit, list] of byUnit) {
		const count = list.reduce((sum, entry) => sum + unitsOf(entry), 0);
		const kind = all(list, true) ? 'discounted' : 'plain';
		parts.push(t(`ord_ship_${kind}_${count === 1 ? 'one' : 'other'}`, { count, amount: rupees(unit) }));
	}

	const free = entries.filter((entry) => entry.result === 'free');
	if (free.length) {
		const count = free.reduce((sum, entry) => sum + unitsOf(entry), 0);
		if (!charged.length && !firstAndFurther && all(free, false)) parts.push(t('ord_ship_every_full_price'));
		else if (all(free, false)) parts.push(t(`ord_ship_full_price_free_${count === 1 ? 'one' : 'other'}`));
		else if (count > 0) parts.push(t('ord_ship_more_free', { count }));
	}

	const reason = parts.join('; ');
	return {
		reason: reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : '',
		short: short || (charged.length ? (parts[0] ?? '') : ''),
	};
}

/** The line under an applied coupon (cp07): "10% off Blush Pink Georgette Saree; Maroon Temple Border Silk is on sale". */
export function couponWhy(coupon: AppliedCoupon, titleOf: (lineId: string) => string, t: Translate): string {
	if (coupon.kind === 'freeDelivery') return t('ord_coupon_why_free_delivery');
	const applied = coupon.lines.filter((line) => line.reason === 'applied').map((line) => titleOf(line.lineId));
	const onSale = coupon.lines.filter((line) => line.reason === 'onSale').map((line) => titleOf(line.lineId));
	const off =
		coupon.kind === 'percentOff'
			? t('ord_coupon_why_percent', { value: coupon.value, items: applied.join(', ') })
			: t('ord_coupon_why_amount', { amount: rupees(coupon.value), items: applied.join(', ') });
	return [off, ...onSale.map((title) => t('ord_coupon_why_on_sale', { title }))].join('; ');
}
