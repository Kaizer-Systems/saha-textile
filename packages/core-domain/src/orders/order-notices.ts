import type { OrderStatus } from '@saha-textile/contracts';

import { STATUS_MESSAGES } from './status-machine';

/**
 * Which customer messages an order change sends, and by which channel (orders brief 2026-11-20:
 * the status table, od06 "Customer told · Email · SMS", od08 the receipt email). Pure: the API
 * sends them after the change is saved, through `NotificationPort`, and Settings › Communications
 * can still switch any of them off per channel. WhatsApp is on hold (owner, 19 Nov), so it is
 * never planned here.
 */
export type OrderNoticeChannel = 'email' | 'sms';

export interface OrderNotice {
	channel: OrderNoticeChannel;
	template: string;
}

/** The customer's contact for order messages: the billing contact, never the India invoice address. */
export interface OrderNoticeContact {
	email: string | null;
	mobile: string | null;
}

/**
 * The channels each message has a template for: the message-templates document (updated 20 Nov)
 * registers an SMS for every order message except the receipt, which is email only (od08: "The
 * customer gets a receipt email").
 */
const CHANNELS: Readonly<Record<string, readonly OrderNoticeChannel[]>> = {
	order_confirmed: ['email', 'sms'],
	order_shipped: ['email', 'sms'],
	order_delivered: ['email', 'sms'],
	order_cancelled: ['email', 'sms'],
	order_refunded_sold_out: ['email', 'sms'],
	refund_processed: ['email', 'sms'],
	payment_not_completed: ['email', 'sms'],
	payment_receipt: ['email'],
};

/** Our SMS goes only to Indian mobile numbers (DLT): +91 and ten digits starting 6–9. */
export function isIndianMobile(value: string | null | undefined): boolean {
	const digits = (value ?? '').replace(/[\s-]/g, '');
	return /^(\+?91)?[6-9]\d{9}$/.test(digits);
}

/** The messages a move between two statuses tells the customer; nothing when the status stays. */
export function statusNotices(from: OrderStatus, to: OrderStatus): string[] {
	return from === to ? [] : [...STATUS_MESSAGES[to]];
}

/**
 * The messages that will actually be tried for these templates: email when the customer has an
 * email address, SMS when the billing mobile is an Indian mobile number. The order history lists
 * exactly these, so it never claims a message that had nowhere to go.
 */
export function plannedNotices(templates: readonly string[], contact: OrderNoticeContact): OrderNotice[] {
	return templates.flatMap((template) =>
		(CHANNELS[template] ?? []).flatMap((channel): OrderNotice[] => {
			if (channel === 'email') return contact.email ? [{ channel, template }] : [];
			return isIndianMobile(contact.mobile) ? [{ channel, template }] : [];
		}),
	);
}
