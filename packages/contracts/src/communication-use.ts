import { z } from 'zod';

import { IsoDateTime } from './common';

/**
 * Settings › Communications: every message the shop sends, and which channels may carry it.
 *
 * The list is fixed in code because each row is a message the code actually sends; the
 * super admin only switches channels on and off. A cell's `risk` decides what switching it on
 * costs the operator: nothing, a password with a cost/promotion warning, or a password with a
 * security warning. The API enforces the same rule, so the page is never the only gate.
 */
export const CommunicationChannel = z.enum(['email', 'sms', 'whatsapp']);
export type CommunicationChannel = z.infer<typeof CommunicationChannel>;

export const COMMUNICATION_CHANNELS: readonly CommunicationChannel[] = ['email', 'sms', 'whatsapp'];

export const CommunicationRisk = z.enum(['none', 'warning', 'danger']);
export type CommunicationRisk = z.infer<typeof CommunicationRisk>;

export const CommunicationGroup = z.enum(['account', 'orders', 'shop', 'marketing']);
export type CommunicationGroup = z.infer<typeof CommunicationGroup>;

export interface CommunicationCell {
	/** False when the channel cannot carry this message at all (a newsletter is not a text). */
	available: boolean;
	/** The recommended starting state. */
	on: boolean;
	risk: CommunicationRisk;
	/** Translation key of the hover text; present whenever `risk` is not `none` or the cell is unavailable. */
	reasonKey?: string;
}

export interface CommunicationUse {
	key: string;
	group: CommunicationGroup;
	cells: Record<CommunicationChannel, CommunicationCell>;
}

const ON: CommunicationCell = { available: true, on: true, risk: 'none' };
const warning = (reasonKey: string): CommunicationCell => ({ available: true, on: false, risk: 'warning', reasonKey });
const danger = (reasonKey: string): CommunicationCell => ({ available: true, on: false, risk: 'danger', reasonKey });
const unavailable = (reasonKey: string): CommunicationCell => ({
	available: false,
	on: false,
	risk: 'none',
	reasonKey,
});

const all = (): Record<CommunicationChannel, CommunicationCell> => ({ email: ON, sms: ON, whatsapp: ON });

export const COMMUNICATION_USES: readonly CommunicationUse[] = [
	{ key: 'signup_code', group: 'account', cells: all() },
	{ key: 'signin_code', group: 'account', cells: all() },
	{ key: 'step_up_code', group: 'account', cells: all() },
	{ key: 'new_contact_code', group: 'account', cells: all() },
	{ key: 'contact_change_warning', group: 'account', cells: all() },
	{ key: 'account_activation', group: 'account', cells: all() },
	{
		key: 'password_reset',
		group: 'account',
		cells: {
			email: ON,
			sms: warning('comm_reason_phone_has_code'),
			whatsapp: warning('comm_reason_phone_has_code'),
		},
	},
	{
		key: 'email_verification',
		group: 'account',
		cells: {
			email: ON,
			sms: danger('comm_reason_email_proof'),
			whatsapp: danger('comm_reason_email_proof'),
		},
	},
	{
		key: 'staff_invitation',
		group: 'account',
		cells: {
			email: ON,
			sms: danger('comm_reason_staff_email_proof'),
			whatsapp: danger('comm_reason_staff_email_proof'),
		},
	},
	{ key: 'order_confirmed', group: 'orders', cells: all() },
	{
		key: 'payment_failed',
		group: 'orders',
		cells: { email: ON, sms: warning('comm_reason_payment_link_texts'), whatsapp: ON },
	},
	// Owner, 2026-11-17 (orders round OD1/OD2): a piece owed on backorder, and a payment that
	// arrived after the piece sold out, which refunds the whole order.
	{ key: 'order_on_backorder', group: 'orders', cells: all() },
	{ key: 'order_refunded_sold_out', group: 'orders', cells: all() },
	{ key: 'order_shipped', group: 'orders', cells: all() },
	{ key: 'order_delivered', group: 'orders', cells: all() },
	{ key: 'order_cancelled', group: 'orders', cells: all() },
	{ key: 'refund_processed', group: 'orders', cells: all() },
	{
		key: 'tax_invoice',
		group: 'orders',
		cells: { email: ON, sms: warning('comm_reason_sms_no_file'), whatsapp: ON },
	},
	{
		key: 'question_answered',
		group: 'shop',
		cells: {
			email: ON,
			sms: warning('comm_reason_not_urgent_cost'),
			whatsapp: warning('comm_reason_not_urgent_cost'),
		},
	},
	{
		key: 'back_in_stock',
		group: 'shop',
		cells: {
			email: ON,
			sms: warning('comm_reason_sms_promotional_route'),
			whatsapp: warning('comm_reason_whatsapp_marketing_rate'),
		},
	},
	{
		key: 'sale_launch_announcement',
		group: 'marketing',
		cells: {
			email: ON,
			sms: warning('comm_reason_promotional_sms'),
			whatsapp: warning('comm_reason_promotional_whatsapp'),
		},
	},
	{
		key: 'newsletter',
		group: 'marketing',
		cells: {
			email: ON,
			sms: unavailable('comm_reason_newsletter_email_only'),
			whatsapp: unavailable('comm_reason_newsletter_email_only'),
		},
	},
];

export const COMMUNICATION_GROUPS: readonly CommunicationGroup[] = ['account', 'orders', 'shop', 'marketing'];

export const CommunicationUseKey = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z][a-z0-9_]*$/);

/** One stored switch (`communicationSwitches`). A missing row means the recommended start state. */
export const CommunicationSwitch = z.object({
	use: CommunicationUseKey,
	channel: CommunicationChannel,
	on: z.boolean(),
	updatedBy: z.string().nullable().default(null),
	updatedAt: IsoDateTime.nullable().default(null),
});
export type CommunicationSwitch = z.infer<typeof CommunicationSwitch>;

/**
 * PUT /admin/communications — one cell. `currentPassword` is required only when switching on a
 * cell with a warning; the API checks it with the recent-password proof, never the PIN.
 */
export const CommunicationSwitchWrite = z
	.object({
		use: CommunicationUseKey,
		channel: CommunicationChannel,
		on: z.boolean(),
		currentPassword: z.string().min(1).max(256).optional(),
	})
	.strict();
export type CommunicationSwitchWrite = z.infer<typeof CommunicationSwitchWrite>;

export const CommunicationCellView = z.object({
	available: z.boolean(),
	on: z.boolean(),
	/** The recommended starting state, so the page can mark a changed cell. */
	recommended: z.boolean(),
	risk: CommunicationRisk,
	reasonKey: z.string().optional(),
	/** True when the switch can never move: an unavailable or red (security) cell. */
	locked: z.boolean(),
	updatedAt: IsoDateTime.nullable(),
});
export type CommunicationCellView = z.infer<typeof CommunicationCellView>;

export const CommunicationUseView = z.object({
	key: CommunicationUseKey,
	group: CommunicationGroup,
	cells: z.object({ email: CommunicationCellView, sms: CommunicationCellView, whatsapp: CommunicationCellView }),
});
export type CommunicationUseView = z.infer<typeof CommunicationUseView>;

/** GET /admin/communications and the answer to every PUT: the whole table, as stored now. */
export const CommunicationSettingsResponse = z.object({
	channels: z.array(CommunicationChannel),
	groups: z.array(CommunicationGroup),
	items: z.array(CommunicationUseView),
});
export type CommunicationSettingsResponse = z.infer<typeof CommunicationSettingsResponse>;
