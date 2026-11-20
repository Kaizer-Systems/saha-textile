import { escapeHtml, pill, rupees, shortDate, shortDateTime } from '@core/purchasing/purchasing-format';

import type { OrderListRow, OrderPaymentStatus, OrderStatus } from '@saha-textile/contracts';

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

export function paymentLine(detail: OrderListRow['paymentDetail'], t: Translate): string {
	if (!detail) return '';
	if (detail.kind === 'request') {
		return t('ord_link_sent_until', { gateway: t(`ord_gateway_${detail.gateway}`), date: shortDate(detail.until) });
	}
	const method = t(`ord_method_${detail.method}`);
	return detail.referenceStart ? `${method} · ${detail.referenceStart}…` : method;
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
		: open.dueINR > 0
			? pill('pending', t('ord_due_amount', { amount: rupees(open.dueINR) }))
			: open.paidAheadINR > 0
				? pill('success', t('ord_paid_ahead_amount', { amount: rupees(open.paidAheadINR) }))
				: pill('success', t('ord_paid_up'));
	return {
		id: row.id,
		...(invoiceNeeded ? { rowTone: 'danger' as const } : {}),
		number: `<b>${escapeHtml(row.orderNumber)}</b><div class="small text-muted">${escapeHtml(t(`ord_channel_${row.channel}`))}</div>`,
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
