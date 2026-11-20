import type {
	CommunicationChannel,
	CommunicationGroup,
	CommunicationSwitch,
	CommunicationSwitchWrite,
	CommunicationUse,
} from '@saha-textile/contracts';

import type { CommunicationSwitchRepository } from '../ports/communication-switch.repository';

/**
 * Settings › Communications rules (owner decision round 2026-11-13).
 *
 * The approved list itself lives in contracts; core takes it as an argument because core may
 * import only types from contracts. Every function here is pure except the send gate, which
 * reads the repository port.
 */

/** Rows that carry sign-in and sign-up codes. Email stays on; SMS and WhatsApp cannot both be off. */
const CODE_USES = new Set(['signup_code', 'signin_code', 'step_up_code', 'new_contact_code']);

/** Which approved message each sent template belongs to. A key not listed here is never gated. */
const TEMPLATE_USE: Readonly<Record<string, string>> = {
	otp_register: 'signup_code',
	otp_login: 'signin_code',
	otp_step_up: 'step_up_code',
	otp_change_contact: 'new_contact_code',
	contact_change_requested: 'contact_change_warning',
	customer_activation: 'account_activation',
	password_reset: 'password_reset',
	verify_email: 'email_verification',
	admin_invite: 'staff_invitation',
	product_question_answered: 'question_answered',
	back_in_stock: 'back_in_stock',
	shop_event_announcement: 'sale_launch_announcement',
};

export function communicationUseForTemplate(templateKey: string): string | null {
	return TEMPLATE_USE[templateKey] ?? null;
}

/**
 * The group a sent template belongs to, which decides the email's From address (owner decision
 * round 2026-11-20: one sender per group). A template that belongs to no approved message sends
 * as `account`, the automatic no-reply sender.
 */
export function communicationGroupForTemplate(
	templateKey: string,
	uses: readonly CommunicationUse[],
): CommunicationGroup {
	const key = communicationUseForTemplate(templateKey);
	return uses.find((row) => row.key === key)?.group ?? 'account';
}

export const isCommunicationCodeUse = (use: string): boolean => CODE_USES.has(use);

/**
 * The effective state of one cell. An unavailable or red cell is always off, whatever a stored
 * row says: the lock is part of the rule, not of the data.
 */
export function communicationCellOn(
	use: CommunicationUse,
	channel: CommunicationChannel,
	stored: Pick<CommunicationSwitch, 'on'> | null | undefined,
): boolean {
	const cell = use.cells[channel];
	if (!cell.available || cell.risk === 'danger') return false;
	return stored ? stored.on : cell.on;
}

export const isCommunicationCellLocked = (use: CommunicationUse, channel: CommunicationChannel): boolean =>
	!use.cells[channel].available || use.cells[channel].risk === 'danger';

export type CommunicationChangeRefusal =
	'unknown_use' | 'unavailable' | 'locked' | 'email_required' | 'phone_channel_required';

export type CommunicationChangeDecision =
	{ ok: true; from: boolean; needsPassword: boolean } | { ok: false; reason: CommunicationChangeRefusal };

/**
 * Whether one cell may move to `change.on`, and whether that costs the password.
 *
 * `currentOn` reads the effective state of any cell of the same use, so the code-row guard
 * can see the other phone channel.
 */
export function decideCommunicationChange(
	uses: readonly CommunicationUse[],
	change: Pick<CommunicationSwitchWrite, 'use' | 'channel' | 'on'>,
	currentOn: (channel: CommunicationChannel) => boolean,
): CommunicationChangeDecision {
	const use = uses.find((row) => row.key === change.use);
	if (!use) return { ok: false, reason: 'unknown_use' };
	const cell = use.cells[change.channel];
	if (!cell.available) return { ok: false, reason: 'unavailable' };
	if (cell.risk === 'danger') return { ok: false, reason: 'locked' };
	const from = currentOn(change.channel);
	if (!change.on && CODE_USES.has(use.key)) {
		if (change.channel === 'email') return { ok: false, reason: 'email_required' };
		const other: CommunicationChannel = change.channel === 'sms' ? 'whatsapp' : 'sms';
		if (!currentOn(other)) return { ok: false, reason: 'phone_channel_required' };
	}
	return { ok: true, from, needsPassword: change.on && !from && cell.risk === 'warning' };
}

/**
 * The check every sender runs before a message leaves: false when Settings › Communications
 * has this message switched off on this channel. Channel kill switches are checked by the
 * sender before this, and still win.
 */
export class CommunicationSendGate {
	constructor(
		private readonly uses: readonly CommunicationUse[],
		private readonly switches: CommunicationSwitchRepository,
	) {}

	async allows(templateKey: string, channel: CommunicationChannel): Promise<boolean> {
		const key = communicationUseForTemplate(templateKey);
		if (!key) return true;
		const use = this.uses.find((row) => row.key === key);
		if (!use) return true;
		return communicationCellOn(use, channel, await this.switches.find(key, channel));
	}
}
